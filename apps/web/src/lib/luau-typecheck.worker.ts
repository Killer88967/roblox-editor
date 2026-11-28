/// <reference lib="webworker" />
// Runs Luau's type checker (packages/luau, analysis.wasm) off the main thread: loading
// Roblox's API takes about a second, and big scripts take a while to check.
import { LuauAnalyzer, robloxDefinitionsUrl, type PlaceNode } from "@rbxe/luau/analysis";

export type TypecheckRequest =
  | { type: "place"; nodes: PlaceNode[] }
  | { type: "source"; name: string; source: string }
  | { type: "check"; id: number; name: string; source: string };

export type TypecheckResponse = {
  id: number;
  problems: { line: number; column: number; endLine: number; endColumn: number; message: string }[];
};

let analyzer: Promise<LuauAnalyzer> | null = null;
// Kept so a fresh checker (after a crash) can be brought back to the same state.
let place: PlaceNode[] | null = null;
const sources = new Map<string, string>();

async function start() {
  const [a, definitions] = await Promise.all([
    LuauAnalyzer.create(),
    fetch(robloxDefinitionsUrl).then((r) => r.text()),
  ]);
  const problems = a.define("@roblox", definitions);
  if (problems.length) console.warn("Roblox types didn't load cleanly:", problems.slice(0, 3));
  if (place) a.setPlace(place);
  for (const [name, source] of sources) a.setSource(name, source);
  return a;
}

// One message at a time, in order.
let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<TypecheckRequest>) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      analyzer ??= start();
      const a = await analyzer;
      if (msg.type === "place") {
        place = msg.nodes;
        a.setPlace(msg.nodes);
      } else if (msg.type === "source") {
        sources.set(msg.name, msg.source);
        a.setSource(msg.name, msg.source);
      } else {
        const response: TypecheckResponse = { id: msg.id, problems: a.check(msg.name, msg.source) };
        self.postMessage(response);
      }
    } catch (err) {
      // A crash inside the checker leaves it unusable: start over next time.
      console.warn("Luau type checker:", err);
      analyzer = null;
      if (msg.type === "check") self.postMessage({ id: msg.id, problems: [] } satisfies TypecheckResponse);
    }
  });
};
