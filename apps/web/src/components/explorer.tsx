"use client";

import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEditor } from "@/stores/editor";

const ROW_HEIGHT = 28;

type Row = { id: string; depth: number };

function TreeRow({ id, depth }: Row) {
  const node = useEditor((s) => s.nodes.get(id));
  const selected = useEditor((s) => s.selectedId === id);
  const open = useEditor((s) => s.expanded.has(id));
  const select = useEditor((s) => s.select);
  const toggle = useEditor((s) => s.toggleExpanded);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  return (
    <div
      onClick={() => select(id)}
      style={{ paddingLeft: depth * 12 + 4, height: ROW_HEIGHT }}
      className={`flex cursor-default select-none items-center gap-1 rounded pr-2 text-sm ${
        selected ? "bg-blue-600/40" : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        aria-label={open ? "Collapse" : "Expand"}
        className="h-full w-5 shrink-0 text-xs text-zinc-500"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) toggle(id);
        }}
      >
        {hasChildren ? (open ? "▾" : "▸") : ""}
      </button>
      <span className="truncate">{node.name}</span>
      <span className="ml-auto shrink-0 pl-2 text-xs text-zinc-500">{node.class}</span>
    </div>
  );
}

export function Explorer() {
  const rootId = useEditor((s) => s.rootId);
  const nodes = useEditor((s) => s.nodes);
  const expanded = useEditor((s) => s.expanded);
  const selectedId = useEditor((s) => s.selectedId);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Flatten only the visible part of the tree; the virtualizer renders a window of it.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const root = rootId ? nodes.get(rootId) : undefined;
    if (!root) return out;
    const stack: Row[] = root.children.map((id) => ({ id, depth: 0 })).reverse();
    while (stack.length) {
      const row = stack.pop()!;
      out.push(row);
      const node = nodes.get(row.id);
      if (node && expanded.has(row.id)) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push({ id: node.children[i], depth: row.depth + 1 });
        }
      }
    }
    return out;
  }, [rootId, nodes, expanded]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the selection in view (e.g. after picking a part in the viewport).
  useEffect(() => {
    if (!selectedId) return;
    const index = rows.findIndex((r) => r.id === selectedId);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [selectedId, rows, virtualizer]);

  if (!rootId) return <p className="p-3 text-sm text-zinc-500">No file open</p>;

  return (
    <div ref={scrollRef} className="h-full overflow-auto p-1">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={row.id}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <TreeRow id={row.id} depth={row.depth} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
