import init, { WasmEditor } from "@rbxe/wasm";

let ready: Promise<unknown> | null = null;

export function loadWasm() {
  ready ??= init();
  return ready;
}

export { WasmEditor };
