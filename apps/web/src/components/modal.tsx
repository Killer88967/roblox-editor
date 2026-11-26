"use client";

import type { ReactNode } from "react";

/** A centered dialog over a dimmed backdrop; tapping the backdrop closes it. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-zinc-900 p-4 text-zinc-100 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="rounded px-2 text-zinc-400 hover:bg-white/10"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
