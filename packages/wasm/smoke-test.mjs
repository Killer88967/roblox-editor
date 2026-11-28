// Loads the built WASM in Node and runs the edits the editor makes. Catches code that
// works natively but panics in the browser build (e.g. reading the system clock).
// Run: node packages/wasm/smoke-test.mjs
import { readFileSync } from "node:fs";
import { initSync, WasmEditor } from "./pkg/rbx_wasm.js";

initSync({ module: readFileSync(new URL("./pkg/rbx_wasm_bg.wasm", import.meta.url)) });

const fixture = new URL("../../crates/rbx-core/tests/fixtures/thing.rbxl", import.meta.url);
for (const [label, editor] of [
  ["empty place", WasmEditor.empty()],
  ["thing.rbxl", new WasmEditor(readFileSync(fixture))],
]) {
  const workspace = editor.nodes().find((n) => n.class === "Workspace").id;
  const create = (cls) =>
    editor.apply([{ type: "create", parent: workspace, class: cls, name: cls, properties: {} }])[0];
  const event = create("RemoteEvent");
  create("RemoteEvent");
  const part = create("Part");
  editor.apply([{ type: "setName", target: event, name: "ButtonEvent" }]);
  editor.apply([
    { type: "setProperty", target: part, key: "Transparency", value: { type: "Float32", value: 0.5 } },
  ]);
  // Duplicate = copy + paste.
  editor.apply([{ type: "paste", parent: workspace, model: editor.export([part], "binary") }]);
  editor.undo();
  editor.redo();
  // GUI property types come through as real values (not "Unsupported").
  const textLabel = create("TextLabel");
  const types = Object.fromEntries(editor.properties(textLabel).map((p) => [p.key, p.value.type]));
  if (types.FontFace !== "Font") throw new Error(`FontFace came through as ${types.FontFace}`);
  const gradient = create("UIGradient");
  const color = editor.properties(gradient).find((p) => p.key === "Color")?.value;
  if (color?.type !== "ColorSequence") throw new Error(`UIGradient.Color came through as ${color?.type}`);
  editor.apply([{ type: "setProperty", target: gradient, key: "Color", value: color }]);
  for (const id of editor.takeDirty()) editor.renderPart(id);
  editor.save("binary");

  // Play mode: a copy with the same ids that changes independently.
  const copy = editor.fork();
  if (copy.node(part)?.name !== "Part") throw new Error("fork() didn't keep instance ids");
  copy.apply([{ type: "setProperty", target: part, key: "Transparency", value: { type: "Float32", value: 1 } }]);
  copy.clearHistory();
  if (copy.canUndo()) throw new Error("clearHistory() kept undo history");
  if (copy.property(part, "Transparency")?.value !== 1) throw new Error("property() on the copy");
  if (editor.property(part, "Transparency")?.value !== 0.5) throw new Error("the copy changed the place");
  if (editor.property(part, "Nope") !== undefined) throw new Error("property() for a missing key");
  copy.attributes(part);
  copy.tags(part);
  copy.free();
  console.log(`ok: ${label}`);
}

// Reflection helpers for play mode.
const chain = WasmEditor.classChain("Part");
if (chain[0] !== "Part" || !chain.includes("BasePart") || !chain.includes("Instance")) {
  throw new Error(`classChain("Part") = ${chain}`);
}
if (WasmEditor.classChain("NotAClass").length !== 0) throw new Error("classChain for unknown classes");
const material = WasmEditor.propertyMeta("Part", "Material");
if (material?.enum !== "Material" || material?.default?.type !== "Enum") {
  throw new Error(`propertyMeta(Part.Material) = ${JSON.stringify(material)}`);
}
if (WasmEditor.propertyMeta("Part", "Transparency")?.type !== "Float32") throw new Error("propertyMeta type");
if (WasmEditor.propertyMeta("Part", "Nope") !== undefined) throw new Error("propertyMeta for a missing key");
if (!WasmEditor.enumByName("EasingStyle")?.some((i) => i.name === "Quad")) throw new Error("enumByName");
if (!WasmEditor.isServiceClass("TweenService") || WasmEditor.isServiceClass("Part")) {
  throw new Error("isServiceClass");
}
console.log("ok: play mode helpers");
