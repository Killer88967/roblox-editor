"use client";

import { useState } from "react";
import type { ProjectInfo } from "@/lib/cloud-types";
import { shareUrl, updateProject } from "@/lib/cloud";
import { Modal } from "./modal";
import { btn, input, primaryBtn } from "./ui";

/** Turns view-only link sharing on/off for a project and copies the link. */
export function ShareDialog({
  project,
  onChange,
  onClose,
}: {
  project: Pick<ProjectInfo, "id" | "name" | "shareToken" | "latestVersion">;
  onChange: (p: ProjectInfo) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const link = project.shareToken ? shareUrl(project.shareToken) : null;

  const set = async (shared: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await updateProject(project.id, { shared }));
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Share “${project.name}”`} onClose={onClose}>
      <p className="mb-3 text-sm text-zinc-400">
        Anyone with the link can view the latest saved version in their browser and download it.
        They can&apos;t change your project.
      </p>
      {!project.latestVersion && (
        <p className="mb-3 rounded bg-amber-900/40 px-3 py-2 text-sm text-amber-200">
          Save the project first. The link shows the latest save.
        </p>
      )}
      {link ? (
        <>
          <div className="flex gap-2">
            <input className={input} readOnly value={link} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className={primaryBtn}
              onClick={async () => {
                await navigator.clipboard.writeText(link).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => set(true)}>
              New link
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => set(false)}>
              Stop sharing
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">A new link stops the old one from working.</p>
        </>
      ) : (
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => set(true)}>
          Create view-only link
        </button>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
