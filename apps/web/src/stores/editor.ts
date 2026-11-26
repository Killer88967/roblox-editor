import { create } from "zustand";
import { unzipSync, zipSync } from "fflate";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { loadWasm, WasmEditor } from "@/lib/wasm";
import { viewportApi } from "@/lib/viewport-api";
import type { JsOp, LightingInfo, NodeInfo, RenderPart, SubtreeRender, Value } from "@/lib/types";
import type { ProjectInfo, VersionInfo } from "@/lib/cloud-types";
import { createProject, saveVersion } from "@/lib/cloud";
import { captureThumbnail } from "@/lib/thumbnail";

export type Tool = "select" | "move" | "scale" | "rotate";

/** The cloud project being edited (or viewed through a share link). */
export type CloudContext = {
  /** Empty for a share-link view. */
  projectId: string;
  name: string;
  /** Share-link views can't change or save anything. */
  readOnly: boolean;
  /** For share-link views: lets the viewer load Roblox assets. */
  shareToken: string | null;
  /** For the owner: the project's current share link token (null = not shared). */
  ownerShareToken: string | null;
  /** The project's latest saved version (null before the first save). */
  latest: VersionInfo | null;
  /** The version that was opened, when it isn't the latest (from History). */
  viewing: VersionInfo | null;
};

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
  /** Lighting service summary for the viewport. */
  lighting: LightingInfo | null;
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
  /** Scripts open in editor tabs, and the active tab (null = the 3D view). */
  openScripts: string[];
  activeTab: string | null;
  /** Unsaved work found from a previous visit, offered for restore. */
  restorable: { fileName: string; savedAt: number } | null;
  /** The instance being renamed in the Explorer (null when not renaming). */
  renaming: string | null;
  cloud: CloudContext | null;
  /** Changed since the last cloud save or load. */
  unsaved: boolean;
  cloudSaving: boolean;
  /** Whether the viewport may load Roblox assets through the server (signed in or shared). */
  assetsEnabled: boolean;

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
  /** Starts renaming an instance in the Explorer (default: the primary selection). */
  startRename: (id?: string) => void;
  /** Ends renaming: applies `name` if given and different, otherwise just stops. */
  finishRename: (name: string | null) => void;
  deleteSelection: () => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  /** into: paste inside the primary selection; otherwise next to it. */
  paste: (into?: boolean) => void;
  group: () => void;
  ungroup: () => void;
  /** Reparents instances (e.g. an Explorer drag). Selected ones move together. */
  moveInto: (ids: string[], parent: string) => void;
  /** Downloads the place as a Rojo project (.zip). */
  exportRojo: () => void;

  openScript: (id: string) => void;
  closeScript: (id: string) => void;
  setActiveTab: (id: string | null) => void;

  /** Opens place bytes (e.g. a cloud version) with an optional cloud context. */
  openBytes: (bytes: Uint8Array, fileName: string, cloud: CloudContext | null) => Promise<void>;
  /** Starts an empty place in a cloud project that has no saves yet. */
  openEmptyCloud: (cloud: CloudContext) => Promise<void>;
  /** Forgets the cloud project and the loaded place (going back to the local editor). */
  closeCloud: () => void;
  /** Saves the current place as a new version of the cloud project. */
  saveToCloud: (message?: string) => Promise<boolean>;
  /** Saves the current place as a new cloud project; returns its id. */
  saveAsNewProject: (name: string) => Promise<string | null>;
  setAssetsEnabled: (on: boolean) => void;
  /** Updates the cloud context after a rename etc. */
  setCloudProject: (project: ProjectInfo) => void;

  /** Offers unsaved work for restore. `newerThan` (ms) skips work older than a cloud save. */
  checkAutosave: (newerThan?: number) => Promise<void>;
  restoreAutosave: () => Promise<void>;
  dismissRestore: () => void;
};

