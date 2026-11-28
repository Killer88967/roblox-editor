--!nocheck
-- Script environments, running scripts, and require.
local rt = ...
local host = rt.host
local dt = rt.datatypes
local idOf, isA = rt.idOf, rt.isA

-- Luau's own globals that scripts may use.
local builtins = {
	"assert", "error", "getmetatable", "ipairs", "next", "pairs", "pcall", "rawequal", "rawget",
	"rawlen", "rawset", "select", "setmetatable", "tonumber", "tostring", "type", "unpack",
	"xpcall", "newproxy", "gcinfo", "getfenv", "setfenv", "math", "string", "table",
	"coroutine", "os", "utf8", "bit32", "buffer", "vector",
}

local globals = {}
for _, name in builtins do
	globals[name] = _G[name]
end
-- debug without the parts Roblox doesn't give scripts.
globals.debug = {
	traceback = debug.traceback,
	info = debug.info,
	profilebegin = function() end,
	profileend = function() end,
	setmemorycategory = function() end,
	resetmemorycategory = function() end,
	dumpcodesize = function() end,
}
function globals.collectgarbage(option)
	if option == "count" then
		return gcinfo()
	end
	error("collectgarbage: only 'count' is available", 2)
end

for name, value in dt do
	globals[name] = value
end

globals.typeof = rt.typeof
globals.task = rt.task
globals.wait = rt.wait
globals.Wait = rt.wait
globals.delay = rt.delay
globals.Delay = rt.delay
globals.spawn = rt.spawn
globals.Spawn = rt.spawn
globals.tick = rt.unixNow
function globals.time()
	return rt.time
end
globals.elapsedTime = globals.time
globals.ElapsedTime = globals.time
function globals.print(...)
	rt.output("print", rt.joinArgs(...))
end
function globals.warn(...)
	rt.output("warn", rt.joinArgs(...))
end
function globals.printidentity(prefix)
	rt.output("print", (prefix or "Current identity is") .. " 2")
end
function globals.version()
	return "0.700.0.0"
end
function globals.settings()
	return setmetatable({}, {
		__index = function()
			return setmetatable({}, { __index = function() end, __newindex = function() end })
		end,
	})
end
globals.UserSettings = globals.settings
globals.shared = {}
globals._G = {}
globals._VERSION = "Luau"

globals.Instance = {
	new = function(className, parent)
		if type(className) ~= "string" then
			error("invalid argument #1 to 'new' (string expected, got " .. rt.typeof(className) .. ")", 2)
		end
		local ok, w = pcall(host, "new", className)
		if not ok then
			error(w, 2)
		end
		local instance = rt.fromWire(w)
		if parent ~= nil then
			instance.Parent = parent
		end
		return instance
	end,
	fromExisting = function(instance)
		return instance:Clone()
	end,
}

local envMeta = { __index = globals }
local function newEnv(script)
	return setmetatable({ script = script }, envMeta)
end

------------------------------------------------------------------------------------------
-- require

local moduleCache = { server = {}, client = {} }

local function moduleError(message, traceback)
	return message .. "\nStack Begin\n" .. traceback .. "\nStack End"
end

function globals.require(target)
	if type(target) == "number" or type(target) == "string" then
		error("require(" .. tostring(target) .. "): requiring by asset id or path isn't available in play mode", 2)
	end
	if rt.typeof(target) ~= "Instance" or not isA(target, "ModuleScript") then
		error("Attempted to call require with invalid argument(s).", 2)
	end
	local cache = moduleCache[rt.context]
	local id = idOf(target)
	local entry = cache[id]
	if entry then
		while entry.loading do
			if entry.thread == coroutine.running() then
				error("Requested module was required recursively", 2)
			end
			rt.task.wait()
		end
		if entry.failed then
			error("Requested module experienced an error while loading", 2)
		end
		return entry.value
	end

	entry = { loading = true, thread = coroutine.running() }
	cache[id] = entry
	local fn, err = __load(host("source", id) or "", "=" .. target:GetFullName(), newEnv(target))
	if not fn then
		entry.loading, entry.failed = false, true
		rt.output("error", err)
		error("Requested module experienced an error while loading", 2)
	end
	local results = table.pack(xpcall(fn, function(e)
		local message = if type(e) == "string" then e else tostring(e)
		local tb = {}
		for line in (debug.traceback("", 2) or ""):gmatch("[^\n]+") do
			if not line:find("^runtime/") and not line:find("%[C%]") then
				table.insert(tb, line)
			end
		end
		return moduleError(message, table.concat(tb, "\n"))
	end))
	entry.loading = false
	if not results[1] then
		entry.failed = true
		rt.output("error", results[2])
		error("Requested module experienced an error while loading", 2)
	end
	if results.n ~= 2 then
		entry.failed = true
		error("Module code did not return exactly one value", 2)
	end
	entry.value = results[2]
	return entry.value
