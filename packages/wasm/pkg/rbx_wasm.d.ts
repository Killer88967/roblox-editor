/* tslint:disable */
/* eslint-disable */

export class WasmEditor {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Applies an array of ops as one undo step. Returns ids of created instances.
     */
    apply(ops: any): string[];
    canRedo(): boolean;
    canUndo(): boolean;
    static empty(): WasmEditor;
    /**
     * Items for an enum property's dropdown: [{ name, value }].
     */
    enumItems(id: string, key: string): any;
    constructor(bytes: Uint8Array | number[]);
    node(id: string): any;
    /**
     * Every instance as a flat list (for building the Explorer).
     */
    nodes(): any;
    properties(id: string): any;
    redo(): boolean;
    /**
     * Everything under Workspace that should be drawn.
     */
    renderParts(): any;
    rootId(): string;
    /**
     * format: "binary" (.rbxl/.rbxm) or "xml" (.rbxlx/.rbxmx)
     */
    save(format: string): Uint8Array;
    /**
     * Ids changed since the last call. If node(id) returns undefined, it was deleted.
     */
    takeDirty(): string[];
    undo(): boolean;
}

export function start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmeditor_free: (a: number, b: number) => void;
    readonly start: () => void;
    readonly wasmeditor_apply: (a: number, b: any) => [number, number, number, number];
    readonly wasmeditor_canRedo: (a: number) => number;
    readonly wasmeditor_canUndo: (a: number) => number;
    readonly wasmeditor_empty: () => number;
    readonly wasmeditor_enumItems: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly wasmeditor_new: (a: number, b: number) => [number, number, number];
    readonly wasmeditor_node: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_nodes: (a: number) => [number, number, number];
    readonly wasmeditor_properties: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditor_redo: (a: number) => [number, number, number];
    readonly wasmeditor_renderParts: (a: number) => [number, number, number];
    readonly wasmeditor_rootId: (a: number) => [number, number];
    readonly wasmeditor_save: (a: number, b: number, c: number) => [number, number, number, number];
    readonly wasmeditor_takeDirty: (a: number) => [number, number];
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
