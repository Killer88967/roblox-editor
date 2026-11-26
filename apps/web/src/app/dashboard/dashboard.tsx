"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ProjectInfo } from "@/lib/cloud-types";
import {
  CloudError,
  createProject,
  deleteProject,
  listProjects,
  setPendingFile,
  updateProject,
} from "@/lib/cloud";
import { useSession } from "@/lib/auth-client";
import { AccountMenu } from "@/components/account-menu";
import { ShareDialog } from "@/components/share-dialog";
import { btn, dangerBtn, primaryBtn, timeAgo } from "@/components/ui";

/** The signed-in user's cloud projects: create, upload, open, rename, share, delete. */
export function Dashboard() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ProjectInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.replace("/login?next=/dashboard");
  }, [isPending, session, router]);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof CloudError && e.status === 401) router.replace("/login?next=/dashboard");
      else setError(e instanceof Error ? e.message : String(e));
    },
    [router],
  );

  useEffect(() => {
    if (session) listProjects().then(setProjects, onError);
  }, [session, onError]);

  const replace = (p: ProjectInfo) =>
    setProjects((list) => list?.map((x) => (x.id === p.id ? p : x)) ?? null);

  const create = async (name: string, file?: File) => {
    setBusy(true);
    try {
      const project = await createProject(name);
      if (file) setPendingFile(project.id, file);
      router.push(`/p/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
        <h1 className="mr-auto font-semibold">Your projects</h1>
        <Link href="/" className={btn}>
          Local editor
        </Link>
        <label className={`${btn} ${busy ? "pointer-events-none opacity-40" : ""}`}>
          Upload file
          <input
            type="file"
            accept=".rbxl,.rbxlx,.rbxm,.rbxmx,.zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void create(file.name.replace(/\.(rbx[lm]x?|zip)$/i, ""), file);
            }}
          />
        </label>
        <button
          type="button"
          className={primaryBtn}
          disabled={busy}
          onClick={() => {
            const name = prompt("Name for the new place", "Untitled place");
            if (name?.trim()) void create(name.trim());
          }}
        >
          New place
        </button>
        <AccountMenu />
      </header>

      <main className="p-4">
        {error && (
          <button
            type="button"
            className="mb-4 w-full rounded bg-red-900/60 px-3 py-2 text-left text-sm"
            onClick={() => setError(null)}
          >
            {error} (tap to dismiss)
          </button>
        )}
        {!projects && !error && <p className="text-sm text-zinc-500">Loading…</p>}
        {projects?.length === 0 && (
          <div className="mx-auto mt-16 max-w-sm text-center text-sm text-zinc-400">
            <p className="mb-4">
              No projects yet. Start a new place, or upload a .rbxl to keep it in the cloud.
            </p>
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
          {projects?.map((p) => (
            <div
              key={p.id}
              className="overflow-hidden rounded-lg border border-white/10 bg-zinc-900"
            >
              <Link href={`/p/${p.id}`} className="block aspect-video bg-zinc-800">
                {p.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-xs text-zinc-500">
                    {p.latestVersion ? "No preview" : "Not saved yet"}
                  </span>
                )}
              </Link>
              <div className="p-3">
                <Link href={`/p/${p.id}`} className="block truncate font-medium hover:underline">
                  {p.name}
                </Link>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {p.latestVersion ? `v${p.latestVersion.number} · ` : ""}
                  {timeAgo(p.updatedAt)}
                  {p.shareToken ? " · Shared" : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                    onClick={async () => {
                      const name = prompt("Rename project", p.name);
                      if (!name?.trim() || name.trim() === p.name) return;
                      try {
                        replace(await updateProject(p.id, { name: name.trim() }));
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
                    onClick={() => setSharing(p)}
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    className={`${dangerBtn} ml-auto px-2 py-1 text-xs`}
                    onClick={async () => {
                      if (
                        !confirm(`Delete “${p.name}” and all its versions? This can't be undone.`)
                      )
                        return;
                      try {
                        await deleteProject(p.id);
                        setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {sharing && (
        <ShareDialog
          project={sharing}
          onChange={(p) => {
            replace(p);
            setSharing(p);
          }}
          onClose={() => setSharing(null)}
        />
      )}
    </div>
  );
}
