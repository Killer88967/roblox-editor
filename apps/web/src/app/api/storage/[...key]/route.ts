import { readLocal, storage, verifyLocal, localPath } from "@/lib/server/storage";
import { sniff } from "@/lib/server/roblox-assets";
import { MAX_PLACE_BYTES } from "@/lib/server/access";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local-disk storage for development (used when R2 isn't configured). Every request
 * needs a signature from the app (see storage.ts), like an S3 presigned URL.
 */
type Ctx = RouteContext<"/api/storage/[...key]">;

async function check(request: Request, ctx: Ctx, method: "GET" | "PUT") {
  if (storage().kind !== "local") return { error: new Response(null, { status: 404 }) } as const;
  const key = (await ctx.params).key.join("/");
  const q = new URL(request.url).searchParams;
  if (!verifyLocal(method, key, Number(q.get("expires")), q.get("sig") ?? "")) {
    return { error: new Response("Link expired or invalid.", { status: 403 }) } as const;
  }
  return { key, name: q.get("name") } as const;
}

export async function GET(request: Request, ctx: Ctx) {
  const c = await check(request, ctx, "GET");
  if ("error" in c) return c.error;
  try {
    const bytes = await readLocal(c.key);
    const type = c.key.endsWith(".webp") ? "image/webp" : sniff(bytes);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=900",
        ...(c.name
          ? { "content-disposition": `attachment; filename="${c.name.replace(/"/g, "")}"` }
          : {}),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function PUT(request: Request, ctx: Ctx) {
  const c = await check(request, ctx, "PUT");
  if ("error" in c) return c.error;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_PLACE_BYTES) return new Response("Too big.", { status: 413 });
  const file = localPath(c.key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return new Response(null, { status: 200 });
}
