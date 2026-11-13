"use client";

import { useEditor } from "@/stores/editor";
import { Explorer } from "./explorer";
import { Properties } from "./properties";

const btn =
  "rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10";

export function EditorShell() {
  const s = useEditor();

  // Temporary: proves ops + undo/redo work end to end.
  const addPart = () => {
    const root = s.rootId ? s.nodes.get(s.rootId) : undefined;
    const workspace = root?.children.find(
      (id) => s.nodes.get(id)?.class === "Workspace",
    );
    if (!workspace) return;
    const [id] = s.apply([
      { type: "create", parent: workspace, class: "Part", name: "Part" },
    ]);
    if (id) s.select(id);
  };

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <label className={btn}>
          Open
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) s.openFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <button type="button" className={btn} onClick={s.newPlace}>
          New
        </button>
        <button
          type="button"
          className={btn}
          onClick={s.save}
          disabled={!s.editor}
        >
          Save
        </button>
        <button
          type="button"
          className={btn}
          onClick={s.undo}
          disabled={!s.canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          className={btn}
          onClick={s.redo}
          disabled={!s.canRedo}
        >
          Redo
        </button>
        <button
          type="button"
          className={btn}
          onClick={addPart}
          disabled={!s.editor}
        >
          Add Part
        </button>
        <span className="ml-auto truncate text-sm text-zinc-400">
          {s.fileName}
        </span>
      </header>

      {s.error && (
        <button
          type="button"
          onClick={s.clearError}
          className="bg-red-900/60 px-3 py-2 text-left text-sm"
        >
          {s.error} (tap to dismiss)
        </button>
      )}

      <main className="flex min-h-0 flex-1">
        <aside className="w-72 shrink-0 overflow-auto border-r border-white/10">
          <Explorer />
        </aside>
        <section className="flex flex-1 items-center justify-center text-sm text-zinc-600">
          Viewport (Phase 1)
        </section>
        <aside className="w-72 shrink-0 overflow-auto border-l border-white/10">
          <Properties />
        </aside>
      </main>
    </div>
  );
}
