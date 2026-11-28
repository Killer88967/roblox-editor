// Play mode end to end: a place with server, client and module scripts, run through the
// real Luau runtime and the web app's host (apps/web/src/lib/play/host.ts) on the real
// WASM editor. Needs the WASM package built (packages/wasm/pkg) and Node 22.18+.
//
//   node packages/luau/test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LuauVM } from "./index.js";
import { PlayHost } from "../../apps/web/src/lib/play/host.ts";

const here = new URL(".", import.meta.url);
// RBXE_WASM lets a local run swap in a different build of the WASM package.
const wasm = await import(process.env.RBXE_WASM ?? "../wasm/pkg/rbx_wasm.js");
if (process.env.RBXE_WASM) wasm.initSync();
else wasm.initSync({ module: readFileSync(new URL("../wasm/pkg/rbx_wasm_bg.wasm", here)) });
const { WasmEditor } = wasm;

// --- The place ------------------------------------------------------------------------

const place = WasmEditor.empty();
const top = Object.fromEntries(
  place.nodes().filter((n) => n.parent === place.rootId()).map((n) => [n.class, n.id]),
);
const str = (value) => ({ type: "String", value });
const created = new Map();
function add(parent, className, name, properties = {}) {
  const id = WasmEditor.newId();
  place.apply([{ type: "create", parent, class: className, name, properties, id }]);
  created.set(name, id);
  return id;
}
const script = (parent, className, name, source) => add(parent, className, name, { Source: str(source) });

const rs = top.ReplicatedStorage;
script(rs, "ModuleScript", "Config", `return { Theme = { Raised = true }, Speed = 16 }`);
script(rs, "ModuleScript", "Broken", `error("module exploded")`);
add(rs, "RemoteEvent", "ButtonEvent");
add(rs, "RemoteFunction", "GetCoins");

script(top.ServerScriptService, "Script", "Main", `
local RS = game:GetService("ReplicatedStorage")
local Config = require(RS.Config)
print("speed", Config.Speed, Config.Theme.Raised)

local part = Instance.new("Part")
part.Name = "Spawned"
part.Anchored = true
part.Size = Vector3.new(4, 1, 2)
part.Position = Vector3.new(0, 10, 0)
part.BrickColor = BrickColor.new("Really red")
part.Material = Enum.Material.Neon
part:SetAttribute("Health", 50)
part.Parent = workspace
print("part", part:GetFullName(), part.Position, part:GetAttribute("Health"), part.Material)

RS.ButtonEvent.OnServerEvent:Connect(function(player, msg)
	print("server got", player.Name, msg)
	RS.ButtonEvent:FireClient(player, "thanks")
end)
RS.GetCoins.OnServerInvoke = function(player, n)
	task.wait(0.1)
	return n * 2
end

local ok, err = pcall(require, RS.Broken)
print("broken", ok, err)

local tween = game:GetService("TweenService"):Create(part, TweenInfo.new(0.5, Enum.EasingStyle.Linear), { Transparency = 1 })
tween.Completed:Connect(function(state)
	print("tween", state.Name, part.Transparency)
end)
tween:Play()

game:GetService("Players").PlayerAdded:Connect(function(p)
	print("joined", p.Name)
end)

local folder = Instance.new("Folder", workspace)
folder.Name = "Stuff"
folder.ChildAdded:Connect(function(c)
	print("added", c.Name)
end)
local copy = part:Clone()
copy.Name = "Copy"
copy.Parent = folder
copy:GetPropertyChangedSignal("Name"):Connect(function()
	print("renamed", copy.Name)
end)
copy.Name = "Copy2"
copy:Destroy()
print("destroyed", copy.Parent, copy.Name)

local ok2, err2 = pcall(function()
	part.Transparency = "lots"
end)
print("bad set", err2)
print("ctx", game:GetService("RunService"):IsServer(), game:GetService("Players").LocalPlayer)

task.spawn(function()
	error("thread oops")
end)
local t = os.clock()
task.wait(0.25)
print("waited", time() >= 0.25)
`);

