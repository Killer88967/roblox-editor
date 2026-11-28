/**
 * Answers the Luau runtime's host calls (packages/luau/runtime) against the play copy of the
 * place. Requests are JSON arrays `[op, ...args]`; replies are `{ v: value }` or `{ e: error }`.
 *
 * Values cross as "wire" values: plain JSON for primitives, `{ $i: id, c: class }` for
 * instances, `{ $e: enum, n: item, v: value }` for enum items, and `{ $t: type, v: value }`
 * for datatypes (same shapes as `Value` in lib/types.ts).
 *
 * No runtime imports, so the play tests can load this file in Node.
 */
import type { NodeInfo, PropertyInfo, Value } from "../types";

/** The parts of WasmEditor play mode uses (an instance of the play copy). */
export type PlayEditor = {
  rootId(): string;
  node(id: string): unknown;
  property(id: string, key: string): unknown;
  attributes(id: string): unknown;
  tags(id: string): string[];
  apply(ops: unknown): string[];
  copy(id: string): Uint8Array;
};

/** WasmEditor's static helpers. */
export type PlayStatics = {
  newId(): string;
  isA(className: string, ancestor: string): boolean;
  classChain(className: string): string[];
  propertyMeta(className: string, key: string): unknown;
  enumByName(name: string): unknown;
  isServiceClass(className: string): boolean;
};

type Meta = { enum?: string | null; type?: string | null; default?: Value | null };
type EnumItem = { name: string; value: number };

export type OutputKind = "print" | "warn" | "error" | "info";
export type Rect = { x: number; y: number; w: number; h: number; rotation: number };

export type HostOptions = {
  output: (kind: OutputKind, text: string) => void;
  /** Absolute rects of GUI objects, from the overlay's last layout. */
  rects?: () => Map<string, Rect>;
  /** The view's size in pixels (Camera.ViewportSize). */
  viewport?: () => [number, number];
  /** Text size in pixels for TextService:GetTextSize. */
  textSize?: (text: string, size: number, font: string, frame?: [number, number]) => [number, number];
};

type Wire = null | boolean | number | string | Wire[] | { [key: string]: Wire };

const READ_ONLY = new Set([
  "AbsoluteSize",
  "AbsolutePosition",
  "AbsoluteRotation",
  "AbsoluteContentSize",
  "AbsoluteCanvasSize",
  "AbsoluteWindowSize",
  "TextBounds",
  "TextFits",
  "ContentText",
  "ViewportSize",
  "LocalPlayer",
]);

class HostError extends Error {}

export class PlayHost {
  /** Parent of instances whose Parent is nil (Instance.new, Clone, `Parent = nil`). */
  readonly nilId: string;
  /** Set whenever the place changes; the session clears it after refreshing the views. */
  dirty = false;

  private readonly metaCache = new Map<string, Meta | null>();
  private readonly enumCache = new Map<string, EnumItem[] | null>();
  /** Name and class of destroyed instances, which scripts may still hold. */
  private readonly tombstones = new Map<string, { name: string; class: string }>();

  private readonly editor: PlayEditor;
  private readonly statics: PlayStatics;
  private readonly options: HostOptions;

  // (Plain fields rather than parameter properties: Node's type stripping runs the tests.)
  constructor(editor: PlayEditor, statics: PlayStatics, options: HostOptions) {
    this.editor = editor;
    this.statics = statics;
    this.options = options;
    this.nilId = statics.newId();
    this.apply([
      { type: "create", parent: editor.rootId(), class: "Folder", name: "NilInstances", id: this.nilId },
    ]);
  }

