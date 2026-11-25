import {
  chainBefore,
  lookup,
  sourceOf,
  type Analysis,
  type Problem,
  PRIMITIVE_TYPES,
} from "./luau-analyze";
import { resolveExpression, type Target, type Tree } from "./luau-resolve";
import { classMembers, findMember, type Api } from "./roblox-api";

/** Deprecated globals with a modern replacement. */
export const REPLACEMENTS: Record<string, string> = {
  wait: "task.wait",
  spawn: "task.spawn",
  delay: "task.delay",
  ypcall: "pcall",
};

/** Names that are always fine to use without declaring them. */
function knownNames(api: Api, an: Analysis) {
  const known = new Set<string>(["self", "_", "..."]);
  for (const g of api.globals) known.add(g.n);
  for (const n of Object.keys(api.libraries)) known.add(n);
  for (const n of Object.keys(api.datatypes)) known.add(n);
  for (const n of Object.keys(api.classes)) known.add(n);
  for (const n of PRIMITIVE_TYPES) known.add(n);
  for (const n of an.typeNames) known.add(n);
  return known;
}

const nodePath = (tree: Tree, id: string) => {
  const parts: string[] = [];
  for (let n = id; n && n !== tree.rootId; n = tree.nodes.get(n)?.parent ?? "") {
    parts.unshift(tree.nodes.get(n)?.name ?? "?");
  }
  return parts.join(".");
};

/**
 * Problems in a script, like Studio's Script Analysis: syntax errors, unknown globals,
 * unused locals, deprecated APIs, and members that don't exist on what they're used on.
 * Without the API data (still loading) only syntax and unused-variable checks run.
 */
