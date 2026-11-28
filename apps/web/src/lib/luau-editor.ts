import type { Monaco, OnMount } from "@monaco-editor/react";
import { useEditor } from "@/stores/editor";
import { analyze, type Problem } from "./luau-analyze";
import { diagnose } from "./luau-diagnostics";
import { treeFor, type Model } from "./luau-model";
import { typecheck, type TypeProblem } from "./luau-typecheck";
import { apiIfLoaded, loadApi } from "./roblox-api";

type CodeEditor = Parameters<OnMount>[0];

/** Diagnostics owner name for Monaco markers. */
export const MARKER_OWNER = "luau";
/** Markers from Luau's type checker (lib/luau-typecheck.ts). */
export const TYPE_MARKER_OWNER = "luau-types";

const DIAGNOSE_DELAY = 300;

/**
 * Hooks a script editor up to live diagnostics (squiggles that update as you type and when
 * the place changes) and Studio-style auto `end`: pressing Enter after `then`, `do` or
 * `function(...)` adds the matching `end` (or `end)` inside `Connect(function()`).
 * Returns a function that undoes it.
 */
export function attachLuauEditor(monaco: Monaco, code: CodeEditor) {
  const disposers: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checks = 0;

  /** Luau's type checker, in a worker; its results replace the last ones when they arrive. */
  const runTypes = (model: Model) => {
    const scriptId = model.uri.path.match(/script-([0-9a-f]+)\.luau$/)?.[1];
    if (!scriptId) return;
    const check = ++checks;
    void typecheck(scriptId, model.getValue()).then((problems) => {
      const current = code.getModel();
      if (check !== checks || !current || (current as unknown as Model) !== model) return;
      // Script Analysis already reports these (with quick fixes); don't show them twice.
      const own = monaco.editor.getModelMarkers({ resource: current.uri, owner: MARKER_OWNER });
      const covered = (p: TypeProblem) =>
        p.message.startsWith("Unknown global") ||
        own.some(
          (m: { startLineNumber: number; startColumn: number; endColumn: number }) =>
            m.startLineNumber === p.line && m.startColumn >= p.column && m.endColumn <= Math.max(p.endColumn, p.column + 1),
        );
      const markers = problems
        .filter((p) => !covered(p))
        .map((p) => ({
          severity: monaco.MarkerSeverity.Error,
          message: p.message,
          startLineNumber: p.line,
          startColumn: p.column,
          endLineNumber: p.endLine,
          endColumn: p.endLine === p.line ? Math.max(p.endColumn, p.column + 1) : p.endColumn,
          source: "Luau type checker",
        }));
      monaco.editor.setModelMarkers(current, TYPE_MARKER_OWNER, markers);
    });
  };

  const run = () => {
    const model = code.getModel() as unknown as Model | null;
    if (!model) return;
    const an = analyze(model.getValue());
    const problems = diagnose(an, treeFor(model), apiIfLoaded());
    const S = monaco.MarkerSeverity;
    const severity = { error: S.Error, warning: S.Warning, info: S.Info, hint: S.Hint };
    const tags = {
      unnecessary: monaco.MarkerTag.Unnecessary,
      deprecated: monaco.MarkerTag.Deprecated,
    };
    const markers = problems.map((p: Problem) => {
      const a = model.getPositionAt(p.s);
      const b = model.getPositionAt(Math.max(p.e, p.s + 1));
      return {
        severity: severity[p.severity],
        message: p.message,
        startLineNumber: a.lineNumber,
        startColumn: a.column,
        endLineNumber: b.lineNumber,
        endColumn: b.column,
        tags: p.tag ? [tags[p.tag]] : undefined,
        code: p.code && p.name ? `${p.code}:${p.name}` : p.code,
        source: "Script Analysis",
      };
    });
    monaco.editor.setModelMarkers(code.getModel()!, MARKER_OWNER, markers);
    runTypes(model);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, DIAGNOSE_DELAY);
  };

  run();
  // Member checks need the API data; rerun once it's in.
  void loadApi().then(schedule);
  // Renaming or moving instances changes what paths resolve to.
  disposers.push(useEditor.subscribe((s, prev) => s.nodes !== prev.nodes && schedule()));

  const content = code.onDidChangeModelContent((e) => {
    schedule();
    if (e.isUndoing || e.isRedoing || e.isFlush || e.changes.length !== 1) return;
    const change = e.changes[0];
    if (/^[a-z]$/.test(change.text)) {
      queueMicrotask(() => outdentCloser(code));
      return;
    }
    if (!/^\r?\n[ \t]*$/.test(change.text)) return;
    // Let Monaco finish handling the Enter before adding our edit.
    queueMicrotask(() => autoEnd(code));
  });
  disposers.push(() => content.dispose());

  return () => {
    clearTimeout(timer);
    for (const d of disposers) d();
    const model = code.getModel();
    if (model) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
      monaco.editor.setModelMarkers(model, TYPE_MARKER_OWNER, []);
    }
  };
}

