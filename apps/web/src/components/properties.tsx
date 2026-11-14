"use client";

import { useMemo, useState } from "react";
import { useEditor } from "@/stores/editor";
import { formatValue, swatch, type PropertyInfo } from "@/lib/types";

export function Properties() {
  const editor = useEditor((s) => s.editor);
  const selectedId = useEditor((s) => s.selectedId);
  const node = useEditor((s) => (s.selectedId ? s.nodes.get(s.selectedId) : undefined));
  const [showHidden, setShowHidden] = useState(false);

  // `node` changes identity whenever that instance is dirtied, so this re-reads after edits.
  const all = useMemo(
    () => (editor && selectedId && node ? (editor.properties(selectedId) as PropertyInfo[]) : []),
    [editor, selectedId, node],
  );
  const props = showHidden ? all : all.filter((p) => !p.hidden);
  const hiddenCount = all.length - all.filter((p) => !p.hidden).length;

  if (!node) return <p className="p-3 text-sm text-zinc-500">Nothing selected</p>;

  return (
    <div className="text-sm">
      <div className="flex items-start gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{node.name}</div>
          <div className="text-xs text-zinc-500">{node.class}</div>
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
      <dl>
        {props.map((p) => {
          const color = swatch(p.value);
          return (
            <div
              key={p.key}
              className={`flex gap-2 border-b border-white/5 px-3 py-1 ${p.hidden ? "opacity-50" : ""}`}
            >
              <dt className="w-1/2 shrink-0 truncate text-zinc-400">{p.key}</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                {color && (
                  <span
                    className="size-3 shrink-0 rounded-sm border border-white/20"
                    style={{ background: color }}
                  />
                )}
                <span className="truncate">{p.enumItem ?? formatValue(p.value)}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
