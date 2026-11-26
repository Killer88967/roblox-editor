"use client";

import type { ProjectInfo, UploadTicket, VersionInfo } from "./cloud-types";

/** An API error with the server's message. */
export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new CloudError(res.status, body?.error ?? `Request failed (${res.status}).`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const listProjects = () => api<ProjectInfo[]>("/api/projects");
export const getProject = (id: string) => api<ProjectInfo>(`/api/projects/${id}`);
export const createProject = (name: string) =>
  api<ProjectInfo>("/api/projects", { method: "POST", body: JSON.stringify({ name }) });
export const updateProject = (id: string, changes: { name?: string; shared?: boolean }) =>
  api<ProjectInfo>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
export const deleteProject = (id: string) => api<null>(`/api/projects/${id}`, { method: "DELETE" });
export const listVersions = (id: string) => api<VersionInfo[]>(`/api/projects/${id}/versions`);

async function put(url: string, body: Blob | Uint8Array, type: string) {
  const res = await fetch(url, {
    method: "PUT",
    body: body instanceof Blob ? body : new Blob([new Uint8Array(body)]),
    headers: { "content-type": type },
  });
  if (!res.ok) throw new CloudError(res.status, `Upload failed (${res.status}).`);
}

/** Saves a new version: uploads the place (and a preview) to storage, then finishes it. */
export async function saveVersion(
  projectId: string,
  bytes: Uint8Array,
  thumbnail: Blob | null,
  message?: string,
) {
  const ticket = await api<UploadTicket>(`/api/projects/${projectId}/versions`, {
    method: "POST",
    body: JSON.stringify({ size: bytes.length, message, thumbnail: !!thumbnail }),
  });
  await put(ticket.uploadUrl, bytes, "application/octet-stream");
  if (thumbnail && ticket.thumbnailUploadUrl) {
    // A missing preview isn't worth failing the save over.
    await put(ticket.thumbnailUploadUrl, thumbnail, "image/webp").catch(() => {});
  }
  return api<ProjectInfo>(`/api/projects/${projectId}/versions/${ticket.versionId}`, {
    method: "PATCH",
  });
}

async function download(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new CloudError(res.status, `Download failed (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** A version's .rbxl bytes. */
export async function versionBytes(projectId: string, versionId: string) {
  const { url } = await api<{ url: string }>(`/api/projects/${projectId}/versions/${versionId}`);
  return download(url);
}

/** Starts a browser download of a version's .rbxl. */
export async function downloadVersion(projectId: string, versionId: string) {
  const { url } = await api<{ url: string }>(
    `/api/projects/${projectId}/versions/${versionId}?download`,
  );
  window.location.assign(url);
}

export type SharedPlace = { name: string; version: VersionInfo | null; bytes: Uint8Array | null };

/** A shared project's latest version, by share token (no account needed). */
export async function openShared(token: string): Promise<SharedPlace> {
  const info = await api<{ name: string; version: VersionInfo | null; url: string | null }>(
    `/api/share/${encodeURIComponent(token)}`,
  );
  return {
    name: info.name,
    version: info.version,
    bytes: info.url ? await download(info.url) : null,
  };
}

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`;

/** A file picked on the dashboard, handed to the project page after navigating. */
let pending: { projectId: string; file: File } | null = null;
export const setPendingFile = (projectId: string, file: File) => {
  pending = { projectId, file };
};
export const takePendingFile = (projectId: string) => {
  const p = pending?.projectId === projectId ? pending.file : null;
  pending = null;
  return p;
};
