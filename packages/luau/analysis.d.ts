/** Roblox's API as Luau definitions (types/roblox.d.luau). */
export const robloxDefinitionsUrl: URL;

/** An instance in the place, for setPlace. */
export type PlaceNode = { id: string; parent?: string | null; class: string; name: string };

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
  /** Adds a definitions file (e.g. Roblox's API) before the first check. Returns its problems. */
  define(name: string, source: string): LuauDiagnostic[];
  /** Replaces the place's instance tree (root first, parents before children). */
  setPlace(nodes: PlaceNode[]): number;
  /** Sets a script's source (e.g. a ModuleScript others require) without checking it. */
  setSource(name: string, source: string): void;
  check(name: string, source: string): LuauDiagnostic[];
}
