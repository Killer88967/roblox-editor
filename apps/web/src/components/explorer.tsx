"use client";

import { useState } from "react";
import { useEditor } from "@/stores/editor";

function TreeNode({ id, depth }: { id: string; depth: number }) {
  const node = useEditor((s) => s.nodes.get(id));
  const selected = useEditor((s) => s.selectedId === id);
  const select = useEditor((s) => s.select);
  const [open, setOpen] = useState(depth < 1);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  return (
    <li>
      <div
        onClick={() => select(id)}
        style={{ paddingLeft: depth * 12 + 4 }}
        className={`flex cursor-default select-none items-center gap-1 rounded py-1 pr-2 text-sm ${
          selected ? "bg-blue-600/40" : "hover:bg-white/5"
        }`}
      >
        <button
          type="button"
          className="w-5 shrink-0 text-xs text-zinc-500"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
        >
          {hasChildren ? (open ? "▾" : "▸") : ""}
        </button>
        <span className="truncate">{node.name}</span>
        <span className="ml-auto shrink-0 pl-2 text-xs text-zinc-500">{node.class}</span>
      </div>
      {open && hasChildren && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c} id={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Explorer() {
  const root = useEditor((s) => (s.rootId ? s.nodes.get(s.rootId) : undefined));

  if (!root) return <p className="p-3 text-sm text-zinc-500">No file open</p>;

  return (
    <ul className="p-1">
      {root.children.map((c) => (
        <TreeNode key={c} id={c} depth={0} />
      ))}
    </ul>
  );
}
