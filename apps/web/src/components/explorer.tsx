"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { isScriptClass, useEditor } from "@/stores/editor";
import { usePlay } from "@/stores/play";
import type { NodeInfo } from "@/lib/types";

const ROW_HEIGHT = 28;
/** Drag payload type for moving instances within the Explorer. */
const DRAG_TYPE = "application/x-rbxe-ids";

type Row = { id: string; depth: number };

/** Inline name editor: Enter or tapping away saves, Escape cancels. */
function RenameBox({ name }: { name: string }) {
  const finish = useEditor((s) => s.finishRename);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const end = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    finish(value);
  };
  return (
    <input
      ref={ref}
      defaultValue={name}
      aria-label="New name"
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      className="min-w-0 flex-1 rounded bg-zinc-900 px-1 py-0.5 text-sm text-zinc-100 outline-none ring-1 ring-blue-500"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") end(e.currentTarget.value);
        else if (e.key === "Escape") end(null);
      }}
      onBlur={(e) => end(e.currentTarget.value)}
    />
  );
}

function TreeRow({
  id,
  depth,
  searching,
  dropTarget,
  onDropTarget,
}: Row & {
  searching: boolean;
  dropTarget: boolean;
  onDropTarget: (id: string | null) => void;
}) {
  const node = useEditor((s) => s.nodes.get(id));
  const selected = useEditor((s) => s.selection.includes(id));
  const open = useEditor((s) => s.expanded.has(id));
  const isService = useEditor((s) => s.nodes.get(id)?.parent === s.rootId);
  const select = useEditor((s) => s.select);
  const toggle = useEditor((s) => s.toggleExpanded);
  const renaming = useEditor((s) => s.renaming === id);

  if (!node) return null;
  const hasChildren = node.children.length > 0;

  return (
    <div
      draggable={!isService && !renaming}
      onDragStart={(e) => {
        // Dragging a selected row moves the whole selection.
        const { selection } = useEditor.getState();
        const ids = selection.includes(id) ? selection : [id];
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!dropTarget) onDropTarget(id);
      }}
      onDragLeave={() => onDropTarget(null)}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        onDropTarget(null);
        if (!raw) return;
        e.preventDefault();
        e.stopPropagation();
        useEditor.getState().moveInto(JSON.parse(raw) as string[], id);
      }}
      onClick={(e) =>
        select(id, e.metaKey || e.ctrlKey ? "toggle" : e.shiftKey ? "add" : "replace")
      }
      // Scripts open on double-click (like Studio); anything else gets renamed.
      onDoubleClick={() => {
        const st = useEditor.getState();
        if (isScriptClass(node.class)) st.openScript(id);
        else st.startRename(id);
      }}
      style={{ paddingLeft: depth * 12 + 4, height: ROW_HEIGHT }}
      className={`flex cursor-default select-none items-center gap-1 rounded pr-2 text-sm ${
        dropTarget
          ? "bg-blue-500/30 ring-1 ring-blue-400"
          : selected
            ? "bg-blue-600/40"
            : "hover:bg-white/5"
      }`}
    >
      <button
        type="button"
        aria-label={open ? "Collapse" : "Expand"}
        className="h-full w-5 shrink-0 text-xs text-zinc-500"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren && !searching) toggle(id);
        }}
      >
        {hasChildren ? (open || searching ? "▾" : "▸") : ""}
      </button>
      {renaming ? <RenameBox name={node.name} /> : <span className="truncate">{node.name}</span>}
      <span className="ml-auto shrink-0 pl-2 text-xs text-zinc-500">{node.class}</span>
    </div>
  );
}

/** Ids matching the search, plus every ancestor of a match (so the path is shown). */
function searchTree(nodes: Map<string, NodeInfo>, query: string) {
  const matches = new Set<string>();
  const visible = new Set<string>();
  for (const [id, node] of nodes) {
    if (node.name.toLowerCase().includes(query) || node.class.toLowerCase().includes(query)) {
      matches.add(id);
      for (
        let cur: string | undefined = id;
        cur && !visible.has(cur);
        cur = nodes.get(cur)?.parent
      ) {
        visible.add(cur);
      }
    }
  }
  return { matches, visible };
}

export function Explorer() {
  const rootId = useEditor((s) => s.rootId);
  const nodes = useEditor((s) => s.nodes);
  const expanded = useEditor((s) => s.expanded);
  const primary = useEditor((s) => s.selection.at(-1));
  // Play mode keeps parentless instances (Instance.new before Parent is set) out of sight.
  const hidden = usePlay((s) => s.hiddenId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const search = useMemo(() => (q ? searchTree(nodes, q) : null), [nodes, q]);

  // Flatten only the visible part of the tree; the virtualizer renders a window of it.
  const rows = useMemo(() => {
    const out: Row[] = [];
    const root = rootId ? nodes.get(rootId) : undefined;
    if (!root) return out;
    const shown = (id: string) => id !== hidden && (!search || search.visible.has(id));
    const stack: Row[] = root.children
      .filter(shown)
      .map((id) => ({ id, depth: 0 }))
      .reverse();
    while (stack.length) {
      const row = stack.pop()!;
      out.push(row);
      const node = nodes.get(row.id);
      // While searching, paths to matches are always open.
      const open = search ? search.visible.has(row.id) : expanded.has(row.id);
      if (node && open) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          if (shown(node.children[i])) stack.push({ id: node.children[i], depth: row.depth + 1 });
        }
      }
    }
    return out;
  }, [rootId, nodes, expanded, search, hidden]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keep the selection in view (e.g. after picking a part in the viewport).
  useEffect(() => {
    if (!primary) return;
    const index = rows.findIndex((r) => r.id === primary);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [primary, rows, virtualizer]);

  if (!rootId) return <p className="p-3 text-sm text-zinc-500">No file open</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 p-1.5">
        <input
          className="min-w-0 flex-1 rounded bg-white/5 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          placeholder="Search name or class…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
        {search && <span className="shrink-0 text-xs text-zinc-500">{search.matches.size}</span>}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto p-1">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.id}
                className="absolute inset-x-0 top-0"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <TreeRow
                  id={row.id}
                  depth={row.depth}
                  searching={!!search}
                  dropTarget={dropTarget === row.id}
                  onDropTarget={setDropTarget}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
