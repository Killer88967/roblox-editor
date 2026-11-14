"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useEditor } from "@/stores/editor";
import { Explorer } from "./explorer";
import { Properties } from "./properties";
import { Viewport } from "./viewport";

const btn =
  "rounded bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10";
const toggleBtn = (on: boolean) =>
  on ? "rounded bg-blue-600/60 px-3 py-1.5 text-sm hover:bg-blue-600/70" : btn;

// Inline beside the viewport on wide screens, overlaid on top of it on narrow ones.
const panel =
  "absolute inset-y-0 z-10 w-72 max-w-[85vw] bg-zinc-950/95 backdrop-blur lg:static lg:shrink-0 lg:bg-zinc-950";

const WIDE = "(min-width: 1024px)";

function useWideScreen() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

export function EditorShell() {
  const s = useEditor();
  const wide = useWideScreen();
  // null = follow screen size: panels open on wide screens, closed on narrow ones.
  const [explorerOverride, setExplorerOverride] = useState<boolean | null>(null);
  const [propertiesOverride, setPropertiesOverride] = useState<boolean | null>(null);
  const showExplorer = explorerOverride ?? wide;
  const showProperties = propertiesOverride ?? wide;
  const [dragging, setDragging] = useState(false);

  // Keyboard shortcuts (iPad with a keyboard too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const { undo, redo, focusSelected } = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && key === "f") {
        focusSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Temporary: proves ops + undo/redo work end to end.
  const addPart = () => {
    const root = s.rootId ? s.nodes.get(s.rootId) : undefined;
    const workspace = root?.children.find((id) => s.nodes.get(id)?.class === "Workspace");
    if (!workspace) return;
    const [id] = s.apply([{ type: "create", parent: workspace, class: "Part", name: "Part" }]);
    if (id) s.select(id);
  };

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 p-2">
        <button
          type="button"
          className={toggleBtn(showExplorer)}
          onClick={() => setExplorerOverride(!showExplorer)}
        >
          Explorer
        </button>
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
        <button type="button" className={btn} onClick={s.save} disabled={!s.editor}>
          Save
        </button>
        <button type="button" className={btn} onClick={s.undo} disabled={!s.canUndo}>
          Undo
        </button>
        <button type="button" className={btn} onClick={s.redo} disabled={!s.canRedo}>
          Redo
        </button>
        <button type="button" className={btn} onClick={s.focusSelected} disabled={!s.editor}>
          Focus
        </button>
        <button type="button" className={btn} onClick={addPart} disabled={!s.editor}>
          Add Part
        </button>
        <span className="ml-auto truncate text-sm text-zinc-400">{s.fileName}</span>
        <button
          type="button"
          className={toggleBtn(showProperties)}
          onClick={() => setPropertiesOverride(!showProperties)}
        >
          Properties
        </button>
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

      <main
        className="relative flex min-h-0 flex-1"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) s.openFile(file);
        }}
      >
        {showExplorer && (
          <aside className={`${panel} left-0 overflow-hidden border-r border-white/10`}>
            <Explorer />
          </aside>
        )}
        <section className="relative min-w-0 flex-1">
          <Viewport />
        </section>
        {showProperties && (
          <aside className={`${panel} right-0 overflow-y-auto border-l border-white/10`}>
            <Properties />
          </aside>
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10 text-sm">
            Drop a .rbxl / .rbxm / .rbxlx / .rbxmx file to open it
          </div>
        )}
      </main>
    </div>
  );
}
