--!nocheck
-- Host calls, output, the thread scheduler (task library) and signals.
local rt = ...
local json = rt.json

local hostRaw = __host
local clock = __clock
local setDeadline = __deadline

-- A resumed thread may run this long before it's stopped (Roblox allows about 10 s).
rt.timeout = 5

--- Calls the JS host: host(op, ...) -> value. Host errors become Luau errors.
function rt.host(...)
	local reply = json.decode(hostRaw(json.encode({ ... })))
	if type(reply) == "table" and reply.e then
		-- No position: the member that called this adds the script's line.
		error(reply.e, 0)
	end
	return if type(reply) == "table" then reply.v else nil
end

--- A host call whose value is a table like { k = kind, v = value } (never nil).
function rt.hostReply(...)
	local reply = json.decode(hostRaw(json.encode({ ... })))
	if type(reply) == "table" and reply.e then
		error(reply.e, 0)
	end
	return reply.v or {}
end

-- typeof that knows the runtime's datatypes (tables whose metatable has __typename) and
-- instances (newproxy userdata, which Luau won't give a custom type name).
local luauTypeof = typeof
function rt.typeof(v): string
	if type(v) == "userdata" and rt.info and rt.info[v] then
		return "Instance"
	elseif type(v) == "table" then
		local mt = getmetatable(v)
		if type(mt) == "table" then
			local name = rawget(mt, "__typename")
			if name then
				return name
			end
		end
	end
	return luauTypeof(v)
end

------------------------------------------------------------------------------------------
-- Output

local function joinArgs(...): string
	local parts = table.create(select("#", ...))
	for i = 1, select("#", ...) do
		parts[i] = tostring((select(i, ...)))
	end
	return table.concat(parts, " ")
end
rt.joinArgs = joinArgs

--- kind: "print" | "warn" | "error" | "info"
function rt.output(kind: string, text: string)
	hostRaw(json.encode({ "out", kind, text }))
end

-- Runtime frames aren't useful to the person debugging their script.
local function cleanTraceback(tb: string): string
	local lines = {}
	for line in tb:gmatch("[^\n]+") do
		if not line:find("^runtime/") and not line:find("%[C%]") then
			table.insert(lines, line)
		end
	end
	return table.concat(lines, "\n")
end

function rt.reportError(err, thread)
	local msg = if type(err) == "string" then err else tostring(err)
	local tb = if thread then debug.traceback(thread) else ""
	tb = cleanTraceback(tb or "")
	if tb ~= "" then
		msg ..= "\nStack Begin\n" .. tb .. "\nStack End"
	end
	rt.output("error", msg)
end

------------------------------------------------------------------------------------------
-- Scheduler

rt.time = 0 -- seconds of play time
rt.frame = 0

-- "server" or "client": which side the running code belongs to (RunService:IsClient()).
rt.context = "server"
local threadContext = setmetatable({}, { __mode = "k" })

local waiting = {} -- { thread, at, args? } resumed once rt.time >= at
local deferred = {} -- { thread, args } resumed at the end of the current cycle
local depth = 0

function rt.contextOf(thread)
	return threadContext[thread]
end

--- Resumes a thread with its own context, reporting any error it raises.
function rt.resume(thread: thread, ...)
	if coroutine.status(thread) ~= "suspended" then
		return
	end
	local previous = rt.context
	rt.context = threadContext[thread] or previous
	depth += 1
	if depth == 1 then
		setDeadline(clock() + rt.timeout)
	end
	local ok, err = coroutine.resume(thread, ...)
	depth -= 1
	if depth == 0 then
		setDeadline(nil)
	end
	rt.context = previous
	if not ok then
		rt.reportError(err, thread)
	end
end

local function newThread(fn, context)
	local thread = if type(fn) == "thread" then fn else coroutine.create(fn)
	threadContext[thread] = context or threadContext[thread] or rt.context
	return thread
end
rt.newThread = newThread

--- Runs fn (or a thread) now, in a new thread with the given context (default: current).
function rt.spawnIn(context, fn, ...)
	local thread = newThread(fn, context)
	rt.resume(thread, ...)
	return thread
end

local function deferIn(context, fn, ...)
	local thread = newThread(fn, context)
	table.insert(deferred, { thread, table.pack(...) })
	return thread
end
rt.deferIn = deferIn

local function schedule(thread, at, args)
	table.insert(waiting, { thread, at, args })
end

local function currentThread()
	local thread, isMain = coroutine.running()
	if isMain then
		error("attempt to yield from outside a script thread", 3)
	end
	return thread
end

local function cancel(thread)
	for i = #waiting, 1, -1 do
		if waiting[i][1] == thread then
			table.remove(waiting, i)
		end
	end
	for i = #deferred, 1, -1 do
		if deferred[i][1] == thread then
			table.remove(deferred, i)
		end
	end
	if coroutine.status(thread) == "suspended" then
		coroutine.close(thread)
	end
end

local task = {}

function task.spawn(fn, ...)
	if type(fn) ~= "function" and type(fn) ~= "thread" then
		error("task.spawn expects a function or thread", 2)
	end
	return rt.spawnIn(nil, fn, ...)
end

function task.defer(fn, ...)
	if type(fn) ~= "function" and type(fn) ~= "thread" then
		error("task.defer expects a function or thread", 2)
	end
	return deferIn(nil, fn, ...)
end

function task.delay(seconds, fn, ...)
	if type(fn) ~= "function" and type(fn) ~= "thread" then
		error("task.delay expects a function or thread", 2)
	end
	local thread = newThread(fn)
	schedule(thread, rt.time + math.max(tonumber(seconds) or 0, 0), table.pack(...))
	return thread
end

function task.wait(seconds)
	local thread = currentThread()
	local start = rt.time
	-- Always at least until the next frame.
	schedule(thread, start + math.max(tonumber(seconds) or 0, 0), nil)
	coroutine.yield()
	return rt.time - start
end

function task.cancel(thread)
	cancel(thread)
end

function task.synchronize() end
function task.desynchronize() end

rt.task = task

-- Roblox's legacy globals.
function rt.wait(seconds)
	local elapsed = task.wait(math.max(tonumber(seconds) or 0, 0.03))
	return elapsed, rt.time
end

function rt.delay(seconds, fn)
	task.delay(math.max(tonumber(seconds) or 0, 0.03), fn)
end

function rt.spawn(fn)
	task.delay(0, fn)
end

--- Suspends the running thread until rt.wake(thread, ...) is called.
function rt.suspend()
	currentThread()
	return coroutine.yield()
end

function rt.wake(thread, ...)
	rt.resume(thread, ...)
end

local function runDeferred()
	-- Deferred threads may defer more; keep going until the queue is empty (bounded).
	for _ = 1, 100 do
		if #deferred == 0 then
			return
		end
		local batch = deferred
		deferred = {}
		for _, entry in batch do
			rt.resume(entry[1], table.unpack(entry[2], 1, entry[2].n))
		end
	end
end
rt.runDeferred = runDeferred

--- Advances play time and resumes every thread that's due, earliest first.
function rt.advance(dt: number)
	rt.time += dt
	rt.frame += 1
	local due = {}
	local i = 1
	while i <= #waiting do
		local entry = waiting[i]
		if entry[2] <= rt.time then
			table.insert(due, entry)
			waiting[i] = waiting[#waiting]
			waiting[#waiting] = nil
		else
			i += 1
		end
	end
	table.sort(due, function(a, b)
		return a[2] < b[2]
	end)
	for _, entry in due do
		local args = entry[3]
		if args then
			rt.resume(entry[1], table.unpack(args, 1, args.n))
		else
			rt.resume(entry[1])
		end
	end
	runDeferred()
end

------------------------------------------------------------------------------------------
-- Signals (RBXScriptSignal / RBXScriptConnection)

local Connection = { __typename = "RBXScriptConnection" }
Connection.__index = Connection

function Connection:Disconnect()
	if not self.Connected then
		return
	end
	self.Connected = false
	local list = self._signal._connections
	local index = table.find(list, self)
	if index then
		table.remove(list, index)
	end
	if self._signal._onChange then
		self._signal._onChange(#list)
	end
end

function Connection:__tostring()
	return "Connection"
end

local Signal = { __typename = "RBXScriptSignal" }
Signal.__index = Signal

function Signal.new(name: string?, onChange: ((number) -> ())?)
	return setmetatable({
		_name = name or "Signal",
		_connections = {},
		_waiting = {},
		_onChange = onChange,
	}, Signal)
end

function Signal:Connect(fn)
	if type(fn) ~= "function" then
		error("Attempt to connect failed: Passed value is not a function", 2)
	end
	local connection = setmetatable({
		Connected = true,
		_signal = self,
		_fn = fn,
		_context = rt.context,
	}, Connection)
	table.insert(self._connections, connection)
	if self._onChange then
		self._onChange(#self._connections)
	end
	return connection
end

function Signal:Once(fn)
	local connection
	connection = self:Connect(function(...)
		connection:Disconnect()
		fn(...)
	end)
	return connection
end

Signal.connect = Signal.Connect

function Signal:Wait()
	local thread = currentThread()
	table.insert(self._waiting, thread)
	return coroutine.yield()
end

--- Calls every handler in its own thread (in the context it connected from).
function Signal:Fire(...)
	if #self._connections > 0 then
		for _, connection in table.clone(self._connections) do
			if connection.Connected then
				rt.spawnIn(connection._context, connection._fn, ...)
			end
		end
	end
	if #self._waiting > 0 then
		local threads = self._waiting
		self._waiting = {}
		for _, thread in threads do
			rt.resume(thread, ...)
		end
	end
end

function Signal:HasListeners(): boolean
	return #self._connections > 0 or #self._waiting > 0
end

function Signal:DisconnectAll()
	for _, connection in table.clone(self._connections) do
		connection:Disconnect()
	end
	self._waiting = {}
end

function Signal:__tostring()
	return "Signal " .. self._name
end

rt.Signal = Signal