/** Autosave slot: one for the local editor, one per cloud project. */
const autosaveKey = (projectId?: string) =>
  projectId ? `rbxe:autosave:${projectId}` : "rbxe:autosave";

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);
export const isScriptClass = (className: string | undefined) =>
  !!className && SCRIPT_CLASSES.has(className);
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
    lighting: editor.lighting() as LightingInfo,
    selection: [],
    expanded: new Set(workspace ? [rootId, workspace] : [rootId]),
    openScripts: [],
    activeTab: null,
    renaming: null,
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
      const { editor, fileName, cloud } = get();
      if (!editor || cloud?.readOnly) return;
      try {
        const save: Autosave = { fileName, savedAt: Date.now(), bytes: editor.save("binary") };
        idbSet(autosaveKey(cloud?.projectId), save).catch(() => {});
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

    const dirty = editor.takeDirty();
    // A part's look also depends on some children (SpecialMesh, Decal, Texture),
    // so when a child changes, redraw the part it belongs to.
    const touched = new Set(dirty);
    for (const id of dirty) {
      for (const parent of [
        nodes.get(id)?.parent,
        (editor.node(id) as NodeInfo | undefined)?.parent,
      ]) {
        if (parent && parts.has(parent)) touched.add(parent);
      }
    }

    for (const id of touched) {
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

    // Lighting is a handful of values; only replace it when something actually changed.
    const lighting = editor.lighting() as LightingInfo;
    const prevLighting = get().lighting;
    const sameLighting = JSON.stringify(lighting) === JSON.stringify(prevLighting);

    set({
      nodes: nextNodes,
      parts: nextParts,
      lighting: sameLighting ? prevLighting : lighting,
      canUndo: editor.canUndo(),
      canRedo: editor.canRedo(),
      selection: selection.filter((id) => nextNodes.has(id)),
      // Close tabs for scripts that were deleted.
      openScripts: get().openScripts.filter((id) => nextNodes.has(id)),
      activeTab: get().activeTab && nextNodes.has(get().activeTab!) ? get().activeTab : null,
      unsaved: true,
    });
    scheduleAutosave();
  };

  const run = <T>(fn: (editor: WasmEditor) => T, fallback: T): T => {
    const { editor, cloud } = get();
    // Share-link views are look-only.
    if (!editor || cloud?.readOnly) return fallback;
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
    lighting: null,
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
    openScripts: [],
    activeTab: null,
    restorable: null,
    renaming: null,
    cloud: null,
    unsaved: false,
    cloudSaving: false,
    assetsEnabled: false,

    async openFile(file) {
      await loadWasm();
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (/\.zip$/i.test(file.name)) {
          // A zipped Rojo project: default.project.json plus its source files.
          const files: Record<string, Uint8Array> = {};
          for (const [path, data] of Object.entries(unzipSync(bytes))) {
            if (!path.endsWith("/") && !path.startsWith("__MACOSX/")) files[path] = data;
          }
          const editor = WasmEditor.fromRojo(files);
          const warnings = editor.takeWarnings();
          get().editor?.free();
          set(fresh(editor, file.name.replace(/\.zip$/i, ".rbxl")));
          if (warnings.length) {
            const more = warnings.length > 3 ? ` (+${warnings.length - 3} more)` : "";
            set({ error: `Imported with warnings: ${warnings.slice(0, 3).join("; ")}${more}` });
          }
          return;
        }
        const editor = new WasmEditor(bytes);
        get().editor?.free();
        // Opening a file inside a cloud project replaces its contents until you save.
        set({ ...fresh(editor, file.name), unsaved: !!get().cloud });
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
        // Saved to disk, so there's nothing to recover anymore (cloud projects keep
        // their autosave until saved to the cloud).
        if (!get().cloud) {
          clearTimeout(autosaveTimer);
          idbDel(autosaveKey()).catch(() => {});
        }
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
      if (!id) return;
      selectOnly([id]);
      // Things like RemoteEvents and Folders are usually named right away, like
      // "ButtonEvent". Parts usually aren't, so they skip this.
      if (!isPart) set({ renaming: id });
    },

    startRename(id) {
      const target = id ?? get().selection.at(-1);
      // The DataModel itself can't be renamed.
      if (!target || target === get().rootId || get().cloud?.readOnly) return;
      if (!get().nodes.has(target)) return;
      set({ renaming: target, expanded: reveal([target]) });
    },

    finishRename(name) {
      const id = get().renaming;
      set({ renaming: null });
      if (!id || name === null) return;
      const trimmed = name.trim();
      if (trimmed && trimmed !== get().nodes.get(id)?.name) {
        get().apply([{ type: "setName", target: id, name: trimmed }]);
      }
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

    openScript(id) {
      const { openScripts, nodes } = get();
      if (!isScriptClass(nodes.get(id)?.class)) return;
      set({
        openScripts: openScripts.includes(id) ? openScripts : [...openScripts, id],
        activeTab: id,
      });
    },

    closeScript(id) {
      const { openScripts, activeTab } = get();
      const index = openScripts.indexOf(id);
      const next = openScripts.filter((s) => s !== id);
      set({
        openScripts: next,
        // Closing the active tab moves to its neighbor, or back to the 3D view.
        activeTab: activeTab === id ? (next[Math.min(index, next.length - 1)] ?? null) : activeTab,
      });
    },

    setActiveTab: (activeTab) => set({ activeTab }),

    moveInto(ids, parent) {
      const { nodes } = get();
      const chosen = new Set(ids);
      // Only move the outermost of the dragged instances; skip services and no-ops.
      const roots = ids.filter((id) => {
        for (let p = nodes.get(id)?.parent; p; p = nodes.get(p)?.parent) {
          if (chosen.has(p)) return false;
        }
        return id !== parent && !isService(id) && nodes.get(id)?.parent !== parent;
      });
      if (roots.length === 0) return;
      get().apply(roots.map((target) => ({ type: "reparent", target, parent })));
      set({ expanded: new Set([...get().expanded, parent]) });
    },

    exportRojo() {
      const { editor, fileName } = get();
      if (!editor) return;
      try {
        const base = fileName.replace(/\.rbx[lm]x?$/i, "") || "place";
        const files = editor.toRojo(base) as Record<string, Uint8Array>;
        // Put everything in a folder named after the project, like a repo checkout.
        const zipped: Record<string, Uint8Array> = {};
        for (const [path, data] of Object.entries(files)) zipped[`${base}/${path}`] = data;
        download(zipSync(zipped), `${base}.zip`);
      } catch (e) {
        set({ error: message(e) });
      }
    },

    async openBytes(bytes, fileName, cloud) {
      await loadWasm();
      try {
        const editor = new WasmEditor(bytes);
        get().editor?.free();
        set({ ...fresh(editor, fileName), cloud, unsaved: false, restorable: null });
        if (cloud?.readOnly) set({ tool: "select" });
      } catch (e) {
        set({ error: `Couldn't open ${fileName}: ${message(e)}` });
      }
    },

    async openEmptyCloud(cloud) {
      await loadWasm();
      get().editor?.free();
      set({
        ...fresh(WasmEditor.empty(), `${cloud.name}.rbxl`),
        cloud,
        unsaved: false,
        restorable: null,
      });
    },

    closeCloud() {
      if (!get().cloud) return;
      clearTimeout(autosaveTimer);
      get().editor?.free();
      set({
        editor: null,
        fileName: "",
        rootId: null,
        nodes: new Map(),
        parts: new Map(),
        lighting: null,
        selection: [],
        openScripts: [],
        activeTab: null,
        cloud: null,
        unsaved: false,
        restorable: null,
      });
    },

    async saveToCloud(msg) {
      const { editor, cloud, cloudSaving } = get();
      if (!editor || !cloud || cloud.readOnly || !cloud.projectId || cloudSaving) return false;
      set({ cloudSaving: true });
      try {
        const bytes = editor.save("binary");
        const thumbnail = await captureThumbnail().catch(() => null);
        const project = await saveVersion(cloud.projectId, bytes, thumbnail, msg);
        set({
          cloud: { ...cloud, name: project.name, latest: project.latestVersion, viewing: null },
          unsaved: false,
          cloudSaving: false,
          fileName: `${project.name}.rbxl`,
        });
        clearTimeout(autosaveTimer);
        idbDel(autosaveKey(cloud.projectId)).catch(() => {});
        return true;
      } catch (e) {
        set({ cloudSaving: false, error: `Couldn't save to the cloud: ${message(e)}` });
        return false;
      }
    },

    async saveAsNewProject(name) {
      const { editor } = get();
      if (!editor) return null;
      try {
        const project = await createProject(name);
        set({
          cloud: {
            projectId: project.id,
            name: project.name,
            readOnly: false,
            shareToken: null,
            ownerShareToken: null,
            latest: null,
            viewing: null,
          },
        });
        return (await get().saveToCloud("First save")) ? project.id : null;
      } catch (e) {
        set({ error: `Couldn't create the project: ${message(e)}` });
        return null;
      }
    },

    setAssetsEnabled(on) {
      if (get().assetsEnabled !== on) set({ assetsEnabled: on });
    },

    setCloudProject(project) {
      const { cloud } = get();
      if (!cloud || cloud.projectId !== project.id) return;
      set({
        cloud: {
          ...cloud,
          name: project.name,
          latest: project.latestVersion,
          ownerShareToken: project.shareToken,
        },
      });
    },

    async checkAutosave(newerThan) {
      const { cloud } = get();
      try {
        const saved = await idbGet<Autosave>(autosaveKey(cloud?.projectId));
        if (!saved) return;
        // Local editor: only when nothing's open. Cloud: when it's newer than the last save.
        const offer = cloud ? saved.savedAt > (newerThan ?? 0) : !get().editor;
        if (offer) set({ restorable: { fileName: saved.fileName, savedAt: saved.savedAt } });
      } catch {
        // No IndexedDB (private mode etc.): nothing to restore.
      }
    },

    async restoreAutosave() {
      const { cloud } = get();
      try {
        const saved = await idbGet<Autosave>(autosaveKey(cloud?.projectId));
        if (!saved) return set({ restorable: null });
        await loadWasm();
        const editor = new WasmEditor(saved.bytes);
        get().editor?.free();
        set({ ...fresh(editor, saved.fileName), restorable: null, unsaved: !!cloud });
      } catch (e) {
        set({ error: `Couldn't restore: ${message(e)}`, restorable: null });
      }
    },

    dismissRestore() {
      set({ restorable: null });
      idbDel(autosaveKey(get().cloud?.projectId)).catch(() => {});
    },
  };
});

/** Ctrl/Cmd+S: a new cloud version in a cloud project, otherwise a download. */
export function quickSave() {
  const st = useEditor.getState();
  if (st.cloud && !st.cloud.readOnly) void st.saveToCloud();
  else if (!st.cloud?.readOnly) st.save();
}
