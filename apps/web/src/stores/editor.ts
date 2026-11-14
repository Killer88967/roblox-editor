import { create } from "zustand";
import { loadWasm, WasmEditor } from "@/lib/wasm";
import type { JsOp, NodeInfo, RenderPart } from "@/lib/types";

type EditorState = {
  editor: WasmEditor | null;
  fileName: string;
  rootId: string | null;
  nodes: Map<string, NodeInfo>;
  parts: RenderPart[];
  selectedId: string | null;
  /** Explorer rows whose children are shown. */
  expanded: Set<string>;
  /** Bumped to ask the viewport to frame the selection. */
  focusRequest: number;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  openFile: (file: File) => Promise<void>;
  newPlace: () => Promise<void>;
  save: () => void;
  select: (id: string | null) => void;
  toggleExpanded: (id: string) => void;
  focusSelected: () => void;
  apply: (ops: JsOp[]) => string[];
  undo: () => void;
  redo: () => void;
  clearError: () => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function fresh(editor: WasmEditor, fileName: string) {
  editor.takeDirty();
  const nodes = new Map<string, NodeInfo>();
  for (const n of editor.nodes() as NodeInfo[]) nodes.set(n.id, n);
  const rootId = editor.rootId();
  const workspace = nodes.get(rootId)?.children.find((id) => nodes.get(id)?.class === "Workspace");
  return {
    editor,
    fileName,
    rootId,
    nodes,
    parts: editor.renderParts() as RenderPart[],
    selectedId: null,
    expanded: new Set(workspace ? [rootId, workspace] : [rootId]),
    canUndo: false,
    canRedo: false,
    error: null,
  };
}

export const useEditor = create<EditorState>()((set, get) => {
  // Pull only the changed nodes out of WASM; untouched nodes keep their object identity.
  const sync = () => {
    const { editor, nodes, selectedId } = get();
    if (!editor) return;
    const next = new Map(nodes);
    for (const id of editor.takeDirty()) {
      const node = editor.node(id) as NodeInfo | undefined;
      if (node) next.set(id, node);
      else next.delete(id);
    }
    set({
      nodes: next,
      parts: editor.renderParts() as RenderPart[],
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
      selectedId: selectedId && next.has(selectedId) ? selectedId : null,
    });
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

  return {
    editor: null,
    fileName: "",
    rootId: null,
    nodes: new Map(),
    parts: [],
    selectedId: null,
    expanded: new Set(),
    focusRequest: 0,
    canUndo: false,
    canRedo: false,
    error: null,

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

    save() {
      const { editor, fileName } = get();
      if (!editor) return;
      try {
        const format = /\.rbx[lm]x$/i.test(fileName) ? "xml" : "binary";
        const blob = new Blob([new Uint8Array(editor.save(format))]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    select(id) {
      if (!id) return set({ selectedId: null });
      // Expand every ancestor so the row is visible in the Explorer.
      const { nodes, expanded } = get();
      const next = new Set(expanded);
      for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) next.add(p);
      set({ selectedId: id, expanded: next.size === expanded.size ? expanded : next });
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
  };
});
