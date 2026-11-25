import type { NodeInfo } from "./types";

/** One step after the root of a chain like `script.Parent:WaitForChild("Frame").Title`. */
type Step = { kind: "member"; name: string } | { kind: "service"; name: string };

type Chain = { root: string; steps: Step[] };

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
      steps.push({ kind: "member", name: m[1] });
    } else if (
      (m = rest.match(/^\s*:\s*(?:WaitForChild|FindFirstChild)\(\s*["']([^"']+)["'][^)]*\)/))
    ) {
      steps.push({ kind: "member", name: m[1] });
    } else if ((m = rest.match(/^\s*:\s*GetService\(\s*["']([^"']+)["']\s*\)/))) {
      steps.push({ kind: "service", name: m[1] });
    } else {
      return null;
    }
    rest = rest.slice(m[0].length);
  }
  return { root: root[0], steps };
}

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

const childNamed = (tree: Tree, parent: string, name: string) =>
  tree.nodes.get(parent)?.children.find((c) => tree.nodes.get(c)?.name === name);

/**
 * Works out which instance an expression refers to, by following it through the place:
 * `script`, `game`, `workspace`, `.Parent`, child names, WaitForChild/FindFirstChild,
 * GetService, and local variables assigned from those (a few levels deep).
 */
export function resolveChain(expr: string, code: string, tree: Tree, depth = 0): string | null {
  const chain = parseChain(expr);
  if (!chain || depth > 8) return null;

  let id: string | null | undefined;
  if (chain.root === "script") id = tree.scriptId;
  else if (chain.root === "game") id = tree.rootId;
  else if (chain.root === "workspace") {
    id = tree.nodes
      .get(tree.rootId)
      ?.children.find((c) => tree.nodes.get(c)?.class === "Workspace");
  } else {
    const rhs = lastAssignment(code, chain.root);
    id = rhs ? resolveChain(rhs, code, tree, depth + 1) : null;
  }

  for (const step of chain.steps) {
    if (!id) return null;
    if (step.kind === "service") {
      id = tree.nodes
        .get(tree.rootId)
        ?.children.find((c) => tree.nodes.get(c)?.class === step.name);
    } else if (step.name === "Parent") {
      id = tree.nodes.get(id)?.parent;
    } else {
      id = childNamed(tree, id, step.name);
    }
  }
  return id ?? null;
}