const menu = add(top.StarterGui, "ScreenGui", "Menu");
const panel = add(menu, "Frame", "Panel", {
  Position: { type: "UDim2", value: { x: { scale: 0, offset: 0 }, y: { scale: 0, offset: 0 } } },
});
add(panel, "TextButton", "Buy", { Text: str("Buy") });
script(menu, "LocalScript", "MenuScript", `
local Players = game:GetService("Players")
local RS = game:GetService("ReplicatedStorage")
local button = script.Parent.Panel.Buy
print("client", script.Parent.Parent.Name, Players.LocalPlayer.Name, game:GetService("RunService"):IsClient())
button.MouseButton1Click:Connect(function()
	RS.ButtonEvent:FireServer("buy pressed")
	local coins = RS.GetCoins:InvokeServer(21)
	button.Text = "Coins: " .. coins
end)
RS.ButtonEvent.OnClientEvent:Connect(function(msg)
	print("client got", msg)
end)
script.Parent.Panel:TweenPosition(UDim2.new(0.5, 0, 0.5, 0), "Out", "Quad", 0.3, true)
`);

const starterPlayerScripts = add(top.StarterPlayer, "StarterPlayerScripts", "StarterPlayerScripts");
script(starterPlayerScripts, "LocalScript", "Input", `
local UIS = game:GetService("UserInputService")
local gui = game:GetService("Players").LocalPlayer:WaitForChild("PlayerGui"):WaitForChild("Menu")
print("found", gui.Name, gui.Panel.Buy.Text)
UIS.InputBegan:Connect(function(input, processed)
	print("key", input.KeyCode.Name, processed)
end)
`);

script(top.ServerScriptService, "Script", "Extras", `
print("types", typeof(workspace), typeof(Vector3.new()), typeof(CFrame.new()), typeof(Enum.Material.Neon), typeof(game.Changed), typeof(UDim2.new()))
local cf = CFrame.new(1, 2, 3) * CFrame.Angles(0, math.rad(90), 0)
local p = cf * Vector3.new(1, 0, 0)
print("cframe", math.round(p.X), math.round(p.Y), math.round(p.Z), cf:Inverse() * cf == CFrame.identity or (cf:Inverse() * cf):FuzzyEq(CFrame.identity))
print("color", Color3.fromRGB(255, 128, 0):ToHex(), Color3.fromHex("#00ff00").G, UDim2.fromScale(0.5, 1) + UDim2.fromOffset(10, 0))

local CollectionService = game:GetService("CollectionService")
local a = Instance.new("Part", workspace)
a.Name = "TaggedA"
CollectionService:AddTag(a, "Lava")
CollectionService:GetInstanceAddedSignal("Lava"):Connect(function(i) print("tag added", i.Name) end)
local b = Instance.new("Part", workspace)
b.Name = "TaggedB"
b:AddTag("Lava")
print("tagged", #CollectionService:GetTagged("Lava"), b:HasTag("Lava"))

local store = game:GetService("DataStoreService"):GetDataStore("Coins")
store:SetAsync("u1", { coins = 5 })
store:UpdateAsync("u1", function(old) old.coins += 1 return old end)
print("datastore", store:GetAsync("u1").coins, store:IncrementAsync("visits", 2))

local fn = Instance.new("BindableFunction")
fn.OnInvoke = function(x) return x + 1, "ok" end
print("bindable", fn:Invoke(41))
local ok, err = pcall(function() return fn.OnInvoke end)
print("callback read", ok, err)

local holder = Instance.new("Folder")
holder:GetAttributeChangedSignal("Level"):Connect(function() print("level", holder:GetAttribute("Level")) end)
holder:SetAttribute("Level", 3)

local t = task.delay(10, function() print("never") end)
task.cancel(t)

local v = Instance.new("NumberValue", workspace)
v.Changed:Connect(function(n) print("value changed", n) end)
v.Value = 7
local tween = game:GetService("TweenService"):Create(v, TweenInfo.new(0.1, Enum.EasingStyle.Linear, Enum.EasingDirection.In, 1, true), { Value = 10 })
tween.Completed:Connect(function(s) print("yoyo", s.Name, v.Value) end)
tween:Play()

print("find", workspace:FindFirstChildWhichIsA("BasePart") ~= nil, workspace:FindFirstChildOfClass("NumberValue") == v, #workspace:GetDescendants() > 3)
print("enum missing", pcall(function() return Enum.NotAThing end))
print("member missing", select(2, pcall(function() return workspace.NotAChild end)))
print("bad class", select(2, pcall(Instance.new, "NotAClass")))
print("timeout child", workspace:WaitForChild("Nope", 0.1))
`);
script(top.Workspace, "Script", "Spin", `while true do end`);
script(top.Workspace, "Script", "Syntax", `local x = = 1`);
script(top.ServerStorage ?? rs, "Script", "Template", `print("templates don't run")`);

// --- Play -----------------------------------------------------------------------------

