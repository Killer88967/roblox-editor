import type { Monaco } from "@monaco-editor/react";
import { useEditor } from "@/stores/editor";
import { resolveChain } from "./luau-resolve";
import type { NodeInfo, PropertyInfo } from "./types";

const IDENT_ONLY = /^[A-Za-z_]\w*$/;

// The parts of Monaco's model/position types this file uses (Monaco loads from a CDN,
// so its full type package isn't installed).
type Position = { lineNumber: number; column: number };
type Range = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};
type Model = {
  uri: { path: string };
  getLineContent(line: number): string;
  getValueInRange(range: Range): string;
  getWordUntilPosition(position: Position): { startColumn: number; endColumn: number };
};

let registered = false;

/** Studio-style completions after `.`: an instance's children, then its properties. */
export function registerCompletions(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider("luau", {
    triggerCharacters: ["."],
    provideCompletionItems(model: Model, position: Position) {
      const scriptId = model.uri.path.match(/script-([0-9a-f]+)\.luau$/)?.[1];
      const { editor, nodes, rootId } = useEditor.getState();
      if (!scriptId || !editor || !rootId) return { suggestions: [] };

      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      // The chain right before the `.` being typed, e.g. `button.Parent.` -> `button.Parent`.
      const target = line.match(
        /([A-Za-z_]\w*(?:\s*(?:\.\s*[A-Za-z_]\w*|:\s*\w+\([^()]*\)|\[\s*["'][^"']+["']\s*\]))*)\s*\.\s*\w*$/,
      )?.[1];
      if (!target) return { suggestions: [] };

      const code = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const id = resolveChain(target, code, { nodes, rootId, scriptId });
      const node = id ? nodes.get(id) : undefined;
      if (!id || !node) return { suggestions: [] };

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const { Field, Property } = monaco.languages.CompletionItemKind;

      // Children first (what Studio shows at the top), then properties.
      const children = node.children
        .map((c) => nodes.get(c))
        // Names with spaces etc. need ["..."] syntax; leave those out for now.
        .filter((c): c is NodeInfo => !!c && IDENT_ONLY.test(c.name))
        .map((c) => ({
          label: c.name,
          kind: Field,
          detail: c.class,
          insertText: c.name,
          sortText: `0${c.name}`,
          range,
        }));
      const properties = (editor.properties(id) as PropertyInfo[])
        .filter((p) => !p.hidden)
        .map((p) => ({
          label: p.key,
          kind: Property,
          detail: p.value.type === "Enum" ? (p.enumItem ?? "Enum") : p.value.type,
          insertText: p.key,
          sortText: `1${p.key}`,
          range,
        }));
      const parent = node.parent
        ? [
            {
              label: "Parent",
              kind: Property,
              detail: nodes.get(node.parent)?.class,
              insertText: "Parent",
              sortText: "1Parent",
              range,
            },
          ]
        : [];

      return { suggestions: [...children, ...parent, ...properties] };
    },
  });
}
