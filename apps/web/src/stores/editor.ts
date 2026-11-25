import { create } from "zustand";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { loadWasm, WasmEditor } from "@/lib/wasm";
import { viewportApi } from "@/lib/viewport-api";
import type { JsOp, NodeInfo, RenderPart, SubtreeRender, Value } from "@/lib/types";

export type Tool = "select" | "move" | "scale" | "rotate";

export type Snap = {
  enabled: boolean;
  /** Studs per move step. */
  move: number;
  /** Degrees per rotate step. */
  rotate: number;
};

type Autosave = { fileName: string; savedAt: number; bytes: Uint8Array };

type EditorState = {
  editor: WasmEditor | null;
  fileName: string;
  rootId: string | null;
  nodes: Map<string, NodeInfo>;
  parts: Map<string, RenderPart>;
  /** Selected ids in click order; the last one is the primary (shown in Properties). */
  selection: string[];
  /** Explorer rows whose children are shown. */
  expanded: Set<string>;
  /** Bumped to ask the viewport to frame the selection. */
  focusRequest: number;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  tool: Tool;
  snap: Snap;
  /** Copied instances as binary models. */
  clipboard: Uint8Array[];
  /** Touch helpers: taps add to/remove from the selection; drags draw a selection box. */
  multiSelect: boolean;
  boxSelect: boolean;
  /** Unsaved work found from a previous visit, offered for restore. */
  restorable: { fileName: string; savedAt: number } | null;

  openFile: (file: File) => Promise<void>;
  newPlace: () => Promise<void>;
  /** Downloads the place. `ext` defaults to the current file's extension. */
  save: (ext?: "rbxl" | "rbxlx") => void;
  /** Downloads the selection as a model file. */
  exportSelection: (ext: "rbxm" | "rbxmx") => void;
  /** replace: just this; toggle: add/remove (Ctrl/Cmd); add: keep others (Shift). */
  select: (id: string | null, mode?: "replace" | "toggle" | "add") => void;
  selectMany: (ids: string[], additive?: boolean) => void;
  toggleExpanded: (id: string) => void;
  focusSelected: () => void;
  apply: (ops: JsOp[]) => string[];
  undo: () => void;
  redo: () => void;
  clearError: () => void;
  setTool: (tool: Tool) => void;
  setSnap: (snap: Partial<Snap>) => void;
  setMultiSelect: (on: boolean) => void;
  setBoxSelect: (on: boolean) => void;

  insert: (className: string) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  /** into: paste inside the primary selection; otherwise next to it. */
  paste: (into?: boolean) => void;
  group: () => void;
  ungroup: () => void;

  checkAutosave: () => Promise<void>;
  restoreAutosave: () => Promise<void>;
  dismissRestore: () => void;
};

const AUTOSAVE_KEY = "rbxe:autosave";
const AUTOSAVE_DELAY = 1500;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fresh(editor: WasmEditor, fileName: string) {
  editor.takeDirty();
  const nodes = new Map<string, NodeInfo>();
  for (const n of editor.nodes() as NodeInfo[]) nodes.set(n.id, n);
  const parts = new Map<string, RenderPart>();
  for (const p of editor.renderParts() as RenderPart[]) parts.set(p.id, p);
  const rootId = editor.rootId();
  const workspace = nodes.get(rootId)?.children.find((id) => nodes.get(id)?.class === "Workspace");
  return {
    editor,
    fileName,
    rootId,
    nodes,
    parts,
    selection: [],
    expanded: new Set(workspace ? [rootId, workspace] : [rootId]),
    canUndo: false,
    canRedo: false,
    error: null,
  };
}