const editor = place.fork();
// The play copy keeps instance ids, so selection and open scripts carry over.
if (!process.env.RBXE_WASM) assert.equal(editor.node(menu)?.name, "Menu");
const output = [];
const host = new PlayHost(editor, WasmEditor, {
  output: (kind, text) => output.push(`${kind}: ${text}`),
});
const { player, playerGui } = host.setupPlayer();
const vm = await LuauVM.create({
  bytes: readFileSync(new URL("./wasm/luau.wasm", here)),
  onHost: (m) => host.handle(m),
  onOutput: (t) => output.push(`stdout: ${t}`),
});
const send = (msg) => vm.send(JSON.stringify(msg));
send({ op: "start", game: host.wire(editor.rootId()), player: host.wire(player), timeout: 0.3 });
for (let i = 0; i < 60; i++) send({ op: "step", dt: 1 / 60 });

const byName = (root, name) => host.descendants(root).find((id) => host.node(id)?.name === name);
const buy = byName(playerGui, "Buy");
assert.ok(buy, "StarterGui was copied into PlayerGui");
send({ op: "gui", id: buy, event: "MouseButton1Click" });
for (let i = 0; i < 30; i++) send({ op: "step", dt: 1 / 60 });
send({ op: "input", state: "Begin", type: "Keyboard", key: "W" });

const has = (pattern) => output.some((line) => (typeof pattern === "string" ? line.includes(pattern) : pattern.test(line)));
const expectations = [
  "print: speed 16 true",
  "print: part Workspace.Spawned 0, 10, 0 50 Enum.Material.Neon",
  "print: broken false Requested module experienced an error while loading",
  /error: ReplicatedStorage\.Broken:1: module exploded/,
  "print: joined Player1",
  "print: added Copy",
  "print: renamed Copy2",
  "print: destroyed nil Copy2",
  /print: bad set ServerScriptService\.Main:\d+: Unable to assign property Transparency\. number expected, got string$/,
  "print: ctx true nil",
  /error: ServerScriptService\.Main:\d+: thread oops/,
  "print: waited true",
  "print: tween Completed 1",
  "print: client PlayerGui Player1 true",
  "print: found Menu Buy",
  "print: server got Player1 buy pressed",
  "print: client got thanks",
  "print: key W false",
  "error: Script timeout: exhausted allowed execution time",
  /error: Workspace\.Syntax:1: Expected identifier/,
  "print: types Instance Vector3 CFrame EnumItem RBXScriptSignal UDim2",
  "print: cframe 1 2 2 true",
  "print: color FF8000 1 {0.5, 10}, {1, 0}",
  "print: tag added TaggedB",
  "print: tagged 2 true",
  "print: datastore 6 2",
  "print: bindable 42 ok",
  /print: callback read false ServerScriptService\.Extras:\d+: OnInvoke is a callback member of BindableFunction; you can only set the callback value, get is not available/,
  "print: level 3",
  "print: value changed 7",
  "print: yoyo Completed 7",
  "print: find true true true",
  /print: enum missing false .*NotAThing is not a valid member of "Enum"/,
  /print: member missing .*NotAChild is not a valid member of Workspace "Workspace"/,
  /print: bad class .*Unable to create an Instance of type "NotAClass"/,
  "print: timeout child nil",
];
const missing = expectations.filter((e) => !has(e));
if (missing.length) {
  console.log(output.join("\n"));
  assert.fail(`missing output: ${missing.join(" | ")}`);
}
assert.ok(!has("templates don't run"), "scripts in ServerStorage don't run");
assert.ok(!has("never"), "task.cancel stops a delayed thread");
assert.ok(!output.some((l) => l.startsWith("stdout:")), "nothing printed outside the runtime");

const prop = (id, key) => editor.property(id, key);
const workspace = host.node(editor.rootId()).children.find((c) => host.node(c).class === "Workspace");
const spawned = byName(workspace, "Spawned");
assert.deepEqual(prop(spawned, "Color").value, [255, 0, 0]);
assert.equal(prop(spawned, "Material").value, 288);
assert.equal(prop(spawned, "Transparency").value, 1);
assert.deepEqual(prop(spawned, "CFrame").value.position, [0, 10, 0]);
assert.equal(prop(buy, "Text").value, "Coins: 42");
assert.deepEqual(prop(byName(playerGui, "Panel"), "Position").value, {
  x: { scale: 0.5, offset: 0 },
  y: { scale: 0.5, offset: 0 },
});
assert.equal(host.node(byName(workspace, "Stuff")).children.length, 0);
// The edit copy is untouched.
assert.equal(place.nodes().some((n) => n.name === "Spawned"), false);

console.log(`play mode: ${expectations.length} checks passed`);