/** Adds `end` after Enter on a line that opens a block, if the block isn't closed yet. */
function autoEnd(code: CodeEditor) {
  const model = code.getModel();
  const pos = code.getPosition();
  if (!model || !pos || pos.lineNumber < 2) return;
  const an = analyze(model.getValue());
  const prevLine = pos.lineNumber - 1;

  // The last token on the previous line must open a block.
  const lineEnd = model.getOffsetAt({
    lineNumber: prevLine,
    column: model.getLineMaxColumn(prevLine),
  });
  let k = an.toks.length - 1;
  while (k >= 0 && an.toks[k].s >= lineEnd) k--;
  const last = an.toks[k];
  if (!last || last.line !== prevLine) return;

  /** The `function` keyword whose parameter list ends at the `)` token p, or -1. */
  const functionBefore = (p: number) => {
    let j = an.match[p] - 1;
    while (j >= 0 && (an.toks[j].k === "name" || an.toks[j].v === "." || an.toks[j].v === ":")) j--;
    return an.toks[j]?.k === "kw" && an.toks[j].v === "function" ? j : -1;
  };

  let opener = -1;
  let closeParen = -1;
  if (last.k === "kw" && (last.v === "then" || last.v === "do")) {
    // The `if`/`for`/`while` this belongs to.
    for (let j = k; j >= 0 && an.toks[j].line >= prevLine - 5; j--) {
      const t = an.toks[j];
      if (t.k === "kw" && /^(if|elseif|for|while)$/.test(t.v) && !an.exprIf[j]) {
        opener = t.v === "elseif" ? -2 : j;
        break;
      }
    }
    if (last.v === "do" && opener === -1) opener = k;
  } else if (last.k === "op" && last.v === ")" && an.match[k] >= 0) {
    opener = functionBefore(k);
    // `Connect(function())` typed in full: the block goes before the last `)`.
    if (opener < 0 && an.toks[k - 1]?.v === ")" && an.match[k - 1] >= 0) {
      opener = functionBefore(k - 1);
      if (opener >= 0) closeParen = k;
    }
  }
  // `elseif … then` continues an existing block: nothing to close.
  if (opener < 0) return;

  const indent = model.getLineContent(prevLine).match(/^[ \t]*/)?.[0] ?? "";
  const lineIndent = (offset: number) =>
    model.getLineContent(model.getPositionAt(offset).lineNumber).match(/^[ \t]*/)?.[0] ?? "";
  // Already closed by an `end` at this indent (or deeper): nothing to add. An `end` that's
  // less indented belongs to an outer block, so this one still needs its own.
  const closer = an.match[opener];
  if (closer >= 0 && lineIndent(an.toks[closer].s).length >= indent.length) return;
  // The block already has a body below (indented deeper): it's being edited, not written.
  for (let l = pos.lineNumber + 1; l <= model.getLineCount(); l++) {
    const text = model.getLineContent(l);
    if (!text.trim()) continue;
    const lead = text.match(/^[ \t]*/)?.[0] ?? "";
    if (lead.length > indent.length && lead.startsWith(indent) && !/^\s*\)/.test(text)) return;
    break;
  }

  // Re-insert the new line's indentation ourselves: Monaco trims indentation it added on
  // Enter once the cursor leaves the line, which our edit would otherwise cause.
  let before = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1);
  // Monaco outdents a new line that starts with `)`: indent the body one level ourselves.
  if (!before.trim() && before.length <= indent.length) {
    const { insertSpaces, indentSize } = model.getOptions();
    before = indent + (insertSpaces ? " ".repeat(indentSize) : "\t");
  }
  const cursor = { lineNumber: pos.lineNumber, column: before.length + 1 };
  const edits = [
    {
      range: {
        startLineNumber: pos.lineNumber,
        startColumn: 1,
        endLineNumber: pos.lineNumber,
        endColumn: pos.column,
      },
      text: `${before}\n${indent}end${closeParen >= 0 ? ")" : ""}`,
    },
  ];
  if (closeParen >= 0) {
    // Move the `)` from the end of the previous line to after the new `end`.
    const p = model.getPositionAt(an.toks[closeParen].s);
    edits.unshift({
      range: {
        startLineNumber: p.lineNumber,
        startColumn: p.column,
        endLineNumber: p.lineNumber,
        endColumn: p.column + 1,
      },
      text: "",
    });
  }
  code.executeEdits("luau-auto-end", edits);
  code.setPosition(cursor);
}

/** Typing `end`/`else`/`elseif`/`until` at the start of a line moves it to the block's indent. */
function outdentCloser(code: CodeEditor) {
  const model = code.getModel();
  const pos = code.getPosition();
  if (!model || !pos) return;
  const text = model.getLineContent(pos.lineNumber);
  const word = text.trim();
  if (!/^(end|else|elseif|until)$/.test(word) || pos.column !== text.length + 1) return;
  const level = analyze(model.getValue()).indents[pos.lineNumber];
  if (level === null || level === undefined) return;
  const { insertSpaces, indentSize } = model.getOptions();
  const want = (insertSpaces ? " ".repeat(indentSize) : "\t").repeat(level);
  const leading = text.match(/^[ \t]*/)?.[0] ?? "";
  if (leading === want) return;
  code.executeEdits("luau-outdent", [
    {
      range: {
        startLineNumber: pos.lineNumber,
        startColumn: 1,
        endLineNumber: pos.lineNumber,
        endColumn: leading.length + 1,
      },
      text: want,
    },
  ]);
}
