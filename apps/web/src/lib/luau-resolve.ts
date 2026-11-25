import type { NodeInfo } from "./types";
import { findMember, type Api, type ApiMember } from "./roblox-api";

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

/** The right-hand side of the last `local name = ...` / `name = ...` in `code`. */
function lastAssignment(code: string, name: string): string | null {
  const re = new RegExp(
    `(?:^|\\n)[ \\t]*(?:local[ \\t]+)?${name}(?:[ \\t]*:[ \\t]*[\\w.?]+)?[ \\t]*=[ \\t]*([^\\n]+)`,
    "g",
  );
  let found: string | null = null;
  for (const m of code.matchAll(re)) found = m[1];
  // Drop a trailing comment.
  return found?.replace(/--.*$/, "").trim() ?? null;
}

export type Tree = { nodes: Map<string, NodeInfo>; rootId: string; scriptId: string };

/**
 * What an expression refers to:
 * - instance: a class, and the actual instance in the place when we can tell which one
 * - value: a datatype or class value with no known instance (e.g. `RBXScriptSignal`, `Vector3`)
 * - static: a datatype or library namespace (`Vector3.`, `task.`, `Instance.`)
 * - enums / enum: `Enum.` and `Enum.Material.`
 */
export type Target =
  | { kind: "instance"; className: string; id?: string }
  | { kind: "value"; type: string; event?: ApiMember }
  | { kind: "static"; name: string }
  | { kind: "enums" }
  | { kind: "enum"; name: string };

type Ctx = { tree: Tree; api: Api; code: string };

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
  const clean = type.replace(/\?$/, "").split(/[ ,|]/)[0];
  if (ctx.api.classes[clean]) return { kind: "instance", className: clean };
  return { kind: "value", type: clean };
}

function resolveRoot(ctx: Ctx, root: string, depth: number): Target | null {
  const { tree, api } = ctx;
  if (root === "script") return instance(ctx, tree.scriptId);
  if (root === "game") return instance(ctx, tree.rootId);
  if (root === "workspace") return instance(ctx, childOfClass(ctx, tree.rootId, "Workspace"));
  if (root === "Enum") return { kind: "enums" };

  // Local variables win over globals with the same name.
  const rhs = lastAssignment(ctx.code, root);
  if (rhs) return depth < 8 ? resolveIn(ctx, rhs, depth + 1) : null;

  if (api.datatypes[root] || api.libraries[root]) return { kind: "static", name: root };
  return null;
}

function step(ctx: Ctx, target: Target, s: Step): Target | null {
  const { tree, api } = ctx;

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
  const chain = parseChain(expr);
  if (!chain) return null;
  let target = resolveRoot(ctx, chain.root, depth);
  for (const s of chain.steps) {
    if (!target) return null;
    target = step(ctx, target, s);
  }
  return target;
}

/**
 * Works out what an expression refers to by following it through the place and the API:
 * `script`, `game`, `workspace`, `.Parent`, child names, `["Name"]`, WaitForChild,
 * FindFirstChild(OfClass), GetService, Instance.new, properties and events, datatypes,
 * libraries, Enum, and local variables assigned from any of those.
 */
export function resolveExpression(expr: string, code: string, tree: Tree, api: Api) {
  return resolveIn({ tree, api, code }, expr, 0);
}

/** Matches the chain right before a `.`/`:` (or a word being typed after one). */
export const CHAIN_BEFORE =
  /([A-Za-z_]\w*(?:\s*(?:\.\s*[A-Za-z_]\w*|:\s*\w+\s*\([^()]*\)|\(\s*[^()]*\)|\[\s*["'][^"']+["']\s*\]))*)\s*([.:])\s*(\w*)$/;
