/** Compiles wasm/analysis.wasm once. Pass the bytes in Node; the browser fetches it. */
export function loadAnalyzer(bytes?: BufferSource): Promise<WebAssembly.Module>;

/** One problem found by the type checker. Lines and columns start at 1. */
export type LuauDiagnostic = {
  line: number;
  column: number;
  endLine: number;
  /** Just past the end of the problem. */
  endColumn: number;
  message: string;
};

/** Luau's type checker. Modules stay loaded between checks. */
export class LuauAnalyzer {
  static create(options?: { bytes?: BufferSource }): Promise<LuauAnalyzer>;
  check(name: string, source: string): LuauDiagnostic[];
}
