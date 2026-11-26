"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CloudError, getProject, takePendingFile, versionBytes } from "@/lib/cloud";
import { useEditor } from "@/stores/editor";
import { EditorShell } from "@/components/editor-shell";

/** Just saved from the local editor (or a share link): the project is already open. */
function alreadyOpen(id: string) {
  const st = useEditor.getState();
  return st.cloud?.projectId === id && !!st.editor && !st.cloud.readOnly;
}

/** The editor for a cloud project: loads its latest version, then saves new ones. */
export function ProjectEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [state, setState] = useState<"loading" | "ready" | { error: string }>(() =>
    alreadyOpen(id) ? "ready" : "loading",
  );

  useEffect(() => {
    let live = true;
    if (alreadyOpen(id)) return;
    (async () => {
      try {
        const project = await getProject(id);
        if (!live) return;
        const cloud = {
          projectId: project.id,
          name: project.name,
          readOnly: false,
          shareToken: null,
          ownerShareToken: project.shareToken,
          latest: project.latestVersion,
          viewing: null,
        };
        const file = takePendingFile(id);
        if (project.latestVersion) {
          const bytes = await versionBytes(id, project.latestVersion.id);
          if (!live) return;
          await useEditor.getState().openBytes(bytes, `${project.name}.rbxl`, cloud);
        } else {
          await useEditor.getState().openEmptyCloud(cloud);
        }
        if (!live) return;
        setState("ready");
        if (file) {
          // Uploaded from the dashboard: open it in the project and save it as v1.
          await useEditor.getState().openFile(file);
          if (!useEditor.getState().error)
            await useEditor.getState().saveToCloud(`Uploaded ${file.name}`);
        } else {
          const after = project.latestVersion ? Date.parse(project.latestVersion.createdAt) : 0;
          await useEditor.getState().checkAutosave(after);
        }
      } catch (e) {
        if (!live) return;
        if (e instanceof CloudError && e.status === 401) {
          router.replace(`/login?next=/p/${id}`);
          return;
        }
        setState({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
    };
  }, [id, router]);

  if (typeof state === "object") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 p-4 text-zinc-100">
        <p className="text-sm text-red-400">{state.error}</p>
        <Link
          href="/dashboard"
          className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
        >
          Back to your projects
        </Link>
      </div>
    );
  }
  return (
    <>
      <EditorShell />
      {state === "loading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 text-sm text-zinc-300">
          Opening project…
        </div>
      )}
    </>
  );
}
