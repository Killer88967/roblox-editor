import type { NodeInfo } from "./types";
import { findMember, type Api, type ApiMember } from "./roblox-api";
import {
  analyze,
  fieldsOf,
  sourceOf,
  type Analysis,
  type Field,
  type Source,
} from "./luau-analyze";

/** One step after the root of a chain like `script.Parent:WaitForChild("Frame").Title`. */
export type Step =
  | { kind: "member"; name: string }
  | { kind: "index"; name: string }
  | { kind: "method"; name: string; args: string }
  | { kind: "call"; args: string };

export type Chain = { root: string; steps: Step[] };

const IDENT = /^[A-Za-z_]\w*/;

/** Parses `a.b:WaitForChild("c")["d"]` into a root name and steps. Null if it isn't one. */
export function parseChain(expr: string): Chain | null {
  let rest = expr.trim();
  const root = rest.match(IDENT);
  if (!root) return null;
  rest = rest.slice(root[0].length);
  const steps: Step[] = [];

  while (rest.length) {
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\s*\.\s*([A-Za-z_]\w*)/))) {
      steps.push({ kind: "member", name: m[1] });
    } else if ((m = rest.match(/^\s*\[\s*["']([^"']+)["']\s*\]/))) {
      steps.push({ kind: "index", name: m[1] });
    } else if ((m = rest.match(/^\s*:\s*([A-Za-z_]\w*)\s*\(([^()]*)\)/))) {
      steps.push({ kind: "method", name: m[1], args: m[2] });
    } else if ((m = rest.match(/^\s*\(([^()]*)\)/))) {
      steps.push({ kind: "call", args: m[1] });
    } else {
      return null;
    }
    rest = rest.slice(m[0].length);
  }
  return { root: root[0], steps };
}

/** The first string literal in an argument list: `"Frame", 5` -> `Frame`. */
const firstString = (args: string) => args.match(/^\s*["']([^"']*)["']/)?.[1];

export type Tree = {
  nodes: Map<string, NodeInfo>;
  rootId: string;
  scriptId: string;
  /** A script's Source, for following `require(module)`. */
  source?: (id: string) => string;
};

/**
 * What an expression refers to:
 * - instance: a class, and the actual instance in the place when we can tell which one
 * - value: a datatype or class value with no known instance (e.g. `RBXScriptSignal`, `Vector3`)
 * - static: a datatype or library namespace (`Vector3.`, `task.`, `Instance.`)
 * - enums / enum: `Enum.` and `Enum.Material.`
 * - table: a Luau table with known fields (`local M = {}`, a required ModuleScript)
 */
export type Target =
  | { kind: "instance"; className: string; id?: string }
  | { kind: "value"; type: string; event?: ApiMember }
  | { kind: "static"; name: string }
  | { kind: "enums" }
  | { kind: "enum"; name: string }
  /** `name` is for display (`Config.Theme`); `key` is its path inside `an` (`M.Theme`). */
  | { kind: "table"; name: string; key: string; fields: Field[]; an: Analysis };

type Ctx = { tree: Tree; api: Api; an: Analysis; at: number };

const childNamed = (tree: Tree, parent: string, name: string) =>
  tree.nodes.get(parent)?.children.find((c) => tree.nodes.get(c)?.name === name);

const childOfClass = (ctx: Ctx, parent: string, className: string) =>
  ctx.tree.nodes.get(parent)?.children.find((c) => ctx.tree.nodes.get(c)?.class === className);

function instance(ctx: Ctx, id: string | undefined): Target | null {
  const node = id ? ctx.tree.nodes.get(id) : undefined;
  return node ? { kind: "instance", className: node.class, id } : null;
}

/** A type name from the API as a target: classes become instances, others plain values. */
function ofType(ctx: Ctx, type: string | undefined): Target | null {
  if (!type) return null;
  const clean = type.trim().replace(/\?$/, "").split(/[ ,|]/)[0];
  if (ctx.api.classes[clean]) return { kind: "instance", className: clean };
  // Enum-typed properties (`Enum.Material`) hold an EnumItem.
  if (clean.startsWith("Enum.")) return { kind: "value", type: "EnumItem" };
  return { kind: "value", type: clean };
}

/** The element type of a list type: `Instances` -> Instance, `List<Player>` / `{Player}` -> Player. */
export function elementType(type: string): string | undefined {
  if (type === "Instances" || type === "Objects") return "Instance";
  return type.match(/^(?:List|Array)<\s*(\w+)\s*>$/)?.[1] ?? type.match(/^\{\s*(\w+)\s*\}$/)?.[1];
}

