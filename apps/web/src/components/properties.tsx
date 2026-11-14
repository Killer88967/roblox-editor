"use client";

import { useMemo } from "react";
import { useEditor } from "@/stores/editor";
import { formatValue, type PropertyInfo } from "@/lib/types";

export function Properties() {
  const editor = useEditor((s) => s.editor);
  const selectedId = useEditor((s) => s.selectedId);
  const node = useEditor((s) => (s.selectedId ? s.nodes.get(s.selectedId) : undefined));

  // `node` changes identity whenever that instance is dirtied, so this re-reads after edits.
  const props = useMemo(
    () => (editor && selectedId && node ? (editor.properties(selectedId) as PropertyInfo[]) : []),
    [editor, selectedId, node],
  );

  if (!node) return <p className="p-3 text-sm text-zinc-500">Nothing selected</p>;

  return (
    <div className="text-sm">
      <div className="border-b border-white/10 px-3 py-2">
        <div className="font-medium">{node.name}</div>
        <div className="text-xs text-zinc-500">{node.class}</div>
      </div>
      <dl>
        {props.map((p) => (
          <div key={p.key} className="flex gap-2 border-b border-white/5 px-3 py-1">
            <dt className="w-1/2 shrink-0 truncate text-zinc-400">{p.key}</dt>
            <dd className="truncate">{formatValue(p.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
