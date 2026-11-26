"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { quickSave, useEditor, type Tool } from "@/stores/editor";
import { useAccountSession } from "@/lib/auth-client";
import { ACCOUNTS_ENABLED } from "@/lib/features";
import { AccountMenu } from "./account-menu";
import { Explorer } from "./explorer";
import { HistoryPanel } from "./history-panel";
import { ShareDialog } from "./share-dialog";
import { btn, primaryBtn } from "./ui";
import { InsertDialog } from "./insert-dialog";
import { Properties } from "./properties";
import { Viewport } from "./viewport";

// Monaco only runs in the browser, and is only needed once a script is opened.
const ScriptEditor = dynamic(() => import("./script-editor").then((m) => m.ScriptEditor), {
  ssr: false,
});

function TabBar() {
  const openScripts = useEditor((s) => s.openScripts);
  const activeTab = useEditor((s) => s.activeTab);
  const nodes = useEditor((s) => s.nodes);
  const setActiveTab = useEditor((s) => s.setActiveTab);
  const closeScript = useEditor((s) => s.closeScript);
  const tab = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 border-r border-white/10 px-3 py-1.5 text-sm ${
      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-white/5"
    }`;

  return (
    <div className="flex overflow-x-auto border-b border-white/10 bg-zinc-950">
      <button type="button" className={tab(activeTab === null)} onClick={() => setActiveTab(null)}>
        3D View
      </button>
      {openScripts.map((id) => (
        <div key={id} className={tab(activeTab === id)}>
          <button type="button" onClick={() => setActiveTab(id)}>
            {nodes.get(id)?.name ?? "Script"}
          </button>
          <button
            type="button"
            aria-label="Close"
            className="rounded px-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            onClick={() => closeScript(id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

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
  // The Explorer also opens while renaming, since that's where the name box is.
  const showExplorer = (explorerOverride ?? wide) || !!s.renaming;
  const showProperties = propertiesOverride ?? wide;
  const [dragging, setDragging] = useState(false);
  const [inserting, setInserting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [sharing, setSharing] = useState(false);
  const router = useRouter();
  const { data: session } = useAccountSession();

  const hasSelection = s.selection.length > 0;
  const cloud = s.cloud;
  const readOnly = !!cloud?.readOnly;
  const editable = !!cloud && !readOnly;

  // Roblox images (decals, textures) load through the server for signed-in users and
  // share-link viewers.
  useEffect(() => {
    useEditor.getState().setAssetsEnabled(!!session || !!cloud?.shareToken);
  }, [session, cloud?.shareToken]);

  // Warn before leaving a cloud project with changes that aren't saved yet.
  useEffect(() => {
    if (!editable || !s.unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editable, s.unsaved]);

  /** Saves what's open as a new cloud project (also "Make a copy" on share links). */
  const saveAsProject = async () => {
    if (!session) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const base = s.fileName.replace(/\.rbx[lm]x?$/i, "") || "Untitled place";
    const name = prompt("Name for the new project", readOnly ? `${cloud?.name} (copy)` : base);
    if (!name?.trim()) return;
    const id = await useEditor.getState().saveAsNewProject(name.trim());
    if (id) router.push(`/p/${id}`);
  };

  const status = s.cloudSaving
    ? "Saving…"
    : s.unsaved
      ? "Unsaved changes"
      : cloud?.viewing
        ? `Viewing v${cloud.viewing.number}`
        : cloud?.latest
          ? `Saved · v${cloud.latest.number}`
          : "Not saved yet";

  // Offer to restore unsaved work from last time.
  useEffect(() => {
    useEditor.getState().checkAutosave();
  }, []);

  // Keyboard shortcuts (iPad with a keyboard too). Mostly Studio's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Typing in a field or the script editor (Monaco may not use a textarea) is not a shortcut.
      if (target?.closest("input, textarea, select, [contenteditable], .monaco-editor")) return;
      const st = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && key === "z") run(e.shiftKey ? st.redo : st.undo);
      else if (mod && key === "y") run(st.redo);
      else if (mod && key === "s") run(quickSave);
      else if (mod && key === "c") run(st.copySelection);
      else if (mod && key === "v") run(() => st.paste(e.shiftKey));
      else if (mod && key === "d") run(st.duplicateSelection);
      else if (mod && key === "g") run(st.group);
      else if (mod && key === "u") run(st.ungroup);
      else if (mod && key === "i") run(() => st.editor && setInserting(true));
      else if (key === "f2") run(() => st.startRename());
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
        {editable && (
          <Link href="/dashboard" className={btn}>
            Projects
          </Link>
        )}
        {!readOnly && (
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
        )}
        {!cloud && (
          <button type="button" className={btn} onClick={s.newPlace}>
            New
          </button>
        )}
        <Menu label={editable ? "File" : "Save"} disabled={!s.editor}>
          {editable && (
            <>
              <MenuItem onClick={() => s.saveToCloud()}>Save version (Ctrl+S)</MenuItem>
              <MenuItem
                onClick={() => {
                  const note = prompt("What changed? (shown in version history)");
                  if (note !== null) s.saveToCloud(note.trim() || undefined);
                }}
              >
                Save version with a note…
              </MenuItem>
            </>
          )}
          {!cloud && ACCOUNTS_ENABLED && (
            <MenuItem onClick={saveAsProject}>Save to your projects…</MenuItem>
          )}
          {readOnly && <MenuItem onClick={saveAsProject}>Make a copy in your projects…</MenuItem>}
          <MenuItem onClick={() => s.save("rbxl")}>Download .rbxl (binary)</MenuItem>
          <MenuItem onClick={() => s.save("rbxlx")}>Download .rbxlx (XML)</MenuItem>
          <MenuItem onClick={() => s.exportSelection("rbxm")} disabled={!hasSelection}>
            Export selection as .rbxm
          </MenuItem>
          <MenuItem onClick={() => s.exportSelection("rbxmx")} disabled={!hasSelection}>
            Export selection as .rbxmx
          </MenuItem>
          <MenuItem onClick={s.exportRojo}>Export Rojo project (.zip)</MenuItem>
        </Menu>
        {!readOnly && (
          <>
            <button type="button" className={btn} onClick={s.undo} disabled={!s.canUndo}>
              Undo
            </button>
            <button type="button" className={btn} onClick={s.redo} disabled={!s.canRedo}>
              Redo
            </button>
          </>
        )}
        <span className="ml-auto flex min-w-0 items-center gap-2 text-sm">
          {!readOnly && (
            <span className="truncate text-zinc-300">{cloud ? cloud.name : s.fileName}</span>
          )}
          {editable && (
            <span className={`shrink-0 text-xs ${s.unsaved ? "text-amber-400" : "text-zinc-500"}`}>
              {status}
            </span>
          )}
        </span>
        {editable && (
          <>
            <button
              type="button"
              className={primaryBtn}
              disabled={s.cloudSaving || (!s.unsaved && !cloud?.viewing && !!cloud?.latest)}
              onClick={() => s.saveToCloud()}
            >
              {s.cloudSaving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={toggleBtn(showHistory)}
              onClick={() => setShowHistory(!showHistory)}
            >
              History
            </button>
            <button type="button" className={btn} onClick={() => setSharing(true)}>
              Share
            </button>
          </>
        )}
        <button
          type="button"
          className={toggleBtn(showProperties && !showHistory)}
          onClick={() => {
            setShowHistory(false);
            setPropertiesOverride(showHistory ? true : !showProperties);
          }}
        >
          Properties
        </button>
        <AccountMenu />
      </header>

      {readOnly && cloud && (
        <div className="flex flex-wrap items-center gap-2 bg-zinc-800 px-3 py-2 text-sm">
          <span>
            <b>{cloud.name}</b>
            {cloud.latest && <span className="text-zinc-400"> · v{cloud.latest.number}</span>}
            <span className="text-zinc-400"> · View only</span>
          </span>
          <button type="button" className={`${primaryBtn} ml-auto`} onClick={saveAsProject}>
            {session ? "Make a copy" : "Sign in to make a copy"}
          </button>
          <button type="button" className={btn} onClick={() => s.save("rbxl")}>
            Download
          </button>
        </div>
      )}

      {s.editor && !readOnly && (
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
            title="Rename (F2, or double-click in the Explorer)"
            className={btn}
            onClick={() => s.startRename()}
            disabled={!hasSelection}
          >
            Rename
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
        <section className="relative flex min-w-0 flex-1 flex-col">
          {s.openScripts.length > 0 && <TabBar />}
          <div className="relative min-h-0 flex-1">
            {/* The 3D view stays mounted under script tabs so the camera keeps its place. */}
            <Viewport />
            {s.activeTab && (
              <div className="absolute inset-0 z-5 bg-[#1e1e1e]">
                <ScriptEditor key={s.activeTab} id={s.activeTab} />
              </div>
            )}
          </div>
        </section>
        {showHistory && editable ? (
          <aside className={`${panel} right-0 overflow-hidden border-l border-white/10`}>
            <HistoryPanel onClose={() => setShowHistory(false)} />
          </aside>
        ) : (
          showProperties && (
            <aside className={`${panel} right-0 overflow-y-auto border-l border-white/10`}>
              <Properties />
            </aside>
          )
        )}

        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-blue-500 bg-blue-500/10 text-sm">
            Drop a .rbxl / .rbxm / .rbxlx / .rbxmx file, or a Rojo project .zip, to open it
          </div>
        )}
      </main>

      {inserting && <InsertDialog onClose={() => setInserting(false)} />}
      {sharing && cloud && (
        <ShareDialog
          project={{
            id: cloud.projectId,
            name: cloud.name,
            shareToken: cloud.ownerShareToken,
            latestVersion: cloud.latest,
          }}
          onChange={(p) => useEditor.getState().setCloudProject(p)}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}