/** Fields a ModuleScript returns, by reading its Source. */
function moduleTable(ctx: Ctx, id: string): Target | null {
  const node = ctx.tree.nodes.get(id);
  const source = ctx.tree.source?.(id);
  if (!node || node.class !== "ModuleScript" || source === undefined) return null;
  const an = analyze(source);
  return an.exports
    ? { kind: "table", name: node.name, key: an.exportsKey ?? node.name, fields: an.exports, an }
    : null;
}

/** Works out a variable's value from where it was assigned or declared. */
function fromSource(
  ctx: Ctx,
  name: string,
  src: Source | undefined,
  depth: number,
  key = name,
): Target | null {
  const table = (): Target | null => {
    const fields = fieldsOf(ctx.an, key);
    return fields.length ? { kind: "table", name, key, fields, an: ctx.an } : null;
  };
  if (!src) return table();
  switch (src.k) {
    case "type":
      return ofType(ctx, src.text);
    case "number":
      return { kind: "value", type: "number" };
    case "self":
      return resolveIn({ ...ctx, at: src.at }, src.table, depth + 1);
    case "connect": {
      const signal = resolveIn({ ...ctx, at: src.at }, src.expr, depth + 1);
      if (signal?.kind !== "value" || !signal.event) return null;
      return ofType(ctx, signal.event.p?.[src.index]?.[1]);
    }
    case "iter": {
      const inner = src.expr.match(/^(i?pairs)\s*\(([\s\S]*)\)$/);
      if (src.index === 0) {
        return inner?.[1] === "ipairs" || !inner ? { kind: "value", type: "number" } : null;
      }
      const list = resolveIn({ ...ctx, at: src.at }, inner ? inner[2] : src.expr, depth + 1);
      if (list?.kind !== "value") return null;
      return ofType(ctx, elementType(list.type));
    }
    case "rhs": {
      const text = src.text.trim();
      // `x :: Part` casts win.
      const cast = text.match(/::\s*([\w.<>{}?]+)\s*$/);
      if (cast) return ofType(ctx, cast[1]);
      if (text.startsWith("{")) return table();
      if (text.startsWith("function")) return { kind: "value", type: "function" };
      if (/^["'`[]/.test(text)) return { kind: "value", type: "string" };
      if (/^-?[\d.]/.test(text)) return { kind: "value", type: "number" };
      if (/^(true|false)$/.test(text)) return { kind: "value", type: "boolean" };
      const req = text.match(/^require\s*\(([\s\S]*)\)$/);
      if (req) {
        const mod = resolveIn({ ...ctx, at: src.at }, req[1], depth + 1);
        return mod?.kind === "instance" && mod.id ? moduleTable(ctx, mod.id) : null;
      }
      const direct = resolveIn({ ...ctx, at: src.at }, text, depth + 1);
      if (direct) return direct;
      // `a or b`, `a and b`: try the first operand.
      const first = text.split(/\s+(?:or|and)\s+/)[0];
      if (first !== text) {
        const t = resolveIn({ ...ctx, at: src.at }, first, depth + 1);
        if (t) return t;
      }
      return table();
    }
  }
}

function resolveRoot(ctx: Ctx, root: string, depth: number): Target | null {
  const { tree, api } = ctx;
  if (root === "script") return instance(ctx, tree.scriptId);
  if (root === "game") return instance(ctx, tree.rootId);
  if (root === "workspace") return instance(ctx, childOfClass(ctx, tree.rootId, "Workspace"));
  if (root === "Enum") return { kind: "enums" };

  // Local variables win over globals with the same name.
  const { decl, src } = sourceOf(ctx.an, root, ctx.at);
  if (decl || src) return depth < 8 ? fromSource(ctx, root, src, depth) : null;

  if (api.datatypes[root] || api.libraries[root]) return { kind: "static", name: root };
  // A global table only assigned through fields (`M.x = …`).
  return fromSource(ctx, root, undefined, depth);
}

function step(ctx: Ctx, target: Target, s: Step, depth: number): Target | null {
  const { tree, api } = ctx;

  if (target.kind === "table") {
    if (s.kind !== "member" && s.kind !== "method" && s.kind !== "index") return null;
    const f = target.fields.find((x) => x.name === s.name);
    if (!f) return null;
    if (f.params || f.method) return { kind: "value", type: "function" };
    if (!f.rhs || depth >= 8) return null;
    return fromSource(
      { ...ctx, an: target.an, at: f.rhs.at },
      `${target.name}.${f.name}`,
      { k: "rhs", ...f.rhs },
      depth + 1,
      `${target.key}.${f.name}`,
    );
  }

  if (target.kind === "enums") {
    return s.kind === "member" && api.enums[s.name] ? { kind: "enum", name: s.name } : null;
  }
  if (target.kind === "enum") {
    return s.kind === "member" ? { kind: "value", type: "EnumItem" } : null;
  }

  if (target.kind === "static") {
    const statics = api.datatypes[target.name]?.statics ?? api.libraries[target.name] ?? [];
    if (s.kind !== "member") return null;
    const m = statics.find((x) => x.n === s.name);
    if (!m) return null;
    if (m.k === "f") return { kind: "value", type: `fn:${target.name}.${m.n}` };
    return ofType(ctx, m.t);
  }

  if (target.kind === "value") {
    // Calling a static function: `Instance.new("Part")`, `Vector3.new(...)`.
    if (s.kind === "call" && target.type.startsWith("fn:")) {
      const [ns, fn] = target.type.slice(3).split(".");
      if (ns === "Instance" && fn === "new") {
        const cls = firstString(s.args);
        return cls && api.classes[cls] ? { kind: "instance", className: cls } : null;
      }
      const m = (api.datatypes[ns]?.statics ?? api.libraries[ns] ?? []).find((x) => x.n === fn);
      return ofType(ctx, m?.t);
    }
    // `event:Wait()` returns what the event passes to its handlers.
    if (target.event && s.kind === "method" && s.name === "Wait") {
      return ofType(ctx, target.event.p?.[0]?.[1]);
    }
    const members = api.datatypes[target.type]?.members ?? [];
    const name = s.kind === "member" || s.kind === "method" ? s.name : null;
    const m = name ? members.find((x) => x.n === name) : undefined;
    return m ? ofType(ctx, m.t) : null;
  }

  // Instances.
  const { className, id } = target;
  if (s.kind === "index") return id ? instance(ctx, childNamed(tree, id, s.name)) : null;

  if (s.kind === "member") {
    if (s.name === "Parent")
      return id ? instance(ctx, tree.nodes.get(id)?.parent) : ofType(ctx, "Instance");
    const member = findMember(api, className, s.name);
    const child = id ? childNamed(tree, id, s.name) : undefined;
    if (member?.k === "e") return { kind: "value", type: "RBXScriptSignal", event: member };
    if (member?.k === "p") {
      // A property that holds an instance which is also a child (e.g. Workspace.Terrain).
      if (child && api.classes[member.t ?? ""]) return instance(ctx, child);
      return ofType(ctx, member.t);
    }
    // Properties shadow children in Roblox; otherwise a child by that name.
    if (child) return instance(ctx, child);
    // `game.Players` when the service isn't in the file: still know its class.
    if (className === "DataModel" && api.classes[s.name]?.tags?.includes("Service")) {
      return { kind: "instance", className: s.name };
    }
    return null;
  }

  if (s.kind === "method") {
    const arg = firstString(s.args);
    switch (s.name) {
      case "WaitForChild":
      case "FindFirstChild":
        if (id && arg) {
          const found = instance(ctx, childNamed(tree, id, arg));
          if (found) return found;
        }
        // `FindFirstChild("Humanoid")`: a name that's also a class name is usually that class.
        if (arg && api.classes[arg] && !api.classes[arg].tags?.includes("Service")) {
          return { kind: "instance", className: arg };
        }
        return ofType(ctx, "Instance");
      case "FindFirstChildOfClass":
      case "FindFirstChildWhichIsA":
      case "FindFirstAncestorOfClass":
      case "FindFirstAncestorWhichIsA":
        if (arg && api.classes[arg]) {
          const found =
            id && s.name.startsWith("FindFirstChild") ? childOfClass(ctx, id, arg) : undefined;
          return found ? instance(ctx, found) : { kind: "instance", className: arg };
        }
        return ofType(ctx, "Instance");
      case "GetService":
        if (arg && api.classes[arg]) {
          return (
            instance(ctx, childOfClass(ctx, tree.rootId, arg)) ?? {
              kind: "instance",
              className: arg,
            }
          );
        }
        return null;
      case "Clone":
        return { kind: "instance", className };
    }
    return ofType(ctx, findMember(api, className, s.name)?.t);
  }

  return null;
}

function resolveIn(ctx: Ctx, expr: string, depth: number): Target | null {
  if (depth > 8) return null;
  const chain = parseChain(expr);
  if (!chain) return null;
  let target = resolveRoot(ctx, chain.root, depth);
  for (const s of chain.steps) {
    if (!target) return null;
    target = step(ctx, target, s, depth);
  }
  return target;
}

/**
 * Works out what an expression refers to by following it through the place and the API:
 * `script`, `game`, `workspace`, `.Parent`, child names, `["Name"]`, WaitForChild,
 * FindFirstChild(OfClass), GetService, Instance.new, properties and events, datatypes,
 * libraries, Enum, require(), tables, and variables assigned from any of those (including
 * Connect handler parameters and loop variables). `at` is the offset the expression is at.
 */
export function resolveExpression(expr: string, at: number, an: Analysis, tree: Tree, api: Api) {
  return resolveIn({ tree, api, an, at }, expr, 0);
}
