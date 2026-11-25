"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useEditor, type Tool } from "@/stores/editor";
import { Explorer } from "./explorer";
import { InsertDialog } from "./insert-dialog";
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

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: "select", label: "Select", key: "1" },
  { tool: "move", label: "Move", key: "2" },
  { tool: "scale", label: "Scale", key: "3" },
  { tool: "rotate", label: "Rotate", key: "4" },
];

/** A button that opens a small menu below it; closes on outside click or after a choice. */
function Menu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" className={btn} disabled={disabled} onClick={() => setOpen(!open)}>
        {label} ▾
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 min-w-48 rounded-md border border-white/10 bg-zinc-900 p-1 shadow-xl"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-white/10 disabled:opacity-40"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function NumberInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-zinc-400">
      {label}
      <input
        type="number"
        min={0}
        step="any"
        className="w-14 rounded bg-white/5 px-1.5 py-1 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-blue-500"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
      />
    </label>
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
  const [inserting, setInserting] = useState(false);

  const hasSelection = s.selection.length > 0;

  // Offer to restore unsaved work from last time.
  useEffect(() => {
    useEditor.getState().checkAutosave();
  }, []);

  // Keyboard shortcuts (iPad with a keyboard too). Mostly Studio's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && key === "z") run(e.shiftKey ? st.redo : st.undo);
      else if (mod && key === "y") run(st.redo);
      else if (mod && key === "s") run(() => st.save());
      else if (mod && key === "c") run(st.copySelection);
      else if (mod && key === "v") run(() => st.paste(e.shiftKey));
      else if (mod && key === "d") run(st.duplicateSelection);
      else if (mod && key === "g") run(st.group);
      else if (mod && key === "u") run(st.ungroup);
      else if (mod && key === "i") run(() => st.editor && setInserting(true));
      else if (key === "delete" || key === "backspace") run(st.deleteSelection);
      else if (key === "escape") st.select(null);
      else if (!mod && key === "f") st.focusSelected();
      else {
        const tool = TOOLS.find((t) => t.key === key);
        if (tool) run(() => st.setTool(tool.tool));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        <Menu label="Save" disabled={!s.editor}>
          <MenuItem onClick={() => s.save("rbxl")}>Save as .rbxl (binary)</MenuItem>
          <MenuItem onClick={() => s.save("rbxlx")}>Save as .rbxlx (XML)</MenuItem>
          <MenuItem onClick={() => s.exportSelection("rbxm")} disabled={!hasSelection}>
            Export selection as .rbxm
          </MenuItem>
          <MenuItem onClick={() => s.exportSelection("rbxmx")} disabled={!hasSelection}>
            Export selection as .rbxmx
          </MenuItem>
        </Menu>
        <button type="button" className={btn} onClick={s.undo} disabled={!s.canUndo}>
          Undo
        </button>
        <button type="button" className={btn} onClick={s.redo} disabled={!s.canRedo}>
          Redo
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

      {s.editor && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-2 py-1.5">
          <div className="flex overflow-hidden rounded">
            {TOOLS.map((t) => (
              <button
                key={t.tool}
                type="button"
                title={`${t.label} (${t.key})`}
                className={`px-3 py-1.5 text-sm ${s.tool === t.tool ? "bg-blue-600/60" : "bg-white/10 hover:bg-white/20"}`}
                onClick={() => s.setTool(t.tool)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={toggleBtn(s.snap.enabled)}
            onClick={() => s.setSnap({ enabled: !s.snap.enabled })}
          >
            Snap
          </button>
          {s.snap.enabled && (
            <>
              <NumberInput
                label="Studs"
                value={s.snap.move}
                onChange={(move) => s.setSnap({ move })}
              />
              <NumberInput
                label="°"
                value={s.snap.rotate}
                onChange={(rotate) => s.setSnap({ rotate })}
              />
            </>
          )}

          <span className="mx-1 h-5 w-px bg-white/10" />

          <button type="button" className={btn} onClick={() => setInserting(true)}>
            Insert…
          </button>
          <button
            type="button"
            className={btn}
            onClick={s.duplicateSelection}
            disabled={!hasSelection}
          >
            Duplicate
          </button>
          <button
            type="button"
            className={btn}
            onClick={s.deleteSelection}
            disabled={!hasSelection}
          >
            Delete
          </button>
          <button type="button" className={btn} onClick={s.copySelection} disabled={!hasSelection}>
            Copy
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => s.paste()}
            disabled={s.clipboard.length === 0}
          >
            Paste
          </button>
          <button type="button" className={btn} onClick={s.group} disabled={!hasSelection}>
            Group
          </button>
          <button type="button" className={btn} onClick={s.ungroup} disabled={!hasSelection}>
            Ungroup
          </button>
          <button type="button" className={btn} onClick={s.focusSelected} disabled={!hasSelection}>
            Focus
          </button>

          <span className="mx-1 h-5 w-px bg-white/10" />

          {/* Touch helpers: no Shift/Ctrl keys on a tablet. */}
          <button
            type="button"
            title="Taps add to or remove from the selection"
            className={toggleBtn(s.multiSelect)}
            onClick={() => s.setMultiSelect(!s.multiSelect)}
          >
            Multi
          </button>
          <button
            type="button"
            title="Drag in the viewport to select with a box (Shift+drag on desktop)"
            className={toggleBtn(s.boxSelect)}
            onClick={() => s.setBoxSelect(!s.boxSelect)}
          >
            Box
          </button>
        </div>
      )}

      {s.restorable && (
        <div className="flex flex-wrap items-center gap-2 bg-blue-900/50 px-3 py-2 text-sm">
          <span>
            Unsaved work from <b>{s.restorable.fileName}</b> (
            {new Date(s.restorable.savedAt).toLocaleString()})
          </span>
          <button type="button" className={btn} onClick={s.restoreAutosave}>
            Restore
          </button>
          <button type="button" className={btn} onClick={s.dismissRestore}>
            Discard
          </button>
        </div>
      )}

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

      {inserting && <InsertDialog onClose={() => setInserting(false)} />}
    </div>
  );
}
