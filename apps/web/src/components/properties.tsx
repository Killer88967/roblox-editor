"use client";

import { useMemo, useState } from "react";
import { isScriptClass, useEditor } from "@/stores/editor";
import type { PropertyInfo } from "@/lib/types";
import { PropertyEditor, TextField } from "./property-editor";

export function Properties() {
  const editor = useEditor((s) => s.editor);
  // Properties shows the primary (most recently clicked) selection.
  const selectedId = useEditor((s) => s.selection.at(-1));
  const count = useEditor((s) => s.selection.length);
  const node = useEditor((s) => {
    const id = s.selection.at(-1);
    return id ? s.nodes.get(id) : undefined;
  });
  const apply = useEditor((s) => s.apply);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState("");

  // `node` changes identity whenever that instance is dirtied, so this re-reads after edits.
  const all = useMemo(
    () => (editor && selectedId && node ? (editor.properties(selectedId) as PropertyInfo[]) : []),
    [editor, selectedId, node],
  );
  const isScript = isScriptClass(node?.class);
  const query = filter.trim().toLowerCase();
  const props = all.filter(
    (p) =>
      (showHidden || !p.hidden) &&
      // Scripts are edited in their own tab, not as a one-line field.
      !(isScript && p.key === "Source") &&
      (!query || p.key.toLowerCase().includes(query)),
  );
  const hiddenCount = all.length - all.filter((p) => !p.hidden).length;

  if (!node) return <p className="p-3 text-sm text-zinc-500">Nothing selected</p>;

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <TextField
            key={node.name}
            initial={node.name}
            onCommit={(name) => {
              if (!name.trim()) return false;
              apply([{ type: "setName", target: node.id, name }]);
              return true;
            }}
          />
          <div className="mt-0.5 px-1.5 text-xs text-zinc-500">
            {node.class}
            {count > 1 && ` · ${count} selected`}
          </div>
        </div>
        {hiddenCount > 0 && (
          <label className="ml-auto flex shrink-0 items-center gap-1 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Hidden ({hiddenCount})
          </label>
        )}
      </div>
      <div className="flex gap-2 border-b border-white/10 px-3 py-1.5">
        <input
          className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Filter properties…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {isScript && (
          <button
            type="button"
            className="shrink-0 rounded bg-blue-600/60 px-2 py-1 text-sm hover:bg-blue-600/70"
            onClick={() => useEditor.getState().openScript(node.id)}
          >
            Edit script
          </button>
        )}
      </div>
      <dl>
        {props.map((p) => (
          <div
            key={p.key}
            className={`flex items-center gap-2 border-b border-white/5 px-3 py-1 ${p.hidden ? "opacity-50" : ""}`}
          >
            <dt className="w-2/5 shrink-0 truncate text-zinc-400">{p.key}</dt>
            <dd className="flex min-w-0 flex-1 items-center">
              <PropertyEditor id={node.id} prop={p} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
