"use client";

import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { quickSave, useEditor } from "@/stores/editor";
import { registerLuau } from "@/lib/luau";
import { registerCompletions } from "@/lib/luau-complete";
import { attachLuauEditor, MARKER_OWNER } from "@/lib/luau-editor";
import { registerProviders } from "@/lib/luau-providers";
import { THEME } from "@/lib/luau-theme";
import type { PropertyInfo } from "@/lib/types";

/** Typing pauses this long before the source is committed (one undo step per pause). */
const COMMIT_DELAY = 800;

type CodeEditor = Parameters<OnMount>[0];

function readSource(id: string) {
  const { editor } = useEditor.getState();
  const props = (editor?.properties(id) ?? []) as PropertyInfo[];
  const source = props.find((p) => p.key === "Source")?.value;
  return source?.type === "String" ? source.value : "";
}

/** Monaco editor for one script's Source, with Luau highlighting. */
export function ScriptEditor({ id }: { id: string }) {
  const node = useEditor((s) => s.nodes.get(id));
  // While playing, the script shows the play copy's source and can't be edited.
  const playing = useEditor((s) => s.playing);
  const codeRef = useRef<CodeEditor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The last source we committed or loaded, to tell our edits from outside ones. */
  const committed = useRef<string>("");
  /**
   * The editor's current text, kept up to date on every change. Saving uses this rather
   * than asking Monaco: when a tab closes, Monaco may already have thrown its model away
   * and would report "", which used to save the script as empty.
   */
  const latest = useRef<string | null>(null);
  const [status, setStatus] = useState({ line: 1, column: 1, errors: 0, warnings: 0 });

  const initial = useMemo(() => readSource(id), [id]);

  const commit = () => {
    clearTimeout(timer.current);
    const text = latest.current;
    // Not loaded yet, or nothing changed.
    if (text === null || text === committed.current) return;
    // The script was deleted while open: nothing to save to.
    if (!useEditor.getState().nodes.has(id)) return;
    committed.current = text;
    useEditor
      .getState()
      .apply([
        { type: "setProperty", target: id, key: "Source", value: { type: "String", value: text } },
      ]);
  };

  // Save pending typing when the tab closes or switches.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => () => commitRef.current(), []);
  // Also save when the page is hidden (switching apps or tabs on iPad, closing the browser).
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") commitRef.current();
    };
    // Play saves open scripts before it copies the place.
    const flushNow = () => commitRef.current();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("rbxe:flush-scripts", flushNow);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("rbxe:flush-scripts", flushNow);
    };
  }, []);
  // Undo the diagnostics/auto-end hookup when the editor goes away.
  const detach = useRef<() => void>(undefined);
  useEffect(() => () => detach.current?.(), []);

  // Undo/redo (or anything else) changed the Source: show it, keeping Monaco's own undo.
  useEffect(() => {
    const code = codeRef.current;
    if (!code || !node) return;
    const source = readSource(id);
    if (source === committed.current) return;
    committed.current = source;
    latest.current = source;
    const model = code.getModel();
    if (model && model.getValue() !== source) {
      code.pushUndoStop();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: source }],
        () => null,
      );
      code.pushUndoStop();
    }
  }, [node, id]);

  const onMount: OnMount = (code, monaco: Monaco) => {
    codeRef.current = code;
    committed.current = code.getValue();
    latest.current = committed.current;
    code.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      commit();
      quickSave();
    });
    code.onDidBlurEditorText(() => commit());
    detach.current = attachLuauEditor(monaco, code);

    // Status strip: cursor position and problem counts.
    const countProblems = () => {
      const model = code.getModel();
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: MARKER_OWNER });
      const S = monaco.MarkerSeverity;
      setStatus((s) => ({
        ...s,
        errors: markers.filter((m: { severity: number }) => m.severity === S.Error).length,
        warnings: markers.filter((m: { severity: number }) => m.severity === S.Warning).length,
      }));
    };
    code.onDidChangeCursorPosition((e) =>
      setStatus((s) => ({ ...s, line: e.position.lineNumber, column: e.position.column })),
    );
    const markers = monaco.editor.onDidChangeMarkers((uris: readonly { toString(): string }[]) => {
      const uri = code.getModel()?.uri.toString();
      if (uris.some((u) => u.toString() === uri)) countProblems();
    });
    code.onDidDispose(() => markers.dispose());
    countProblems();
  };

  const run = (action: string) => {
    const code = codeRef.current;
    code?.focus();
    void code?.getAction(action)?.run();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Editor
          // One Monaco model per script keeps each tab's cursor and undo history.
          path={`script-${id}.luau`}
          defaultLanguage="luau"
          defaultValue={initial}
          theme={THEME}
          beforeMount={(monaco) => {
            registerLuau(monaco);
            registerCompletions(monaco);
            registerProviders(monaco);
          }}
          onMount={onMount}
          onChange={(value) => {
            latest.current = value ?? "";
            clearTimeout(timer.current);
            timer.current = setTimeout(() => commitRef.current(), COMMIT_DELAY);
          }}
          options={{
            fontSize: 13,
            fontFamily: '"SF Mono", Menlo, Monaco, Consolas, "Source Code Pro", monospace',
            fontLigatures: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 4,
            insertSpaces: false,
            automaticLayout: true,
            wordWrap: "on",
            "semanticHighlighting.enabled": false,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: "active", indentation: true },
            stickyScroll: { enabled: true },
            renderWhitespace: "selection",
            matchBrackets: "always",
            showFoldingControls: "always",
            colorDecorators: true,
            // Only our Color3 swatches, not CSS-style color detection.
            defaultColorDecorators: "never",
            // "full" applies the language's indentation rules when pressing Enter.
            autoIndent: "full",
            smoothScrolling: true,
            cursorBlinking: "smooth",
            fixedOverflowWidgets: true,
            readOnly: playing || !!useEditor.getState().cloud?.readOnly,
            quickSuggestions: { other: true, comments: false, strings: true },
            suggest: { preview: true, showStatusBar: true },
            suggestSelection: "first",
            // Our suggestions only (no "words from this file" fallback).
            wordBasedSuggestions: "off",
          }}
          loading={<div className="p-4 text-sm text-zinc-500">Loading editor…</div>}
        />
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-white/10 bg-zinc-950 px-2 text-[11px] text-zinc-400">
        <button
          type="button"
          onClick={() => run("editor.action.marker.next")}
          className="flex items-center gap-2 rounded px-1 hover:bg-white/5"
          title="Go to next problem (F8)"
        >
          <span className={status.errors ? "text-red-400" : undefined}>⊗ {status.errors}</span>
          <span className={status.warnings ? "text-orange-400" : undefined}>
            ⚠ {status.warnings}
          </span>
        </button>
        <button
          type="button"
          onClick={() => run("editor.action.formatDocument")}
          className="rounded px-1 hover:bg-white/5"
          title="Fix indentation (Shift+Alt+F)"
        >
          Format
        </button>
        <span className="ml-auto">
          Ln {status.line}, Col {status.column}
        </span>
        <span>Luau</span>
      </div>
    </div>
  );
}
