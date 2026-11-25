"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef } from "react";
import { useEditor } from "@/stores/editor";
import { registerLuau } from "@/lib/luau";
import { registerCompletions } from "@/lib/luau-complete";
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
  const codeRef = useRef<CodeEditor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The last source we committed or loaded, to tell our edits from outside ones. */
  const committed = useRef<string>("");

  const initial = useMemo(() => readSource(id), [id]);

  const commit = () => {
    clearTimeout(timer.current);
    const code = codeRef.current;
    if (!code) return;
    const text = code.getValue();
    if (text === committed.current) return;
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

  // Undo/redo (or anything else) changed the Source: show it, keeping Monaco's own undo.
  useEffect(() => {
    const code = codeRef.current;
    if (!code || !node) return;
    const source = readSource(id);
    if (source === committed.current) return;
    committed.current = source;
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

  const onMount: OnMount = (code, monaco) => {
    codeRef.current = code;
    committed.current = code.getValue();
    code.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      commit();
      useEditor.getState().save();
    });
    code.onDidBlurEditorText(() => commit());
  };

  return (
    <Editor
      // One Monaco model per script keeps each tab's cursor and undo history.
      path={`script-${id}.luau`}
      defaultLanguage="luau"
      defaultValue={initial}
      theme="vs-dark"
      beforeMount={(monaco) => {
        registerLuau(monaco);
        registerCompletions(monaco);
      }}
      onMount={onMount}
      onChange={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => commitRef.current(), COMMIT_DELAY);
      }}
      options={{
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 4,
        insertSpaces: false,
        automaticLayout: true,
        wordWrap: "on",
      }}
      loading={<div className="p-4 text-sm text-zinc-500">Loading editor…</div>}
    />
  );
}
