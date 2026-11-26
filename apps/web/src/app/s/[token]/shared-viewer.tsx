"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { openShared } from "@/lib/cloud";
import { useEditor } from "@/stores/editor";
import { EditorShell } from "@/components/editor-shell";

/** A shared project, view-only, for anyone with the link. */
export function SharedViewer() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const shared = await openShared(token);
        if (!live) return;
        if (!shared.bytes) {
          setState({ error: `“${shared.name}” hasn't been saved yet.` });
          return;
        }
        await useEditor.getState().openBytes(shared.bytes, `${shared.name}.rbxl`, {
          projectId: "",
          name: shared.name,
          readOnly: true,
          shareToken: token,
          ownerShareToken: null,
          latest: shared.version,
          viewing: null,
        });
        if (live) setState("ready");
      } catch (e) {
        if (live) setState({ error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      live = false;
      useEditor.getState().closeCloud();
    };
  }, [token]);

  if (typeof state === "object") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-zinc-950 p-4 text-zinc-100">
        <p className="text-sm text-red-400">{state.error}</p>
        <Link href="/" className="rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
          Open the editor
        </Link>
      </div>
    );
  }
  return (
    <>
      <EditorShell />
      {state === "loading" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 text-sm text-zinc-300">
          Opening shared place…
        </div>
      )}
    </>
  );
}