end

------------------------------------------------------------------------------------------
-- Running scripts

local started = {} -- id -> true

local serverHomes = { Workspace = true, ServerScriptService = true }
local clientHomes = { PlayerGui = true, Backpack = true, PlayerScripts = true, ReplicatedFirst = true }
-- Templates that get copied into the player: scripts there don't run themselves.
local templates = { StarterGui = true, StarterPack = true, StarterPlayer = true, ServerStorage = true }

--- "server", "client", or nil when the script wouldn't run where it is.
function rt.scriptContext(script, ancestorClasses)
	local class = rt.info[script].class
	local inTemplate = false
	local set = {}
	for _, c in ancestorClasses do
		set[c] = true
		if templates[c] then
			inTemplate = true
		end
	end
	if inTemplate then
		return nil
	end
	if class == "Script" then
		local ok, runContext = pcall(function()
			return script.RunContext
		end)
		local mode = if ok and rt.typeof(runContext) == "EnumItem" then runContext.Name else "Legacy"
		if mode == "Server" then
			return "server"
		elseif mode == "Client" then
			return "client"
		elseif mode == "Legacy" then
			for home in serverHomes do
				if set[home] then
					return "server"
				end
			end
		end
		return nil
	elseif class == "LocalScript" then
		for home in clientHomes do
			if set[home] then
				return "client"
			end
		end
		-- The local player's character.
		if set.Model and set.Workspace and rt.localPlayer then
			local character = rt.localPlayer.Character
			if character and script:IsDescendantOf(character) then
				return "client"
			end
		end
	end
	return nil
end

function rt.runScript(script, context)
	local id = idOf(script)
	if started[id] then
		return
	end
	started[id] = true
	local fn, err = __load(host("source", id) or "", "=" .. script:GetFullName(), newEnv(script))
	if not fn then
		rt.output("error", err)
		return
	end
	rt.spawnIn(context, fn)
end

--- Scripts under `root` (or everywhere) that should run now: { script, context } in tree order.
function rt.runnableScripts(rootId)
	local out = {}
	for _, entry in host("scripts", rootId) or {} do
		local script = rt.fromWire(entry.s)
		if not started[idOf(script)] and entry.enabled then
			local context = rt.scriptContext(script, entry.a)
			if context then
				table.insert(out, { script = script, context = context })
			end
		end
	end
	return out
end

-- Scripts start when they're parented somewhere they run (e.g. a cloned tool or GUI).
function rt.onReparented(instance, parent)
	if parent == nil then
		return
	end
	for _, entry in rt.runnableScripts(idOf(instance)) do
		rt.runScript(entry.script, entry.context)
	end
end

local scriptSetters = rt.registry(rt.setters, "BaseScript")
for _, key in { "Enabled", "Disabled" } do
	scriptSetters[key] = function(self, d, value)
		if host("set", d.id, key, value) then
			rt.propertyChanged(d.id, key)
		end
		local enabled = if key == "Enabled" then value else not value
		if enabled then
			for _, entry in rt.runnableScripts(d.id) do
				if entry.script == self then
					rt.runScript(self, entry.context)
				end
			end
		end
	end
end

rt.globals = globals
