import { useEditor } from "@/stores/editor";
import type { NodeInfo, Value } from "@/lib/types";
import type { TypecheckRequest, TypecheckResponse } from "./luau-typecheck.worker";

export type TypeProblem = TypecheckResponse["problems"][number];

const SYNC_DELAY = 400;

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (problems: TypeProblem[]) => void>();
/** What the checker last got: the tree's shape, and each ModuleScript's source. */
let sentShape = "";
const sentSources = new Map<string, string>();

const post = (msg: TypecheckRequest) => worker?.postMessage(msg);

/** Sends the place's instance tree (when its shape changed) and changed ModuleScripts. */
function syncPlace() {
  const { editor, nodes, rootId } = useEditor.getState();
  if (!editor || !rootId || !nodes.has(rootId)) return;

  // Tree order: the root first, parents before children.
  const list: NodeInfo[] = [];
  const stack = [rootId];
  while (stack.length) {
    const node = nodes.get(stack.pop()!);
    if (!node) continue;
    list.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  const shape = list.map((n) => `${n.id}\t${n.parent ?? ""}\t${n.class}\t${n.name}`).join("\n");
  if (shape !== sentShape) {
    sentShape = shape;
    sentSources.clear();
    post({
      type: "place",
      nodes: list.map((n) => ({ id: n.id, parent: n.parent ?? null, class: n.class, name: n.name })),
    });
  }
  for (const n of list) {
    if (n.class !== "ModuleScript") continue;
    const value = editor.property(n.id, "Source") as Value | undefined;
    const source = value?.type === "String" ? value.value : "";
    if (sentSources.get(n.id) === source) continue;
    sentSources.set(n.id, source);
    post({ type: "source", name: n.id, source });
  }
}

function start() {
  if (worker || typeof Worker === "undefined") return worker;
  worker = new Worker(new URL("./luau-typecheck.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<TypecheckResponse>) => {
    waiting.get(e.data.id)?.(e.data.problems);
    waiting.delete(e.data.id);
  };
  syncPlace();
  // Renames, moves, new instances and ModuleScript edits change what scripts see.
  let timer: ReturnType<typeof setTimeout> | undefined;
  useEditor.subscribe((s, prev) => {
    if (s.nodes === prev.nodes && s.editor === prev.editor) return;
    clearTimeout(timer);
    timer = setTimeout(syncPlace, SYNC_DELAY);
  });
  return worker;
}

/**
 * Type checks a script (by instance id) with Luau's own checker, against Roblox's API and
 * the open place. Resolves with [] if the checker isn't available.
 */
export function typecheck(scriptId: string, source: string): Promise<TypeProblem[]> {
  if (!start()) return Promise.resolve([]);
  // The editor may hold newer text than the place for this script.
  syncPlace();
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    post({ type: "check", id, name: scriptId, source });
  });
}
