"use client";

import { useMemo, useState } from "react";
import { useEditor } from "@/stores/editor";
import { formatValue, swatch, type PropertyInfo, type Value } from "@/lib/types";
import { fromHex, parseValue, TEXT_EDITABLE, toHex } from "@/lib/edit";

const input =
  "w-full min-w-0 rounded bg-white/5 px-1.5 py-0.5 outline-none focus:bg-white/10 focus:ring-1 focus:ring-blue-500";

/** Text input that commits on Enter or blur and reverts on Escape. */
export function TextField({
  initial,
  onCommit,
}: {
  initial: string;
  /** Return false to reject the text (the field reverts). */
  onCommit: (text: string) => boolean;
}) {
  const [draft, setDraft] = useState(initial);

  const commit = () => {
    if (draft !== initial && !onCommit(draft)) setDraft(initial);
  };

  return (
    <input
      className={input}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(initial);
          // Blur after the revert renders, so commit() sees no change.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function EnumSelect({ id, prop }: { id: string; prop: PropertyInfo }) {
  const editor = useEditor((s) => s.editor);
  const apply = useEditor((s) => s.apply);
  const items = useMemo(
    () =>
      (editor?.enumItems(id, prop.key) ?? []) as {
        name: string;
        value: number;
      }[],
    [editor, id, prop.key],
  );

  if (items.length === 0) return <span className="truncate">{formatValue(prop.value)}</span>;

  return (
    <select
      className={input}
      value={prop.value.value as number}
      onChange={(e) =>
        apply([
          {
            type: "setProperty",
            target: id,
            key: prop.key,
            value: { type: "Enum", value: Number(e.target.value) },
          },
        ])
      }
    >
      {items.map((item) => (
        <option key={item.value} value={item.value}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

export function PropertyEditor({ id, prop }: { id: string; prop: PropertyInfo }) {
  const apply = useEditor((s) => s.apply);
  const v = prop.value;

  const set = (value: Value) => apply([{ type: "setProperty", target: id, key: prop.key, value }]);

  if (v.type === "Bool") {
    return (
      <input
        type="checkbox"
        checked={v.value}
        onChange={(e) => set({ type: "Bool", value: e.target.checked })}
      />
    );
  }

  if (v.type === "Enum") return <EnumSelect id={id} prop={prop} />;

  if (!TEXT_EDITABLE.has(v.type)) {
    return <span className="truncate text-zinc-400">{prop.enumItem ?? formatValue(v)}</span>;
  }

  const text = formatValue(v);
  const hex = toHex(v);

  return (
    <div className="flex w-full min-w-0 items-center gap-1.5">
      {hex && (
        <label
          className="relative size-4 shrink-0 cursor-pointer overflow-hidden rounded-sm border border-white/20"
          style={{ background: swatch(v) ?? undefined }}
        >
          <input
            type="color"
            className="absolute inset-0 cursor-pointer opacity-0"
            value={hex}
            onChange={(e) => {
              const next = fromHex(v, e.target.value);
              if (next) set(next);
            }}
          />
        </label>
      )}
      {/* key: remount with the new text whenever the value changes (undo, other edits) */}
      <TextField
        key={text}
        initial={text}
        onCommit={(draft) => {
          const next = parseValue(v, draft);
          if (next) set(next);
          return next !== null;
        }}
      />
    </div>
  );
}
