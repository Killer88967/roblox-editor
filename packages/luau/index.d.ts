/** Compiles wasm/luau.wasm once. Pass the bytes in Node; the browser fetches it. */
export function loadLuau(bytes?: BufferSource): Promise<WebAssembly.Module>;

export type LuauOptions = {
  /** Answers the runtime's host calls: a JSON request in, a JSON reply out. */
  onHost: (message: string) => string;
  /** Anything the VM writes to stdout/stderr (the runtime replaces print). */
  onOutput?: (text: string) => void;
  /** The module's bytes (Node); the browser fetches it next to this file. */
  bytes?: BufferSource;
};

/** A Luau VM running the play-mode runtime (runtime/*.luau). */
export class LuauVM {
  static create(options: LuauOptions): Promise<LuauVM>;
  /** Sends a JSON message to the runtime and returns its JSON reply. Throws on errors. */
  send(message: string): string;
}