  /** Handles one request from the runtime. */
  handle(message: string): string {
    try {
      const [op, ...args] = JSON.parse(message) as [string, ...unknown[]];
      return JSON.stringify({ v: this.dispatch(op, args) ?? null });
    } catch (e) {
      return JSON.stringify({ e: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Adds the local player, like joining a game: Players.Player1 with a PlayerGui (a copy of
   * StarterGui), a Backpack (StarterPack) and PlayerScripts (StarterPlayerScripts).
   */
  setupPlayer(name = "Player1"): { player: string; playerGui: string } {
    const root = this.editor.rootId();
    const players = String((this.service("Players") as { $i: string }).$i);
    const player = this.statics.newId();
    const playerGui = this.statics.newId();
    const backpack = this.statics.newId();
    const playerScripts = this.statics.newId();
    this.apply([
      {
        type: "create",
        parent: players,
        class: "Player",
        name,
        id: player,
        properties: {
          UserId: { type: "Int64", value: 1 },
          DisplayName: { type: "String", value: name },
        },
      },
      { type: "create", parent: player, class: "PlayerGui", name: "PlayerGui", id: playerGui },
      { type: "create", parent: player, class: "Backpack", name: "Backpack", id: backpack },
      { type: "create", parent: player, class: "PlayerScripts", name: "PlayerScripts", id: playerScripts },
    ]);

    const childOf = (parent: string | undefined, className: string) =>
      parent ? this.children(parent).find((c) => this.node(c)?.class === className) : undefined;
    const copyChildren = (from: string | undefined, to: string) => {
      if (!from) return;
      const ops = this.children(from)
        .filter((c) => {
          const archivable = this.editor.property(c, "Archivable") as Value | undefined;
          return !(archivable?.type === "Bool" && !archivable.value);
        })
        .map((c) => ({ type: "paste", parent: to, model: this.editor.copy(c) }));
      if (ops.length) this.apply(ops);
    };
    copyChildren(childOf(root, "StarterGui"), playerGui);
    copyChildren(childOf(root, "StarterPack"), backpack);
    copyChildren(childOf(childOf(root, "StarterPlayer"), "StarterPlayerScripts"), playerScripts);

    // Scripts expect workspace.CurrentCamera.
    const workspace = childOf(root, "Workspace");
    if (workspace) {
      const current = this.editor.property(workspace, "CurrentCamera") as Value | undefined;
      const hasCamera = current?.type === "Ref" && !!current.value && !!this.node(current.value);
      if (!hasCamera) {
        const camera = childOf(workspace, "Camera") ?? this.statics.newId();
        const ops: unknown[] = [];
        if (!this.node(camera)) {
          ops.push({ type: "create", parent: workspace, class: "Camera", name: "Camera", id: camera });
        }
        ops.push({
          type: "setProperty",
          target: workspace,
          key: "CurrentCamera",
          value: { type: "Ref", value: camera },
        });
        this.apply(ops);
      }
    }
    return { player, playerGui };
  }

  // ---------------------------------------------------------------------------------------
  // Tree helpers

  node(id: string): NodeInfo | undefined {
    return this.editor.node(id) as NodeInfo | undefined;
  }

  private apply(ops: unknown[]): string[] {
    this.dirty = true;
    return this.editor.apply(ops);
  }

  wire(id: string | undefined | null): Wire {
    if (!id) return null;
    const node = this.node(id);
    return { $i: id, c: node?.class ?? this.tombstones.get(id)?.class ?? "Instance" };
  }

  /** Parent as scripts see it: nil for parentless instances and the DataModel. */
  private parentOf(id: string): string | undefined {
    const parent = this.node(id)?.parent;
    return parent && parent !== this.nilId ? parent : undefined;
  }

  private children(id: string): string[] {
    const node = this.node(id);
    if (!node) return [];
    return id === this.editor.rootId() ? node.children.filter((c) => c !== this.nilId) : node.children;
  }

  /** Depth-first, in child order. */
  descendants(id: string): string[] {
    const out: string[] = [];
    const stack = [...this.children(id)].reverse();
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      const kids = this.children(cur);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return out;
  }

  private ancestors(id: string): string[] {
    const out: string[] = [];
    for (let p = this.parentOf(id); p; p = this.parentOf(p)) out.push(p);
    return out;
  }

  private className(id: string): string {
    return this.node(id)?.class ?? this.tombstones.get(id)?.class ?? "Instance";
  }

  private fullName(id: string): string {
    const root = this.editor.rootId();
    const names: string[] = [];
    for (let cur: string | undefined = id; cur && cur !== root; cur = this.parentOf(cur)) {
      names.push(this.node(cur)?.name ?? this.tombstones.get(cur)?.name ?? "?");
    }
    return names.reverse().join(".");
  }

  private meta(className: string, key: string): Meta | null {
    const cacheKey = `${className}.${key}`;
    let m = this.metaCache.get(cacheKey);
    if (m === undefined) {
      m = (this.statics.propertyMeta(className, key) as Meta | undefined) ?? null;
      this.metaCache.set(cacheKey, m);
    }
    return m;
  }

  enumItems(name: string): EnumItem[] | null {
    let items = this.enumCache.get(name);
    if (items === undefined) {
      items = (this.statics.enumByName(name) as EnumItem[] | undefined) ?? null;
      this.enumCache.set(name, items);
    }
    return items;
  }

  // ---------------------------------------------------------------------------------------
  // Values

  toWire(value: Value | undefined | null, className: string, key: string): Wire {
    if (!value) return null;
    switch (value.type) {
      case "Bool":
      case "String":
      case "Content":
      case "ContentId":
      case "Int32":
      case "Int64":
      case "Float32":
      case "Float64":
        return value.value;
      case "Enum": {
        const enumName = this.meta(className, key)?.enum;
        if (!enumName) return value.value;
        const item = this.enumItems(enumName)?.find((i) => i.value === value.value);
        return { $e: enumName, n: item?.name ?? null, v: value.value };
      }
      case "Color3uint8":
        return { $t: "Color3", v: value.value.map((c) => c / 255) };
      case "Ref":
        return value.value && this.node(value.value) ? this.wire(value.value) : null;
      case "Unsupported":
        return null;
      default:
        return { $t: value.type, v: value.value as Wire };
    }
  }

  private wireType(w: unknown): string {
    if (w === null || w === undefined) return "nil";
    if (typeof w !== "object") return typeof w;
    const o = w as Record<string, unknown>;
    if ("$i" in o) return "Instance";
    if ("$e" in o) return "EnumItem";
    if ("$t" in o) return String(o.$t);
    return "table";
  }

  /** Converts a wire value for a property of the given type, or throws Roblox's message. */
  private coerce(w: unknown, key: string, type: string, enumName: string | null | undefined): Value {
    const got = this.wireType(w);
    const fail = (expected: string): never => {
      throw new HostError(`Unable to assign property ${key}. ${expected} expected, got ${got}`);
    };
    const o = (typeof w === "object" && w ? w : {}) as Record<string, unknown>;

    if (enumName) {
      const items = this.enumItems(enumName) ?? [];
      let item: EnumItem | undefined;
      if (typeof w === "number") item = items.find((i) => i.value === w);
      else if (typeof w === "string") item = items.find((i) => i.name === w);
      else if (got === "EnumItem") {
        if (o.$e !== enumName) fail(`EnumItem of type ${enumName}`);
        item = items.find((i) => i.value === o.v);
      } else fail(`EnumItem of type ${enumName}`);
      if (!item) throw new HostError(`Invalid value for enum ${enumName}`);
      return { type: "Enum", value: item.value };
    }

    const asNumber = () => {
      if (typeof w === "number") return w;
      if (typeof w === "string" && w.trim() !== "" && Number.isFinite(Number(w))) return Number(w);
      return fail("number");
    };

    switch (type) {
      case "Bool":
        return typeof w === "boolean" ? { type, value: w } : fail("bool");
      case "String":
      case "Content":
      case "ContentId":
        if (typeof w === "number") return { type, value: String(w) };
        return typeof w === "string" ? { type, value: w } : fail("string");
      case "Int32":
      case "Int64":
        return { type, value: Math.trunc(asNumber()) };
      case "Float32":
      case "Float64":
        return { type, value: asNumber() };
      case "Color3uint8": {
        if (got === "Color3") {
          const c = o.v as number[];
          return { type, value: c.map((n) => Math.round(Math.min(Math.max(n, 0), 1) * 255)) as [number, number, number] };
        }
        if (got === "BrickColor") {
          const c = (o.v as { color: number[] }).color;
          return { type, value: c.map((n) => Math.round(n * 255)) as [number, number, number] };
        }
        return fail("Color3");
      }
      case "BrickColor":
        if (got === "BrickColor") return { type, value: (o.v as { number: number }).number };
        return fail("BrickColor");
      case "Ref":
        if (w === null || w === undefined) return { type, value: undefined };
        if (got === "Instance") return { type, value: String(o.$i) };
        return fail("Object");
      case "Enum":
        if (typeof w === "number") return { type, value: w };
        if (got === "EnumItem") return { type, value: Number(o.v) };
        return fail("EnumItem");
    }
    if (got !== type) fail(type);
    return { type, value: o.v } as Value;
  }

  // ---------------------------------------------------------------------------------------
  // Requests

  private dispatch(op: string, a: unknown[]): unknown {
    const id = a[0] as string;
    switch (op) {
      case "get":
        return this.get(id, a[1] as string);
      case "set":
        return this.set(id, a[1] as string, a[2]);
      case "name":
        return this.node(id)?.name ?? this.tombstones.get(id)?.name ?? null;
      case "classof":
        return this.className(id);
      case "fullname":
        return this.fullName(id);
      case "parentof":
        return this.wire(this.parentOf(id));
      case "children":
        return this.children(id).map((c) => this.wire(c));
      case "descendants":
        return this.descendants(id).map((c) => this.wire(c));
      case "ancestors":
        return this.ancestors(id).map((c) => this.wire(c));
      case "find":
        return this.find(id, a[1] as string, a[2] === true);
      case "findclass":
        return this.findClass(id, a[1] as string, a[2] === true, a[3] === true);
      case "new":
        return this.create(id);
      case "destroy":
        return this.destroy(id);
      case "clone":
        return this.clone(id);
      case "service":
        return this.service(id);
      case "chain":
        return this.statics.classChain(id);
      case "enum":
        return this.enumItems(id);
      case "source": {
        const v = this.editor.property(id, "Source") as Value | undefined;
        return v?.type === "String" ? v.value : "";
      }
      case "scripts":
        return this.scripts(id);
      case "attrs": {
        const attrs = (this.node(id) ? this.editor.attributes(id) : {}) as Record<string, Value>;
        const out: Record<string, Wire> = {};
        for (const [name, v] of Object.entries(attrs)) out[name] = this.toWire(v, "", "");
        return out;
      }
      case "tags":
        return this.node(id) ? this.editor.tags(id) : [];
      case "tagged":
        return this.tagged(id);
      case "alltags": {
        const all = new Set<string>();
        for (const d of this.descendants(this.editor.rootId())) for (const t of this.editor.tags(d)) all.add(t);
        return [...all];
      }
      case "out":
        this.options.output(a[0] as OutputKind, String(a[1] ?? ""));
        return null;
      case "textsize": {
        const [text, size, font, frame] = a as [string, number, string, [number, number] | null];
        const measure = this.options.textSize;
        if (measure) return measure(text, size, font, frame ?? undefined);
        return [text.length * size * 0.5, size];
      }
    }
    throw new HostError(`unknown host call: ${op}`);
  }

  private get(id: string, key: string): { k: string; v?: Wire } {
    const node = this.node(id);
    if (!node) {
      // Destroyed: scripts can still read its name.
      const tomb = this.tombstones.get(id);
      if (key === "Name") return { k: "p", v: tomb?.name ?? null };
      return { k: "p", v: null };
    }
    switch (key) {
      case "Name":
        return { k: "p", v: node.name };
      case "Parent":
        return { k: "p", v: this.wire(this.parentOf(id)) };
      case "AbsoluteSize":
      case "AbsolutePosition":
      case "AbsoluteRotation": {
        if (!this.statics.isA(node.class, "GuiBase2d")) break;
        const r = this.options.rects?.().get(id);
        if (key === "AbsoluteRotation") return { k: "p", v: r?.rotation ?? 0 };
        const v = key === "AbsoluteSize" ? [r?.w ?? 0, r?.h ?? 0] : [r?.x ?? 0, r?.y ?? 0];
        return { k: "p", v: { $t: "Vector2", v } };
      }
      case "ViewportSize":
        if (node.class !== "Camera") break;
        return { k: "p", v: { $t: "Vector2", v: this.options.viewport?.() ?? [1280, 720] } };
    }
    const value = this.editor.property(id, key) as Value | undefined;
    if (value) return { k: "p", v: this.toWire(value, node.class, key) };
    const meta = this.meta(node.class, key);
    if (meta) return { k: "p", v: this.toWire(meta.default, node.class, key) };
    const child = this.children(id).find((c) => this.node(c)?.name === key);
    if (child) return { k: "c", v: this.wire(child) };
    return { k: "x" };
  }

  /** Returns whether the value changed. */
  private set(id: string, key: string, w: unknown): boolean {
    const node = this.node(id);
    if (!node) throw new HostError(`Cannot set ${key} of a destroyed instance`);
    if (key === "Name") {
      const name = String(w);
      if (name === node.name) return false;
      this.apply([{ type: "setName", target: id, name }]);
      return true;
    }
    if (key === "Parent") return this.reparent(id, w);
    if (READ_ONLY.has(key)) {
      throw new HostError(`Unable to assign property ${key}. Property is read only`);
    }
    const existing = this.editor.property(id, key) as Value | undefined;
    const meta = this.meta(node.class, key);
    if (!existing && !meta) {
      throw new HostError(`${key} is not a valid member of ${node.class} "${this.fullName(id)}"`);
    }
    const type = existing?.type ?? meta?.type ?? meta?.default?.type;
    if (!type && !meta?.enum) throw new HostError(`Unable to assign property ${key}`);
    const value = this.coerce(w, key, type ?? "Enum", meta?.enum);
    if (existing && JSON.stringify(existing) === JSON.stringify(value)) return false;
    this.apply([{ type: "setProperty", target: id, key, value }]);
    return true;
  }

  private reparent(id: string, w: unknown): boolean {
    const target =
      w && typeof w === "object" && "$i" in (w as object) ? String((w as { $i: string }).$i) : null;
    if (target && !this.node(target)) throw new HostError("The new parent has been destroyed");
    if (target === id || (target && this.ancestors(target).includes(id))) {
      throw new HostError(
        `Attempt to set parent of ${this.fullName(id)} to ${this.fullName(target!)} would result in circular reference`,
      );
    }
    if (id === this.editor.rootId() || this.parentOf(id) === this.editor.rootId()) {
      throw new HostError(`Unable to change the Parent of ${this.node(id)?.name}`);
    }
    const parent = target ?? this.nilId;
    if (this.node(id)?.parent === parent) return false;
    this.apply([{ type: "reparent", target: id, parent }]);
    return true;
  }

  private find(id: string, name: string, recursive: boolean): Wire {
    const pool = recursive ? this.descendants(id) : this.children(id);
    return this.wire(pool.find((c) => this.node(c)?.name === name));
  }

  private findClass(id: string, className: string, recursive: boolean, exact: boolean): Wire {
    const pool = recursive ? this.descendants(id) : this.children(id);
    const match = pool.find((c) => {
      const cls = this.node(c)?.class ?? "";
      return exact ? cls === className : this.statics.isA(cls, className);
    });
    return this.wire(match);
  }

  private create(className: string): Wire {
    if (this.statics.classChain(className).length === 0) {
      throw new HostError(`Unable to create an Instance of type "${className}"`);
    }
    if (this.statics.isServiceClass(className)) {
      throw new HostError(`Unable to create an Instance of type "${className}"`);
    }
    const id = this.statics.newId();
    this.apply([{ type: "create", parent: this.nilId, class: className, name: className, id }]);
    return this.wire(id);
  }

  /** Returns the ids that are gone (the instance and its descendants). */
  private destroy(id: string): string[] {
    const node = this.node(id);
    if (!node) return [];
    if (id === this.editor.rootId() || node.parent === this.editor.rootId()) {
      throw new HostError(`Unable to destroy ${node.name}`);
    }
    const gone = [id, ...this.descendants(id)];
    for (const g of gone) {
      const n = this.node(g);
      if (n) this.tombstones.set(g, { name: n.name, class: n.class });
    }
    this.apply([{ type: "delete", target: id }]);
    return gone;
  }

  private clone(id: string): Wire {
    const node = this.node(id);
    if (!node) return null;
    const archivable = this.editor.property(id, "Archivable") as Value | undefined;
    if (archivable?.type === "Bool" && !archivable.value) return null;
    const [copy] = this.apply([{ type: "paste", parent: this.nilId, model: this.editor.copy(id) }]);
    return this.wire(copy);
  }

  private service(className: string): Wire {
    const root = this.editor.rootId();
    if (className === "DataModel") return this.wire(root);
    const existing = this.children(root).find((c) => this.node(c)?.class === className);
    if (existing) return this.wire(existing);
    if (!this.statics.isServiceClass(className)) {
      throw new HostError(`'${className}' is not a valid Service name`);
    }
    const id = this.statics.newId();
    this.apply([{ type: "create", parent: root, class: className, name: className, id }]);
    return this.wire(id);
  }

  private scripts(rootId: string | null) {
    const root = rootId ?? this.editor.rootId();
    const ids = rootId ? [rootId, ...this.descendants(rootId)] : this.descendants(root);
    const out: { s: Wire; enabled: boolean; a: string[] }[] = [];
    for (const id of ids) {
      const node = this.node(id);
      if (!node || (node.class !== "Script" && node.class !== "LocalScript")) continue;
      const enabled = this.editor.property(id, "Enabled") as Value | undefined;
      const disabled = this.editor.property(id, "Disabled") as Value | undefined;
      const on =
        enabled?.type === "Bool" ? enabled.value : disabled?.type === "Bool" ? !disabled.value : true;
      out.push({
        s: this.wire(id),
        enabled: on,
        a: this.ancestors(id).map((p) => this.className(p)),
      });
    }
    return out;
  }

  private tagged(tag: string): Wire[] {
    const out: Wire[] = [];
    for (const id of this.descendants(this.editor.rootId())) {
      if (this.editor.tags(id).includes(tag)) out.push(this.wire(id));
    }
    for (const id of this.descendants(this.nilId)) {
      if (this.editor.tags(id).includes(tag)) out.push(this.wire(id));
    }
    return out;
  }
}

export type { PropertyInfo };
