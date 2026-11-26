"use client";

import { useEffect, useState } from "react";
import type { VersionInfo } from "@/lib/cloud-types";
import { downloadVersion, listVersions, versionBytes } from "@/lib/cloud";
import { useEditor } from "@/stores/editor";
import { formatBytes, timeAgo } from "./ui";

/** A cloud project's saved versions: open an older one (save to restore it) or download. */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const cloud = useEditor((s) => s.cloud);
  const unsaved = useEditor((s) => s.unsaved);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const projectId = cloud?.projectId;
  const latestId = cloud?.latest?.id;

  // Load, and reload when a new version is saved.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    listVersions(projectId).then(
      (v) => live && setVersions(v),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [projectId, latestId]);

  if (!cloud) return null;
  const openVersion = async (v: VersionInfo) => {
    if (unsaved && !confirm("Open this version? Your unsaved changes will be lost.")) return;
    setBusy(v.id);
    try {
      const bytes = await versionBytes(cloud.projectId, v.id);
      const st = useEditor.getState();
      await st.openBytes(bytes, `${cloud.name}.rbxl`, {
        ...cloud,
        viewing: v.id === cloud.latest?.id ? null : v,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-medium">Version history</h2>
        <button
          type="button"
          aria-label="Close history"
          className="rounded px-2 text-zinc-400 hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {cloud.viewing && (
        <p className="border-b border-white/10 bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
          You&apos;re looking at v{cloud.viewing.number}. Save to make it the latest version.
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="p-3 text-sm text-red-400">{error}</p>}
        {!versions && !error && <p className="p-3 text-sm text-zinc-500">Loading…</p>}
        {versions?.length === 0 && (
          <p className="p-3 text-sm text-zinc-500">No saves yet. Press Save to make the first.</p>
        )}
        {versions?.map((v) => {
          const current = (cloud.viewing?.id ?? cloud.latest?.id) === v.id;
          return (
            <div
              key={v.id}
              className={`border-b border-white/5 px-3 py-2 ${current ? "bg-blue-900/20" : ""}`}
            >
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium">
                  v{v.number}
                  {v.id === cloud.latest?.id && (
                    <span className="ml-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      latest
                    </span>
                  )}
                </span>
                <span
                  className="text-xs text-zinc-500"
                  title={new Date(v.createdAt).toLocaleString()}
                >
                  {timeAgo(v.createdAt)}
                </span>
              </div>
              {v.message && <p className="mt-0.5 text-xs text-zinc-300">{v.message}</p>}
              <p className="mt-0.5 text-xs text-zinc-500">
                {v.author ?? "Unknown"} · {formatBytes(v.size)}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={!!busy || current}
                  className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:opacity-40"
                  onClick={() => openVersion(v)}
                >
                  {busy === v.id ? "Opening…" : current ? "Open now" : "Open"}
                </button>
                <button
                  type="button"
                  className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                  onClick={() =>
                    downloadVersion(cloud.projectId, v.id).catch((e) => setError(String(e)))
                  }
                >
                  Download
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
