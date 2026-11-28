import { create } from "zustand";
import { loadWasm, WasmEditor } from "@/lib/wasm";
import { PlaySession } from "@/lib/play/session";
import type { OutputKind } from "@/lib/play/host";
import { cssFont } from "@/lib/gui/fonts";
import { absoluteRects, layoutScreens } from "@/lib/gui/layout";
import type { Props } from "@/lib/gui/props";
import { textBounds } from "@/lib/gui/text";
import type { NodeInfo, PropertyInfo } from "@/lib/types";
import { setPlayExitHandler, useEditor } from "@/stores/editor";

export type OutputLine = { id: number; kind: OutputKind; text: string; time: string };

const MAX_LINES = 1000;

type PlayState = {
  status: "idle" | "starting" | "running";
  output: OutputLine[];
  /** The Output panel under the 3D view. */
  showOutput: boolean;
  /** The local player's PlayerGui (drawn instead of StarterGui while playing). */
  playerGui: string | null;
  /** Holder for parentless instances, hidden from the Explorer. */
  hiddenId: string | null;

  /** Runs the place's scripts on a copy of it. */
  start: () => Promise<void>;
  /** Stops and brings back the place as it was. */
  stop: () => void;
  clearOutput: () => void;
  setShowOutput: (on: boolean) => void;
  /** Runs a line of Luau typed into the Output (while playing). */
  run: (source: string) => void;
};

let session: PlaySession | null = null;
/** The play copy of the place (freed when play mode ends). */
let playCopy: WasmEditor | null = null;
let frame = 0;
let lastTime = 0;
let nextLineId = 1;
let pending: OutputLine[] = [];
let removeInput: (() => void) | null = null;
/** The 3D view's size, kept by the GUI overlay. */
let viewport: [number, number] = [1280, 720];

export function setPlayViewport(w: number, h: number) {
  if (w > 0 && h > 0) viewport = [w, h];
}

/**
 * Lays out the player's GUIs before scripts start, so AbsoluteSize and AbsolutePosition are
 * right from the first line (the overlay keeps them updated after that).
 */
function layoutPlayerGui(copy: WasmEditor, s: PlaySession) {
  const nodes = new Map<string, NodeInfo>();
  for (const n of copy.nodes() as NodeInfo[]) nodes.set(n.id, n);
  const props = (id: string) => {
    const p: Props = {};
    for (const prop of copy.properties(id) as PropertyInfo[]) p[prop.key] = prop.value;
    return p;
  };
  const [w, h] = viewport;
  s.viewport = viewport;
  s.rects = absoluteRects(layoutScreens({ nodes, props }, s.playerGui, { w, h }));
}

/** The running session (for the GUI overlay and viewport to send events to). */
export const playSession = () => session;

const clock = () => {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};

/** TextService:GetTextSize, measured like the GUI overlay measures text. */
function measureText(text: string, size: number, font: string, frame?: [number, number]) {
  const css = cssFont(`rbxasset://fonts/families/${font}.json`, 400, false);
  const b = textBounds(text, css, size, 1, frame?.[0] ?? Infinity);
  return [Math.ceil(b.width), Math.ceil(b.height)] as [number, number];
}

