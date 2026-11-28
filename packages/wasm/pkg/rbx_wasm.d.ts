/* tslint:disable */
/* eslint-disable */

export class WasmEditor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies an array of ops as one undo step. Returns ids of created instances.
     */
    apply(ops: any): string[];
    /**
     * An instance's attributes as `{ name: Value }` (types the editor can't show are skipped).
     */
    attributes(id: string): any;
    canRedo(): boolean;
    canUndo(): boolean;
    /**
     * The class and its base classes, most specific first ([] for unknown classes).
     */
    static classChain(_class: string): string[];
    clearHistory(): void;
    /**
     * One instance (and its descendants) as a binary model, for the clipboard.
     * Paste it back with a `{ type: "paste", parent, model }` op.
     */
    copy(id: string): Uint8Array;
    static empty(): WasmEditor;
    /**
     * Items of an enum by its name, e.g. "EasingStyle" (undefined for unknown enums).
     */
    static enumByName(name: string): any;
    /**
     * Items for an enum property's dropdown: [{ name, value }].
     */
    enumItems(id: string, key: string): any;
    /**
     * Just these instances as a model file (.rbxm / .rbxmx).
     */
    export(ids: string[], format: string): Uint8Array;
    /**
     * A copy of the place with the same instance ids and no undo history.
     */
    fork(): WasmEditor;
    /**
     * Builds a place from Rojo project files: `{ "default.project.json": bytes, "src/...": bytes }`.
     * Anything skipped is reported by `takeWarnings()`.
     */
    static fromRojo(files: any): WasmEditor;
    /**
     * Class names for Insert Object, sorted.
     */
    static insertableClasses(): string[];
    /**
     * Mirrors `Instance:IsA` for class names, e.g. `isA("SpawnLocation", "BasePart")`.
     */
    static isA(_class: string, ancestor: string): boolean;
    /**
     * Whether a class is a service (e.g. "TweenService"), for game:GetService.
     */
    static isServiceClass(_class: string): boolean;
    /**
     * Lighting service summary for the viewport (ambient, sun, fog, atmosphere).
     */
    lighting(): any;
    /**
     * A fresh id for a `create` op, so later ops in the same batch can target it.
     */
    static newId(): string;
    constructor(bytes: Uint8Array | number[]);
    node(id: string): any;
    /**
     * Every instance as a flat list (for building the Explorer).
     */
    nodes(): any;
    properties(id: string): any;
    /**
     * `{ enum, type, default }` for a property (searching base classes), or undefined.
     */
    static propertyMeta(_class: string, key: string): any;
    /**
     * One property's value, or undefined if the instance doesn't have it.
     */
    property(id: string, key: string): any;
    redo(): boolean;
    /**
     * One part's render data, or undefined if it shouldn't be drawn.
     */
    renderPart(id: string): any;
    /**
     * Everything under Workspace that should be drawn.
     */
    renderParts(): any;
    /**
     * `{ ids, parts }` for an instance and all its descendants.
     */
    renderSubtree(id: string): any;
    rootId(): string;
    /**
     * format: "binary" (.rbxl/.rbxm) or "xml" (.rbxlx/.rbxmx)
     */
    save(format: string): Uint8Array;
    /**
     * An instance's CollectionService tags.
     */
    tags(id: string): string[];
    /**
     * Ids changed since the last call. If node(id) returns undefined, it was deleted.
     */
    takeDirty(): string[];
    /**
     * Warnings from the last import, cleared once read.
     */
    takeWarnings(): string[];
    /**
     * The place as Rojo project files: `{ path: Uint8Array }`, ready to zip.
     */
    toRojo(project_name: string): any;
    undo(): boolean;
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmeditor_free: (a: number, b: number) => void;
    readonly start: () => void;
    readonly wasmeditor_apply: (a: number, b: any) => [number, number, number, number];
    readonly wasmeditor_attributes: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_canRedo: (a: number) => number;
    readonly wasmeditor_canUndo: (a: number) => number;
    readonly wasmeditor_classChain: (a: number, b: number) => [number, number];
    readonly wasmeditor_clearHistory: (a: number) => void;
    readonly wasmeditor_copy: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmeditor_empty: () => number;
    readonly wasmeditor_enumByName: (a: number, b: number) => [number, number, number];
    readonly wasmeditor_enumItems: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmeditor_export: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly wasmeditor_fork: (a: number) => number;
    readonly wasmeditor_fromRojo: (a: any) => [number, number, number];
    readonly wasmeditor_insertableClasses: () => [number, number];
    readonly wasmeditor_isA: (a: number, b: number, c: number, d: number) => number;
    readonly wasmeditor_isServiceClass: (a: number, b: number) => number;
    readonly wasmeditor_lighting: (a: number) => [number, number, number];
    readonly wasmeditor_new: (a: number, b: number) => [number, number, number];
    readonly wasmeditor_newId: () => [number, number];
    readonly wasmeditor_node: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_nodes: (a: number) => [number, number, number];
    readonly wasmeditor_properties: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_property: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmeditor_propertyMeta: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmeditor_redo: (a: number) => [number, number, number];
    readonly wasmeditor_renderPart: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_renderParts: (a: number) => [number, number, number];
    readonly wasmeditor_renderSubtree: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_rootId: (a: number) => [number, number];
    readonly wasmeditor_save: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmeditor_tags: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmeditor_takeDirty: (a: number) => [number, number];
    readonly wasmeditor_takeWarnings: (a: number) => [number, number];
    readonly wasmeditor_toRojo: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_undo: (a: number) => [number, number, number];
    readonly rust_zstd_wasm_shim_calloc: (a: number, b: number) => number;
    readonly rust_zstd_wasm_shim_free: (a: number) => void;
    readonly rust_zstd_wasm_shim_malloc: (a: number) => number;
    readonly rust_zstd_wasm_shim_memcmp: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memcpy: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memmove: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memset: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_qsort: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
