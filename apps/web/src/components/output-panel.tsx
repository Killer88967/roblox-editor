"use client";

import { useEffect, useRef, useState } from "react";
import { usePlay, type OutputLine } from "@/stores/play";

const COLORS: Record<OutputLine["kind"], string> = {
  print: "text-zinc-200",
  info: "text-sky-300",
  warn: "text-amber-300",
  error: "text-red-400",
};

/** Studio's Output window: prints, warnings and errors from play mode, plus a command bar. */
export function OutputPanel() {
  const output = usePlay((s) => s.output);
  const running = usePlay((s) => s.status === "running");
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [command, setCommand] = useState("");
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);

  // Follow new lines unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [output]);

  return (
    <div className="flex h-44 shrink-0 flex-col border-t border-white/10 bg-zinc-950 text-xs">
      <div className="flex items-center gap-2 border-b border-white/10 px-2 py-1 text-zinc-400">
        <span className="font-medium text-zinc-200">Output</span>
        <span className="flex-1" />
        <button
          type="button"
          className="rounded px-2 py-0.5 hover:bg-white/10"
          onClick={() => usePlay.getState().clearOutput()}
        >
          Clear
        </button>
        <button
          type="button"
          aria-label="Close output"
          className="rounded px-2 py-0.5 hover:bg-white/10"
          onClick={() => usePlay.getState().setShowOutput(false)}
        >
          ✕
        </button>
      </div>
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {output.length === 0 && (
          <div className="py-2 text-zinc-500">
            {running
              ? "Nothing printed yet."
              : "Press Play to run your scripts. Their output shows here."}
          </div>
        )}
        {output.map((line) => (
          <div
            key={line.id}
            className={`flex gap-2 whitespace-pre-wrap break-words ${COLORS[line.kind]}`}
          >
            <span className="shrink-0 text-zinc-600">{line.time}</span>
            <span className="min-w-0">{line.text}</span>
          </div>
        ))}
      </div>
      <form
        className="flex border-t border-white/10"
        onSubmit={(e) => {
          e.preventDefault();
          if (!command.trim()) return;
          history.current.push(command);
          historyIndex.current = -1;
          usePlay.getState().run(command);
          setCommand("");
        }}
      >
        <span className="px-2 py-1.5 font-mono text-zinc-500">&gt;</span>
        <input
          className="min-w-0 flex-1 bg-transparent py-1.5 pr-2 font-mono text-zinc-100 outline-none placeholder:text-zinc-600"
          placeholder={
            running
              ? "Run a command, e.g. print(workspace:GetChildren())"
              : "Command bar (while playing)"
          }
          value={command}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            const past = history.current;
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            if (past.length === 0) return;
            e.preventDefault();
            let i = historyIndex.current;
            if (e.key === "ArrowUp") i = i < 0 ? past.length - 1 : Math.max(0, i - 1);
            else i = i < 0 ? -1 : i + 1 >= past.length ? -1 : i + 1;
            historyIndex.current = i;
            setCommand(i < 0 ? "" : past[i]);
          }}
        />
      </form>
    </div>
  );
}