// Roblox KeyCode names for KeyboardEvent.code.
const KEYS: Record<string, string> = {
  Space: "Space",
  Enter: "Return",
  NumpadEnter: "KeypadEnter",
  Escape: "Escape",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ShiftLeft: "LeftShift",
  ShiftRight: "RightShift",
  ControlLeft: "LeftControl",
  ControlRight: "RightControl",
  AltLeft: "LeftAlt",
  AltRight: "RightAlt",
  MetaLeft: "LeftSuper",
  MetaRight: "RightSuper",
  CapsLock: "CapsLock",
  Minus: "Minus",
  Equal: "Equals",
  BracketLeft: "LeftBracket",
  BracketRight: "RightBracket",
  Semicolon: "Semicolon",
  Quote: "Quote",
  Comma: "Comma",
  Period: "Period",
  Slash: "Slash",
  Backslash: "BackSlash",
  Backquote: "Backquote",
};
const DIGITS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function keyCode(code: string): string | undefined {
  if (KEYS[code]) return KEYS[code];
  let m = code.match(/^Key([A-Z])$/);
  if (m) return m[1];
  m = code.match(/^Digit(\d)$/);
  if (m) return DIGITS[Number(m[1])];
  m = code.match(/^Numpad(\d)$/);
  if (m) return `Keypad${DIGITS[Number(m[1])]}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return undefined;
}

/** Typing into a text field, Monaco or the command bar isn't game input. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || !!target.closest("input, textarea, select, .monaco-editor"));

function listenForKeys() {
  const handle = (state: "Begin" | "End") => (e: KeyboardEvent) => {
    if (!session || e.repeat || typing(e.target)) return;
    const key = keyCode(e.code);
    if (!key) return;
    session.input(state, "Keyboard", key);
    afterEvent();
  };
  const down = handle("Begin");
  const up = handle("End");
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  };
}

function flushOutput() {
  if (pending.length === 0) return;
  const lines = pending;
  pending = [];
  usePlay.setState((s) => ({ output: [...s.output, ...lines].slice(-MAX_LINES) }));
}

function log(kind: OutputKind, text: string) {
  pending.push({ id: nextLineId++, kind, text, time: clock() });
  // Bursts (a print in a loop) are shown once per frame; outside play, right away.
  if (!session) flushOutput();
}

/** Shows what scripts changed. Call after sending the session an event. */
export function afterEvent() {
  if (session?.host.dirty) {
    session.host.dirty = false;
    useEditor.getState().refresh();
  }
  flushOutput();
}

function loop(now: number) {
  if (!session) return;
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.25) : 1 / 60;
  lastTime = now;
  session.step(dt);
  afterEvent();
  frame = requestAnimationFrame(loop);
}

/** Tears down the session (play mode ended through useEditor.exitPlay). */
function cleanup() {
  cancelAnimationFrame(frame);
  removeInput?.();
  removeInput = null;
  flushOutput();
  const ended = session;
  session = null;
  lastTime = 0;
  if (ended) {
    ended.dispose();
    playCopy?.free();
    playCopy = null;
    log("info", "Stopped");
  }
  usePlay.setState({ status: "idle", playerGui: null, hiddenId: null });
}

export const usePlay = create<PlayState>()((set, get) => ({
  status: "idle",
  output: [],
  showOutput: false,
  playerGui: null,
  hiddenId: null,

  async start() {
    const { editor, cloud } = useEditor.getState();
    if (!editor || get().status !== "idle" || cloud?.readOnly) return;
    // Open script tabs commit their latest text first.
    window.dispatchEvent(new Event("rbxe:flush-scripts"));
    set({ status: "starting", showOutput: true, output: [] });
    await loadWasm();
    const source = useEditor.getState().editor;
    if (!source) return set({ status: "idle" });
    const copy = source.fork();
    try {
      session = await PlaySession.start({
        editor: copy,
        statics: WasmEditor,
        output: log,
        textSize: measureText,
        onReady: (s) => layoutPlayerGui(copy, s),
        touch: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
      });
    } catch (e) {
      copy.free();
      session = null;
      log("error", `Couldn't start play mode: ${e instanceof Error ? e.message : String(e)}`);
      return set({ status: "idle" });
    }
    playCopy = copy;
    setPlayExitHandler(cleanup);
    useEditor.getState().enterPlay(copy);
    set({ status: "running", playerGui: session.playerGui, hiddenId: session.host.nilId });
    session.host.dirty = false;
    removeInput = listenForKeys();
    flushOutput();
    frame = requestAnimationFrame(loop);
  },

  stop() {
    if (useEditor.getState().playing) useEditor.getState().exitPlay();
    else cleanup();
  },

  clearOutput: () => set({ output: [] }),
  setShowOutput: (showOutput) => set({ showOutput }),

  run(source) {
    if (!source.trim()) return;
    log("info", `> ${source}`);
    if (!session) {
      log("warn", "Press Play to run code");
      return;
    }
    session.eval(source);
    afterEvent();
  },
}));
