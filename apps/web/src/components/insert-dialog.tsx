"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WasmEditor } from "@/lib/wasm";
import { useEditor } from "@/stores/editor";

/** Shown first, before the full searchable list. */
const COMMON = [
  "Part",
  "WedgePart",
  "CornerWedgePart",
  "TrussPart",
  "SpawnLocation",
  "Seat",
  "Model",
  "Folder",
  "Script",
  "LocalScript",
  "ModuleScript",
  "ScreenGui",
  "Frame",
  "TextLabel",
  "TextButton",
  "ImageLabel",
  "PointLight",
  "SpotLight",
  "Sound",
  "Attachment",
  "WeldConstraint",
  "ProximityPrompt",
];

export function InsertDialog({ onClose }: { onClose: () => void }) {
  const insert = useEditor((s) => s.insert);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => WasmEditor.insertableClasses(), []);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMON.filter((c) => all.includes(c));
    // Prefix matches first, then anything containing the text.
    const starts = all.filter((c) => c.toLowerCase().startsWith(q));
    const contains = all.filter(
      (c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q),
    );
    return [...starts, ...contains].slice(0, 80);
  }, [all, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const choose = (className: string) => {
    insert(className);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Insert object"
        className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="border-b border-white/10 bg-transparent px-3 py-2.5 text-sm outline-none"
          placeholder="Search classes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) choose(results[0]);
          }}
        />
        {!query && <div className="px-3 pt-2 text-xs text-zinc-500">Common</div>}
        <ul className="overflow-y-auto p-1">
          {results.map((c) => (
            <li key={c}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-white/10"
                onClick={() => choose(c)}
              >
                {c}
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-zinc-500">No matches</li>
          )}
        </ul>
      </div>
    </div>
  );
}
