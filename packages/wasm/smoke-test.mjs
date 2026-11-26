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
  for (const id of editor.takeDirty()) editor.renderPart(id);
  editor.save("binary");
  console.log(`ok: ${label}`);
}
