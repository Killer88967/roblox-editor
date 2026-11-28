// The type checker on a few snippets. Needs wasm/analysis.wasm (build.sh).
//
//   node packages/luau/test-analysis.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LuauAnalyzer } from "./analysis.js";

const analyzer = await LuauAnalyzer.create({
  bytes: readFileSync(new URL("./wasm/analysis.wasm", import.meta.url)),
});

const strict = analyzer.check(
  "Strict",
  `--!strict
local x: number = "hi"
local function shout(s: string)
	return s:upper()
end
print(shout(5))
local t = { a = 1 }
print(t.b)`,
);
assert.deepEqual(
  strict.map((d) => [d.line, d.message]),
  [
    [2, "Expected this to be 'number', but got 'string'"],
    [6, "Expected this to be 'string', but got 'number'"],
    [8, "Key 'b' not found in table 't'"],
  ],
);
assert.deepEqual(
  { column: strict[0].column, endColumn: strict[0].endColumn },
  { column: 19, endColumn: 23 },
);

// Fixing the code clears the problems (the module is re-checked, not cached).
assert.deepEqual(analyzer.check("Strict", `--!strict\nlocal x: number = 1`), []);

console.log(`type checker: ${strict.length} problems found as expected`);
