import "server-only";
import type { ProjectInfo, VersionInfo } from "@/lib/cloud-types";

type VersionRow = {
  id: string;
  number: number | null;
  createdAt: Date;
  size: number;
  message: string | null;
  createdBy?: { name: string } | null;
};

export const versionInfo = (v: VersionRow): VersionInfo => ({
  id: v.id,
  number: v.number ?? 0,
  createdAt: v.createdAt.toISOString(),
  size: v.size,
  message: v.message,
  author: v.createdBy?.name ?? null,
});

type ProjectRow = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  shareToken: string | null;
  thumbnailKey: string | null;
  currentVersion?: VersionRow | null;
};

export const projectInfo = (p: ProjectRow): ProjectInfo => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  shareToken: p.shareToken,
  // The version id in the URL busts browser caches when a new save changes the image.
  thumbnailUrl: p.thumbnailKey
    ? `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.thumbnailKey.split("/").pop() ?? "")}`
    : null,
  latestVersion: p.currentVersion ? versionInfo(p.currentVersion) : null,
});

/** Include clause for loading a project with its latest version. */
export const withCurrentVersion = {
  currentVersion: { include: { createdBy: { select: { name: true } } } },
} as const;
