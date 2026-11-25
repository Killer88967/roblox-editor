import { useEditor } from "@/stores/editor";
import { analyze } from "./luau-analyze";
import type { Tree } from "./luau-resolve";
import type { PropertyInfo } from "./types";

// The parts of Monaco's types the Luau providers use (Monaco loads from a CDN, so its full
// type package isn't installed).
export type Position = { lineNumber: number; column: number };
export type Range = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};
export type Word = { word: string; startColumn: number; endColumn: number };
export type Model = {
  uri: { path: string };
  getValue(): string;
  getLineCount(): number;
  getLineContent(line: number): string;
  getValueInRange(range: Range): string;
  getWordUntilPosition(position: Position): Word;
  getWordAtPosition(position: Position): Word | null;
  getOffsetAt(position: Position): number;
  getPositionAt(offset: number): Position;
};

/** A script's Source from the open document. */
export function scriptSource(id: string) {
  const { editor } = useEditor.getState();
  const props = (editor?.properties(id) ?? []) as PropertyInfo[];
  const source = props.find((p) => p.key === "Source")?.value;
  return source?.type === "String" ? source.value : "";
}

/** The place tree, from the point of view of the script a model belongs to. */
export function treeFor(model: Model): Tree | null {
  const scriptId = model.uri.path.match(/script-([0-9a-f]+)\.luau$/)?.[1];
  const { nodes, rootId } = useEditor.getState();
  if (!scriptId || !rootId) return null;
  return { nodes, rootId, scriptId, source: scriptSource };
}

/** The analysis of a model's current text. */
export const analysisOf = (model: Model) => analyze(model.getValue());

/** An offset range as a Monaco range. */
export function rangeOf(model: Model, s: number, e: number): Range {
  const a = model.getPositionAt(s);
  const b = model.getPositionAt(e);
  return {
    startLineNumber: a.lineNumber,
    startColumn: a.column,
    endLineNumber: b.lineNumber,
    endColumn: b.column,
  };
}
