import { LuauVM } from "@rbxe/luau";
import { PlayHost, type HostOptions, type OutputKind, type PlayEditor, type PlayStatics, type Rect } from "./host";

/** A running play test: the Luau VM, and the host answering it against the play copy. */
export class PlaySession {
  /** GUI objects' absolute rects from the overlay's last layout (AbsoluteSize etc.). */
  rects = new Map<string, Rect>();
  /** The view's size in pixels. */
  viewport: [number, number] = [1280, 720];
  readonly host: PlayHost;
  readonly player: string;
  readonly playerGui: string;
  private vm: LuauVM | null = null;
  private readonly output: (kind: OutputKind, text: string) => void;

  private constructor(
    editor: PlayEditor,
    statics: PlayStatics,
    options: Omit<HostOptions, "rects" | "viewport">,
  ) {
    this.output = options.output;
    this.host = new PlayHost(editor, statics, {
      ...options,
      rects: () => this.rects,
      viewport: () => this.viewport,
    });
    const { player, playerGui } = this.host.setupPlayer();
    this.player = player;
    this.playerGui = playerGui;
  }

  /**
   * Sets up the player in `editor` (the play copy of the place) and runs its scripts.
   * `bytes`: luau.wasm's bytes, for Node; the browser fetches it.
   */
  static async start(options: {
    editor: PlayEditor;
    statics: PlayStatics;
    output: (kind: OutputKind, text: string) => void;
    textSize?: HostOptions["textSize"];
    touch?: boolean;
    /** Seconds a script may run without yielding before it's stopped (default 5). */
    timeout?: number;
    /** Called once the player is set up, before any script runs (e.g. to lay out PlayerGui). */
    onReady?: (session: PlaySession) => void;
    bytes?: BufferSource;
  }): Promise<PlaySession> {
    const session = new PlaySession(options.editor, options.statics, {
      output: options.output,
      textSize: options.textSize,
    });
    session.vm = await LuauVM.create({
      bytes: options.bytes,
      onHost: (message) => session.host.handle(message),
      onOutput: (text) => options.output("info", text),
    });
    options.onReady?.(session);
    session.send({
      op: "start",
      game: session.host.wire(options.editor.rootId()),
      player: session.host.wire(session.player),
      touch: !!options.touch,
      timeout: options.timeout,
    });
    return session;
  }

  private send(message: Record<string, unknown>) {
    if (!this.vm) return;
    try {
      this.vm.send(JSON.stringify(message));
    } catch (e) {
      this.output("error", `Play mode: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Advances play time: resumes waiting threads, runs tweens and RunService events. */
  step(dt: number) {
    this.send({ op: "step", dt });
  }

  /** A GUI event from the overlay, e.g. ("MouseButton1Click"). `args` are plain values. */
  gui(id: string, event: string, args?: unknown[]) {
    this.send({ op: "gui", id, event, args });
  }

  /** A TextBox's text typed in the overlay. */
  text(id: string, text: string) {
    this.send({ op: "text", id, text });
  }

  /** Keyboard or pointer input. `key` is a KeyCode name, `type` a UserInputType name. */
  input(state: "Begin" | "End", type: string, key?: string, processed = false) {
    this.send({ op: "input", state, type, key, processed });
  }

  mouse(x: number, y: number) {
    this.send({ op: "mouse", x, y });
  }

  /** A ClickDetector was clicked in the 3D view. */
  click(clickDetector: string) {
    this.send({ op: "click", id: clickDetector });
  }

  /** Runs a line of Luau from the Output's command bar (as server code). */
  eval(source: string) {
    this.send({ op: "eval", source });
  }

  dispose() {
    this.vm = null;
  }
}
