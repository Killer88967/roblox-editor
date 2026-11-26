/** Shapes the cloud API returns (shared by route handlers and the client). */

export type VersionInfo = {
  id: string;
  number: number;
  createdAt: string;
  size: number;
  message: string | null;
  author: string | null;
};

export type ProjectInfo = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Share token when view-only sharing is on. */
  shareToken: string | null;
  /** Preview image URL, if the project has been saved with one. */
  thumbnailUrl: string | null;
  latestVersion: VersionInfo | null;
};

/** Response of POST /api/projects/[id]/versions: where to upload the new save. */
export type UploadTicket = {
  versionId: string;
  uploadUrl: string;
  thumbnailUploadUrl: string | null;
};
