--!nocheck
-- Messages from JS. The last runtime chunk returns this dispatch function.
local rt = ...
local json = rt.json
local globals = rt.globals
local idOf = rt.idOf

local handlers = {}

-- { op = "start", game = wire, player = wire, touch = bool, timeout = seconds? }
function handlers.start(msg)
	local game = rt.fromWire(msg.game)
	rt.game = game
	globals.game = game
	globals.Game = game
	local workspace = game:GetService("Workspace")
	globals.workspace = workspace
	globals.Workspace = workspace
	rt.localPlayer = rt.fromWire(msg.player)
	rt.touch = msg.touch == true
	rt.timeout = msg.timeout or rt.timeout

	-- Server scripts first, then the player joins, then client scripts (ReplicatedFirst first).
	local runnable = rt.runnableScripts(nil)
	for _, entry in runnable do
		if entry.context == "server" then
			rt.runScript(entry.script, "server")
		end
	end
	rt.runDeferred()
	local players = game:GetService("Players")
	rt.fireEvent(idOf(players), "PlayerAdded", rt.localPlayer)
	rt.runDeferred()
	local replicatedFirst = game:GetService("ReplicatedFirst")
	local first, rest = {}, {}
	for _, entry in rt.runnableScripts(nil) do
		if entry.context == "client" then
			table.insert(if entry.script:IsDescendantOf(replicatedFirst) then first else rest, entry)
		end
	end
	for _, list in { first, rest } do
		for _, entry in list do
			rt.runScript(entry.script, "client")
		end
	end
	rt.runDeferred()
	return {}
end

-- { op = "step", dt = seconds }
function handlers.step(msg)
	local step = math.clamp(msg.dt or 1 / 60, 0, 0.25)
	rt.advance(step)
	rt.tweenStep(step)
	rt.runServiceStep(step)
	rt.runDeferred()
	return {}
end

-- GUI events from the overlay: { op = "gui", id, event, args = { wire... } }
function handlers.gui(msg)
	local instance = rt.wrap(msg.id)
	local args = {}
	for i, w in msg.args or {} do
		args[i] = rt.fromWire(w)
	end
	if msg.event == "Activated" then
		args = { rt.inputObject({ type = if rt.touch then "Touch" else "MouseButton1", state = "End" }), 1 }
	elseif msg.event == "InputBegan" or msg.event == "InputEnded" then
		args = { rt.inputObject({ type = if rt.touch then "Touch" else "MouseButton1", state = if msg.event == "InputBegan" then "Begin" else "End" }) }
	end
	rt.fireEvent(idOf(instance), msg.event, table.unpack(args))
	rt.runDeferred()
	return {}
end

-- A TextBox edited in the overlay: { op = "text", id, text }
function handlers.text(msg)
	local instance = rt.wrap(msg.id)
	instance.Text = msg.text
	rt.runDeferred()
	return {}
end

-- Keyboard and pointer input: { op = "input", state = "Begin" | "End", type, key?, x?, y?, processed? }
function handlers.input(msg)
	local input = rt.inputObject(msg)
	local began = msg.state == "Begin"
	if msg.type == "Keyboard" and msg.key then
		rt.keysDown[msg.key] = if began then input else nil
	elseif msg.type and msg.type:find("^MouseButton") then
		rt.mouseButtons[msg.type] = if began then true else nil
	end
	local uis = rt.service("UserInputService")
	rt.fireEvent(idOf(uis), if began then "InputBegan" else "InputEnded", input, msg.processed == true)
	if not msg.processed then
		rt.runActions(input)
	end
	local mouse = rt.getMouse()
	if mouse then
		if msg.type == "MouseButton1" or msg.type == "Touch" then
			(if began then mouse.Button1Down else mouse.Button1Up):Fire()
		elseif msg.type == "MouseButton2" then
			(if began then mouse.Button2Down else mouse.Button2Up):Fire()
		elseif msg.type == "Keyboard" and msg.key and #msg.key == 1 then
			(if began then mouse.KeyDown else mouse.KeyUp):Fire(msg.key:lower())
		end
	end
	rt.runDeferred()
	return {}
end

-- Pointer moved: { op = "mouse", x, y }
function handlers.mouse(msg)
	rt.mousePosition = rt.v2(msg.x, msg.y)
	local mouse = rt.getMouse()
	if mouse then
		mouse.X, mouse.Y = msg.x, msg.y
		mouse.Move:Fire()
	end
	if (rt.listening.InputChanged or 0) > 0 then
		local uis = rt.service("UserInputService")
		rt.fireEvent(idOf(uis), "InputChanged", rt.inputObject({ type = "MouseMovement", state = "Change", x = msg.x, y = msg.y }), false)
	end
	rt.runDeferred()
	return {}
end

-- A part with a ClickDetector was clicked: { op = "click", id }
function handlers.click(msg)
	rt.fireEvent(msg.id, "MouseClick", rt.localPlayer)
	rt.runDeferred()
	return {}
end

-- Evaluates code typed into the Output's command bar: { op = "eval", source }
function handlers.eval(msg)
	local env = setmetatable({}, { __index = globals })
	local fn, err = __load(msg.source, "=command", env)
	if not fn then
		rt.output("error", err)
		return {}
	end
	rt.spawnIn("server", fn)
	rt.runDeferred()
	return {}
end

return function(message)
	local msg = json.decode(message)
	local handler = handlers[msg.op]
	if not handler then
		error("unknown message: " .. tostring(msg.op))
	end
	return json.encode(handler(msg))
end