export function diagnose(an: Analysis, tree: Tree | null, api: Api | null): Problem[] {
  const out: Problem[] = [...an.problems];
  const { toks } = an;

  // Unused locals (writes count as uses, to keep it simple).
  const uses = new Map<number, number>();
  for (const r of an.refs) {
    const d = lookup(an, toks[r].v, toks[r].s);
    if (d) uses.set(d.id, (uses.get(d.id) ?? 0) + 1);
  }
  for (const d of an.decls) {
    if (!d.isLocal || d.name.startsWith("_") || uses.get(d.id)) continue;
    if (d.kind !== "local" && d.kind !== "function") continue;
    const what = d.kind === "function" ? "Function" : "Variable";
    out.push({
      s: d.s,
      e: d.e,
      message: `${what} '${d.name}' is never used; if this is intentional, prefix it with '_' to silence`,
      severity: "warning",
      tag: "unnecessary",
      code: "unused",
      name: d.name,
    });
  }

  if (!api) return out;

  // Unknown and deprecated globals.
  const known = knownNames(api, an);
  const deprecatedGlobals = new Set(api.globals.filter((g) => g.d).map((g) => g.n));
  for (const r of an.refs) {
    const t = toks[r];
    if (lookup(an, t.v, t.s)) continue;
    const prev = toks[r - 1];
    const next = toks[r + 1];
    // Generic type parameters: `<T>`.
    if (prev?.v === "<" || next?.v === ">") continue;
    if (deprecatedGlobals.has(t.v)) {
      const use = REPLACEMENTS[t.v];
      out.push({
        s: t.s,
        e: t.e,
        message: `Global '${t.v}' is deprecated${use ? `, use '${use}' instead` : ""}`,
        severity: "hint",
        tag: "deprecated",
        code: "deprecated",
        name: t.v,
      });
      continue;
    }
    if (known.has(t.v)) continue;
    out.push({
      s: t.s,
      e: t.e,
      message: `Unknown global '${t.v}'`,
      severity: "warning",
      code: "unknown-global",
      name: t.v,
    });
  }

  if (!tree || toks.length > 60000) return out;

  // Members: `x.Name` / `x:Method()` checked against what `x` resolves to.
  const ids = new Map<object, number>();
  const cache = new Map<string, Target | null>();
  const resolve = (expr: string, at: number) => {
    const root = expr.match(/^[A-Za-z_]\w*/)?.[0] ?? "";
    const { src, decl } = sourceOf(an, root, at);
    const keyObj = src ?? decl;
    let key = "g";
    if (keyObj) {
      if (!ids.has(keyObj)) ids.set(keyObj, ids.size);
      key = String(ids.get(keyObj));
    }
    const k = `${key}|${expr}`;
    if (!cache.has(k)) cache.set(k, resolveExpression(expr, at, an, tree, api));
    return cache.get(k) ?? null;
  };

  for (let k = 1; k < toks.length; k++) {
    const t = toks[k];
    const sep = toks[k - 1];
    if (t.k !== "name" || sep.k !== "op" || (sep.v !== "." && sep.v !== ":")) continue;
    const chain = chainBefore(an, k - 1);
    if (!chain) continue;
    const target = resolve(chain.expr, chain.at);
    if (!target) continue;
    const problem = (message: string, severity: Problem["severity"], extra?: Partial<Problem>) =>
      out.push({ s: t.s, e: t.e, message, severity, code: "member", name: t.v, ...extra });

    switch (target.kind) {
      case "enums":
        if (!api.enums[t.v]) problem(`${t.v} is not a valid member of "Enum"`, "warning");
        break;
      case "enum":
        if (!api.enums[target.name]?.includes(t.v)) {
          problem(`${t.v} is not a valid member of "Enum.${target.name}"`, "warning");
        }
        break;
      case "static": {
        const list = api.datatypes[target.name]?.statics ?? api.libraries[target.name] ?? [];
        const m = list.find((x) => x.n === t.v);
        if (m?.d)
          problem(`'${target.name}.${t.v}' is deprecated`, "hint", {
            tag: "deprecated",
            code: "deprecated",
          });
        else if (!m && !list.some((x) => x.n.toLowerCase() === t.v.toLowerCase())) {
          problem(`${t.v} is not a valid member of ${target.name}`, "info");
        }
        break;
      }
      case "value": {
        const list = api.datatypes[target.type]?.members;
        if (!list) break;
        const m = list.find((x) => x.n === t.v);
        if (m?.d)
          problem(`'${target.type}.${t.v}' is deprecated`, "hint", {
            tag: "deprecated",
            code: "deprecated",
          });
        else if (!m && !list.some((x) => x.n.toLowerCase() === t.v.toLowerCase())) {
          problem(`${t.v} is not a valid member of ${target.type}`, "info");
        }
        break;
      }
      case "instance": {
        const m = findMember(api, target.className, t.v);
        if (m?.d) {
          problem(`Member '${target.className}.${t.v}' is deprecated`, "hint", {
            tag: "deprecated",
            code: "deprecated",
          });
          break;
        }
        if (m) {
          if (sep.v === ":" && m.k !== "m") {
            problem(
              `${t.v} is a ${m.k === "e" ? "event" : "property"} of ${target.className}, not a method; use '.'`,
              "warning",
            );
          }
          break;
        }
        // Old lowercase names (`:findFirstChild`, `:remove`) still work but are deprecated.
        const other = classMembers(api, target.className).find(
          (x) => x.n.toLowerCase() === t.v.toLowerCase(),
        );
        if (other && sep.v === ":") {
          problem(`'${t.v}' is deprecated, use '${other.n}' instead`, "hint", {
            tag: "deprecated",
            code: "deprecated",
          });
        } else if (sep.v === ":") {
          problem(`${t.v} is not a valid member of ${target.className}`, "warning");
        } else if (target.id) {
          const hasChild = tree.nodes
            .get(target.id)
            ?.children.some((c) => tree.nodes.get(c)?.name === t.v);
          if (!hasChild) {
            const where = nodePath(tree, target.id);
            problem(
              `${t.v} is not a valid member of ${target.className}${where ? ` "${where}"` : ""} (it may be created while the game runs)`,
              "info",
            );
          }
        }
        break;
      }
    }
  }
  return out;
}
