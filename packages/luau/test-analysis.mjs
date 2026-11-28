// The type checker on a few snippets. Needs wasm/analysis.wasm (build.sh) and
// types/roblox.d.luau (scripts/gen-luau-types.mjs).
//
//   node packages/luau/test-analysis.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LuauAnalyzer } from "./analysis.js";

const analyzer = await LuauAnalyzer.create({
  bytes: readFileSync(new URL("./wasm/analysis.wasm", import.meta.url)),
});

// Roblox's API loads without problems.
const definitions = readFileSync(new URL("./types/roblox.d.luau", import.meta.url), "utf8");
assert.deepEqual(analyzer.define("@roblox", definitions), []);

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

// Roblox code: classes from Instance.new and GetService, enums, datatypes, signals.
const roblox = analyzer.check(
  "Roblox",
  `--!strict
local Players = game:GetService("Players")
local part = Instance.new("Part")
part.Anchored = true
part.Size = Vector3.new(1, 2, 3) * 2
part.Material = Enum.Material.Neon
part.Parent = workspace
Players.PlayerAdded:Connect(function(player)
	print(player.Name, player.UserId + 1)
end)
local model = workspace:FindFirstChildWhichIsA("Model")
local cf = CFrame.new(1, 2, 3) * CFrame.Angles(0, math.pi, 0)
print(model, cf.Position.X, task.wait(1))
part.Anchored = 5
part:Destroyy()
local m: Enum.Material = Enum.PartType.Ball
game:GetService("NotAService")`,
);
assert.deepEqual(
  roblox.map((d) => [d.line, d.message]),
  [
    [14, "Expected this to be 'boolean', but got 'number'"],
    [15, "Key 'Destroyy' not found in external type 'Part'"],
    [16, "Expected this to be\n\t'Enum.Material'\nbut got\n\t'Enum.PartType'"],
    [17, "Unknown class or service 'NotAService'"],
  ],
);

console.log(`type checker: ${strict.length + roblox.length} problems found as expected`);

// The place: script.Parent.Coins is the TextLabel, require() follows instance paths, and a
// module's returned table is typed in the scripts that require it.
const place = [
  { id: "root", class: "DataModel", name: "Game" },
  { id: "ws", parent: "root", class: "Workspace", name: "Workspace" },
  { id: "rs", parent: "root", class: "ReplicatedStorage", name: "ReplicatedStorage" },
  { id: "config", parent: "rs", class: "ModuleScript", name: "Config" },
  { id: "gui", parent: "root", class: "StarterGui", name: "StarterGui" },
  { id: "hud", parent: "gui", class: "ScreenGui", name: "HUD" },
  { id: "coins", parent: "hud", class: "TextLabel", name: "Coins" },
  { id: "hudScript", parent: "hud", class: "LocalScript", name: "HudScript" },
  { id: "door", parent: "ws", class: "Part", name: "Door" },
];
assert.equal(analyzer.setPlace(place), place.length);
analyzer.setSource("config", `return { Speed = 16, Theme = { Raised = true } }`);
const placeProblems = analyzer.check(
  "hudScript",
  `--!strict
local coins = script.Parent.Coins
coins.Text = "Coins: 0"
coins.Text = 5
local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Config"))
local speed: number = Config.Speed
local raised: string = Config.Theme.Raised
local door = workspace.Door
door.Anchored = true
print(script.Parent.Nope, game.ReplicatedStorage.Config.Name)`,
);
assert.deepEqual(
  placeProblems.map((d) => [d.line, d.message]),
  [
    [4, "Expected this to be 'string', but got 'number'"],
    [7, "Expected this to be 'string', but got 'boolean'"],
    [10, "Key 'Nope' not found in external type 'ScreenGui'"],
  ],
);
// Editing the module changes what the script sees.
analyzer.setSource("config", `return { Speed = "fast", Theme = { Raised = "yes" } }`);
const afterEdit = analyzer.check("hudScript", `--!strict
local Config = require(script.Parent.Parent.Parent.ReplicatedStorage.Config)
local speed: number = Config.Speed`);
assert.deepEqual(afterEdit.map((d) => [d.line, d.message]), [[3, "Expected this to be 'number', but got 'string'"]]);

console.log(`type checker: place types and require work (${placeProblems.length} problems as expected)`);