export const useEditor = create<EditorState>()((set, get) => {
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleAutosave = () => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      const { editor, fileName } = get();
      if (!editor) return;
      try {
        const save: Autosave = { fileName, savedAt: Date.now(), bytes: editor.save("binary") };
        idbSet(AUTOSAVE_KEY, save).catch(() => {});
        // New work replaces whatever was offered for restore.
        set({ restorable: null });
      } catch {
        // Autosave is best-effort.
      }
    }, AUTOSAVE_DELAY);
  };

  /**
   * Pull what changed out of WASM. Untouched nodes and parts keep their object identity,
   * so React only re-renders what actually changed.
   */
  const sync = () => {
    const { editor, nodes, parts, selection } = get();
    if (!editor) return;
    const nextNodes = new Map(nodes);
    const nextParts = new Map(parts);

    const dropParts = (id: string) => {
      const stack = [id];
      while (stack.length) {
        const cur = stack.pop()!;
        nextParts.delete(cur);
        stack.push(...(nodes.get(cur)?.children ?? []));
      }
    };

    for (const id of editor.takeDirty()) {
      const before = nodes.get(id);
      const now = editor.node(id) as NodeInfo | undefined;
      if (!now) {
        // Deleted: forget it and everything that was drawn under it.
        nextNodes.delete(id);
        dropParts(id);
        continue;
      }
      nextNodes.set(id, now);

      if (!before || before.parent !== now.parent) {
        // New, restored, pasted or moved: refresh the whole subtree.
        const sub = editor.renderSubtree(id) as SubtreeRender;
        for (const sid of sub.ids) {
          nextParts.delete(sid);
          if (sid !== id) {
            const n = editor.node(sid) as NodeInfo | undefined;
            if (n) nextNodes.set(sid, n);
          }
        }
        for (const p of sub.parts) nextParts.set(p.id, p);
      } else {
        const part = editor.renderPart(id) as RenderPart | undefined;
        if (part) nextParts.set(id, part);
        else nextParts.delete(id);
      }
    }

    set({
      nodes: nextNodes,
      parts: nextParts,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
      selection: selection.filter((id) => nextNodes.has(id)),
    });
    scheduleAutosave();
  };

  const run = <T>(fn: (editor: WasmEditor) => T, fallback: T): T => {
    const { editor } = get();
    if (!editor) return fallback;
    try {
      const result = fn(editor);
      sync();
      return result;
    } catch (e) {
      set({ error: message(e) });
      return fallback;
    }
  };

  /** Selected ids without any whose ancestor is also selected. */
  const topLevel = () => {
    const { selection, nodes } = get();
    const chosen = new Set(selection);
    return selection.filter((id) => {
      for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) {
        if (chosen.has(p)) return false;
      }
      return true;
    });
  };

  /** Services (children of the DataModel) can't be deleted, moved or duplicated. */
  const isService = (id: string) => {
    const { nodes, rootId } = get();
    return id === rootId || nodes.get(id)?.parent === rootId;
  };

  const workspaceId = () => {
    const { nodes, rootId } = get();
    return rootId
      ? nodes.get(rootId)?.children.find((id) => nodes.get(id)?.class === "Workspace")
      : undefined;
  };

  /** Expand every ancestor so these rows are visible in the Explorer. */
  const reveal = (ids: string[]) => {
    const { nodes, expanded } = get();
    const next = new Set(expanded);
    for (const id of ids) {
      for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) next.add(p);
    }
    return next.size === expanded.size ? expanded : next;
  };

  const selectOnly = (ids: string[]) => set({ selection: ids, expanded: reveal(ids) });

  return {
    editor: null,
    fileName: "",
    rootId: null,
    nodes: new Map(),
    parts: new Map(),
    selection: [],
    expanded: new Set(),
    focusRequest: 0,
    canUndo: false,
    canRedo: false,
    error: null,
    tool: "select",
    snap: { enabled: true, move: 1, rotate: 15 },
    clipboard: [],
    multiSelect: false,
    boxSelect: false,
    restorable: null,

    async openFile(file) {
      await loadWasm();
      try {
        const editor = new WasmEditor(new Uint8Array(await file.arrayBuffer()));
        get().editor?.free();
        set(fresh(editor, file.name));
      } catch (e) {
        set({ error: `Couldn't open ${file.name}: ${message(e)}` });
      }
    },

    async newPlace() {
      await loadWasm();
      get().editor?.free();
      set(fresh(WasmEditor.empty(), "Untitled.rbxl"));
    },

    save(ext) {
      const { editor, fileName } = get();
      if (!editor) return;
      try {
        const current = /\.rbxlx$/i.test(fileName) ? "rbxlx" : "rbxl";
        const target = ext ?? current;
        const base = fileName.replace(/\.rbx[lm]x?$/i, "") || "Untitled";
        const name = `${base}.${target}`;
        download(editor.save(target === "rbxlx" ? "xml" : "binary"), name);
        set({ fileName: name });
        // Saved to disk, so there's nothing to recover anymore.
        clearTimeout(autosaveTimer);
        idbDel(AUTOSAVE_KEY).catch(() => {});
      } catch (e) {
        set({ error: message(e) });
      }
    },

    exportSelection(ext) {
      const { editor, nodes } = get();
      const ids = topLevel().filter((id) => !isService(id));
      if (!editor || ids.length === 0) return;
      try {
        const name = ids.length === 1 ? (nodes.get(ids[0])?.name ?? "Model") : "Selection";
        download(editor.export(ids, ext === "rbxmx" ? "xml" : "binary"), `${name}.${ext}`);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    select(id, mode = "replace") {
      if (!id) return set({ selection: [] });
      const { selection } = get();
      if (mode === "toggle") {
        const next = selection.includes(id)
          ? selection.filter((s) => s !== id)
          : [...selection, id];
        return set({ selection: next, expanded: reveal([id]) });
      }
      if (mode === "add") {
        return set({
          selection: [...selection.filter((s) => s !== id), id],
          expanded: reveal([id]),
        });
      }
      selectOnly([id]);
    },

    selectMany(ids, additive = false) {
      const base = additive ? get().selection.filter((id) => !ids.includes(id)) : [];
      selectOnly([...base, ...ids]);
    },

    toggleExpanded(id) {
      const next = new Set(get().expanded);
      if (!next.delete(id)) next.add(id);
      set({ expanded: next });
    },

    focusSelected: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
    apply: (ops) => run((ed) => ed.apply(ops), []),
    undo: () => run((ed) => ed.undo(), false),
    redo: () => run((ed) => ed.redo(), false),
    clearError: () => set({ error: null }),
    setTool: (tool) => set({ tool }),
    setSnap: (snap) => set((s) => ({ snap: { ...s.snap, ...snap } })),
    setMultiSelect: (multiSelect) => set({ multiSelect }),
    setBoxSelect: (boxSelect) => set({ boxSelect }),

    insert(className) {
      const { editor, selection } = get();
      if (!editor) return;
      const primary = selection.at(-1);
      const isPart = WasmEditor.isA(className, "BasePart");
      // Parts go into Workspace unless a non-part container is selected; other
      // classes go into whatever is selected (like Studio's Insert Object).
      const parent =
        primary && primary !== get().rootId && !(isPart && get().parts.has(primary))
          ? primary
          : workspaceId();
      if (!parent) return;

      const properties: Record<string, Value> = {};
      if (isPart) {
        const [x, y, z] = viewportApi.focusPoint();
        properties.CFrame = {
          type: "CFrame",
          value: {
            position: [x, y + 1, z],
            orientation: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
          },
        };
        // Studio anchors parts you insert while building.
        properties.Anchored = { type: "Bool", value: true };
      }

      const [id] = get().apply([
        { type: "create", parent, class: className, name: className, properties },
      ]);
      if (id) selectOnly([id]);
    },

    deleteSelection() {
      const ids = topLevel().filter((id) => !isService(id));
      if (ids.length === 0) return;
      get().apply(ids.map((target) => ({ type: "delete", target })));
    },

    duplicateSelection() {
      const { editor, nodes } = get();
      const ids = topLevel().filter((id) => !isService(id));
      if (!editor || ids.length === 0) return;
      try {
        const ops: JsOp[] = ids.map((id) => ({
          type: "paste",
          parent: nodes.get(id)!.parent!,
          model: editor.copy(id),
        }));
        const created = get().apply(ops);
        if (created.length) selectOnly(created);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    copySelection() {
      const { editor } = get();
      const ids = topLevel().filter((id) => !isService(id));
      if (!editor || ids.length === 0) return;
      try {
        set({ clipboard: ids.map((id) => editor.copy(id)) });
      } catch (e) {
        set({ error: message(e) });
      }
    },

    paste(into = false) {
      const { clipboard, selection, nodes, rootId } = get();
      if (clipboard.length === 0) return;
      const primary = selection.at(-1);
      let parent: string | undefined;
      if (primary && into) parent = primary;
      else if (primary) parent = nodes.get(primary)?.parent;
      if (!parent || parent === rootId) parent = workspaceId();
      if (!parent) return;
      const target = parent;
      const created = get().apply(
        clipboard.map((model) => ({ type: "paste", parent: target, model })),
      );
      if (created.length) selectOnly(created);
    },

    group() {
      const { nodes } = get();
      const ids = topLevel().filter((id) => !isService(id));
      if (ids.length === 0) return;
      const parent = nodes.get(ids[0])?.parent;
      if (!parent) return;
      const model = WasmEditor.newId();
      const created = get().apply([
        { type: "create", parent, class: "Model", name: "Model", id: model },
        ...ids.map((target): JsOp => ({ type: "reparent", target, parent: model })),
      ]);
      if (created.length) selectOnly([model]);
    },

    ungroup() {
      const { nodes } = get();
      const models = topLevel().filter((id) => nodes.get(id)?.class === "Model");
      if (models.length === 0) return;
      const ops: JsOp[] = [];
      const freed: string[] = [];
      for (const id of models) {
        const node = nodes.get(id)!;
        for (const child of node.children) {
          ops.push({ type: "reparent", target: child, parent: node.parent! });
          freed.push(child);
        }
        ops.push({ type: "delete", target: id });
      }
      get().apply(ops);
      selectOnly(freed);
    },

    async checkAutosave() {
      try {
        const saved = await idbGet<Autosave>(AUTOSAVE_KEY);
        if (saved && !get().editor) {
          set({ restorable: { fileName: saved.fileName, savedAt: saved.savedAt } });
        }
      } catch {
        // No IndexedDB (private mode etc.): nothing to restore.
      }
    },

    async restoreAutosave() {
      try {
        const saved = await idbGet<Autosave>(AUTOSAVE_KEY);
        if (!saved) return set({ restorable: null });
        await loadWasm();
        const editor = new WasmEditor(saved.bytes);
        get().editor?.free();
        set({ ...fresh(editor, saved.fileName), restorable: null });
      } catch (e) {
        set({ error: `Couldn't restore: ${message(e)}`, restorable: null });
      }
    },

    dismissRestore() {
      set({ restorable: null });
      idbDel(AUTOSAVE_KEY).catch(() => {});
    },
  };
});
