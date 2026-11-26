import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * File storage for saved places, thumbnails and cached Roblox assets.
 *
 * - Cloudflare R2 (or any S3-compatible store) when R2_* variables are set. Browsers
 *   upload and download straight to/from R2 with short-lived signed URLs, so big places
 *   never pass through the app server (Vercel caps request bodies at 4.5 MB).
 * - Otherwise files go in `.data/storage` on disk, served by /api/storage with signed
 *   URLs. That's for local development (e.g. Codespaces); it won't work on Vercel.
 */
export type Storage = {
  kind: "r2" | "local";
  /** A URL the browser can PUT the file to. */
  uploadUrl(key: string, contentType: string): Promise<string>;
  /** A URL the browser can GET the file from. */
  downloadUrl(key: string, opts?: { fileName?: string }): Promise<string>;
  /** Size in bytes, or null if it doesn't exist. */
  size(key: string): Promise<number | null>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Deletes everything whose key starts with `prefix`. */
  deletePrefix(prefix: string): Promise<void>;
};

const URL_TTL = 60 * 15; // seconds

function r2(): Storage | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT ?? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  const Bucket = R2_BUCKET;
  return {
    kind: "r2",
    uploadUrl: (Key, ContentType) =>
      getSignedUrl(client, new PutObjectCommand({ Bucket, Key, ContentType }), {
        expiresIn: URL_TTL,
      }),
    downloadUrl: (Key, opts) =>
      getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key,
          ResponseContentDisposition: opts?.fileName
            ? `attachment; filename="${opts.fileName.replace(/"/g, "")}"`
            : undefined,
        }),
        { expiresIn: URL_TTL },
      ),
    async size(Key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return head.ContentLength ?? 0;
      } catch {
        return null;
      }
    },
    async put(Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async deletePrefix(Prefix) {
      let ContinuationToken: string | undefined;
      do {
        const list = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
        );
        const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (keys.length) {
          await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys } }));
        }
        ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },
  };
}

// ---- Local disk (development) ----

const LOCAL_ROOT = path.join(process.cwd(), ".data", "storage");

const secret = () => process.env.BETTER_AUTH_SECRET ?? "dev-secret-change-me";

/** Signature for a local storage URL: method + key + expiry. */
export function signLocal(method: "GET" | "PUT", key: string, expires: number) {
  return createHmac("sha256", secret()).update(`${method}\n${key}\n${expires}`).digest("base64url");
}

export function verifyLocal(method: "GET" | "PUT", key: string, expires: number, sig: string) {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const want = Buffer.from(signLocal(method, key, expires));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The file path for a key, refusing anything that escapes the storage folder. */
export function localPath(key: string) {
  const full = path.resolve(LOCAL_ROOT, key);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Bad storage key");
  return full;
}

const localUrl = (method: "GET" | "PUT", key: string, extra = "") => {
  const expires = Math.floor(Date.now() / 1000) + URL_TTL;
  const sig = signLocal(method, key, expires);
  return `/api/storage/${key.split("/").map(encodeURIComponent).join("/")}?expires=${expires}&sig=${sig}${extra}`;
};

const local: Storage = {
  kind: "local",
  uploadUrl: async (key) => localUrl("PUT", key),
  downloadUrl: async (key, opts) =>
    localUrl("GET", key, opts?.fileName ? `&name=${encodeURIComponent(opts.fileName)}` : ""),
  async size(key) {
    try {
      return (await stat(localPath(key))).size;
    } catch {
      return null;
    }
  },
  async put(key, bytes) {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },
  async deletePrefix(prefix) {
    await rm(localPath(prefix.replace(/\/$/, "")), { recursive: true, force: true });
  },
};

export const readLocal = (key: string) => readFile(localPath(key));

let cached: Storage | undefined;
export function storage(): Storage {
  cached ??= r2() ?? local;
  return cached;
}

/** Where things go in storage. */
export const keys = {
  version: (projectId: string, versionId: string) =>
    `projects/${projectId}/versions/${versionId}.rbxl`,
  thumbnail: (projectId: string, versionId: string) =>
    `projects/${projectId}/thumbs/${versionId}.webp`,
  project: (projectId: string) => `projects/${projectId}/`,
  asset: (assetId: string) => `assets/roblox/${assetId}`,
};
