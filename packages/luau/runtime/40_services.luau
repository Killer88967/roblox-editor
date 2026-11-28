--!nocheck
-- Services, remotes and bindables. One player (the local one); server and client scripts run
-- side by side in this VM, so remotes are delivered on the next resumption cycle.
local rt = ...
local host = rt.host
local Signal = rt.Signal
local dt = rt.datatypes
local methods, events, getters, setters, registry = rt.methods, rt.events, rt.getters, rt.setters, rt.registry
local idOf, isA = rt.idOf, rt.isA
local v2, v3 = rt.v2, rt.v3

local serviceCache = {}
function rt.service(className)
	local s = serviceCache[className]
	if s then
		return s
	end
	s = rt.fromWire(host("service", className))
	serviceCache[className] = s
	return s
end

local function getter(class, key, fn)
	registry(getters, class)[key] = fn
end
local function setter(class, key, fn)
	registry(setters, class)[key] = fn
end

------------------------------------------------------------------------------------------
-- DataModel

local DM = registry(methods, "ServiceProvider")
function DM:GetService(name)
	if type(name) ~= "string" then
		error("invalid argument #1 to 'GetService' (string expected)", 2)
	end
	local ok, service = pcall(rt.service, name)
	if not ok then
		error("'" .. name .. "' is not a valid Service name", 2)
	end
	return service
end
DM.getService = DM.GetService
DM.service = DM.GetService
function DM:FindService(name)
	local ok, service = pcall(rt.service, name)
	return if ok then service else nil
end
local G = registry(methods, "DataModel")
function G:IsLoaded()
	return true
end
local closeCallbacks = {}
function G:BindToClose(fn)
	table.insert(closeCallbacks, fn)
end
function G:GetJobsInfo()
	return {}
end
function G:SetPlaceId() end
events.DataModel = { Loaded = true, Close = true }
for key, value in { PlaceId = 0, GameId = 0, JobId = "", CreatorId = 0, PlaceVersion = 0, PrivateServerId = "", PrivateServerOwnerId = 0 } do
	getter("DataModel", key, function()
		return value
	end)
end
getter("DataModel", "CreatorType", function()
	return rt.enumItem("CreatorType", "User")
end)

------------------------------------------------------------------------------------------
-- Workspace, Camera, Lighting

local WS = registry(methods, "Workspace")
function WS:Raycast()
	return nil
end
function WS:Blockcast()
	return nil
end
function WS:Spherecast()
	return nil
end
function WS:Shapecast()
	return nil
end
function WS:GetPartBoundsInBox()
	return {}
end
function WS:GetPartBoundsInRadius()
	return {}
end
function WS:GetPartsInPart()
	return {}
end
function WS:FindPartOnRay()
	return nil, v3(0, 0, 0), v3(0, 1, 0)
end
WS.FindPartOnRayWithIgnoreList = WS.FindPartOnRay
WS.FindPartOnRayWithWhitelist = WS.FindPartOnRay
function WS:GetServerTimeNow()
	return rt.unixNow()
end
function WS:GetRealPhysicsFPS()
	return 60
end
function WS:GetNumAwakeParts()
	return 0
end
getter("Workspace", "DistributedGameTime", function()
	return rt.time
end)

local CAM = registry(methods, "Camera")
function CAM:WorldToScreenPoint()
	return v3(0, 0, 0), false
end
CAM.WorldToViewportPoint = CAM.WorldToScreenPoint
function CAM:ScreenPointToRay()
	return dt.Ray.new(v3(0, 0, 0), v3(0, 0, -1))
end
CAM.ViewportPointToRay = CAM.ScreenPointToRay
function CAM:GetPartsObscuringTarget()
	return {}
end

local LT = registry(methods, "Lighting")
function LT:GetMinutesAfterMidnight()
	return self.ClockTime * 60
end
function LT:SetMinutesAfterMidnight(minutes)
	self.ClockTime = (minutes / 60) % 24
end
function LT:GetSunDirection()
	return v3(0, 1, 0)
end
function LT:GetMoonDirection()
	return v3(0, -1, 0)
end

------------------------------------------------------------------------------------------
-- RunService

local RS = registry(methods, "RunService")
events.RunService = {
	Heartbeat = true,
	RenderStepped = true,
	Stepped = true,
	PreRender = true,
	PreAnimation = true,
	PreSimulation = true,
	PostSimulation = true,
}
function RS:IsServer()
	return rt.context == "server"
end
function RS:IsClient()
	return rt.context == "client"
end
function RS:IsStudio()
	return true
end
function RS:IsRunning()
	return true
end
function RS:IsRunMode()
	return false
end
function RS:IsEdit()
	return false
end
local renderBindings = {}
function RS:BindToRenderStep(name, priority, fn)
	for i, b in renderBindings do
		if b.name == name then
			table.remove(renderBindings, i)
			break
		end
	end
	table.insert(renderBindings, { name = name, priority = priority, fn = fn, context = rt.context })
	table.sort(renderBindings, function(a, b)
		return a.priority < b.priority
	end)
end
function RS:UnbindFromRenderStep(name)
	for i, b in renderBindings do
		if b.name == name then
			table.remove(renderBindings, i)
			return
		end
	end
end

--- Fires RunService's per-frame events.
function rt.runServiceStep(step)
	local id = idOf(rt.service("RunService"))
	rt.fireEvent(id, "Stepped", rt.time, step)
	rt.fireEvent(id, "PreSimulation", step)
	rt.fireEvent(id, "PostSimulation", step)
	for _, b in table.clone(renderBindings) do
		rt.spawnIn(b.context, b.fn, step)
	end
	rt.fireEvent(id, "PreAnimation", step)
	rt.fireEvent(id, "RenderStepped", step)
	rt.fireEvent(id, "PreRender", step)
	rt.fireEvent(id, "Heartbeat", step)
end

------------------------------------------------------------------------------------------
-- Players

local PL = registry(methods, "Players")
events.Players = { PlayerAdded = true, PlayerRemoving = true, PlayerMembershipChanged = true }
function PL:GetPlayers()
	return { rt.localPlayer }
end
function PL:GetPlayerFromCharacter(character)
	if character ~= nil and character == rt.localPlayer.Character then
		return rt.localPlayer
	end
	return nil
end
function PL:GetPlayerByUserId(userId)
	return if userId == rt.localPlayer.UserId then rt.localPlayer else nil
end
function PL:GetUserIdFromNameAsync()
	return rt.localPlayer.UserId
end
function PL:GetNameFromUserIdAsync()
	return rt.localPlayer.Name
end
function PL:GetUserThumbnailAsync()
	return "rbxasset://textures/ui/GuiImagePlaceholder.png", true
end
function PL:GetCharacterAppearanceInfoAsync()
	return {}
end
function PL:GetFriendsAsync()
	return { GetCurrentPage = function()
		return {}
	end, IsFinished = true }
end
getter("Players", "LocalPlayer", function()
	return if rt.context == "client" then rt.localPlayer else nil
end)
getter("Players", "MaxPlayers", function()
	return 1
end)

local P = registry(methods, "Player")
events.Player = {
	CharacterAdded = true,
	CharacterRemoving = true,
	CharacterAppearanceLoaded = true,
	Chatted = true,
	Idled = true,
	OnTeleport = true,
}
function P:Kick(message)
	rt.output("warn", "Kicked: " .. tostring(message or "You have been kicked from the game"))
end
function P:LoadCharacter() end
function P:LoadCharacterAsync() end
function P:ClearCharacterAppearance() end
function P:GetRankInGroup()
	return 0
end
function P:GetRoleInGroup()
	return "Guest"
end
function P:IsInGroup()
	return false
end
function P:IsFriendsWith()
	return false
end
function P:GetFriendsOnline()
	return {}
end
function P:HasAppearanceLoaded()
	return true
end
function P:GetJoinData()
	return {}
end
function P:GetNetworkPing()
	return 0
end
function P:DistanceFromCharacter()
	return 0
end
function P:SetSuperSafeChat() end

-- player:GetMouse()
local mouse
local function newMouse()
	local m = {
		X = 0,
		Y = 0,
		Hit = dt.CFrame.new(),
		Origin = dt.CFrame.new(),
		Target = nil,
		TargetFilter = nil,
		TargetSurface = rt.enumItem("NormalId", "Top"),
		UnitRay = dt.Ray.new(v3(0, 0, 0), v3(0, 0, -1)),
		ViewSizeX = 0,
		ViewSizeY = 0,
		Icon = "",
		Button1Down = Signal.new("Button1Down"),
		Button1Up = Signal.new("Button1Up"),
		Button2Down = Signal.new("Button2Down"),
		Button2Up = Signal.new("Button2Up"),
		Move = Signal.new("Move"),
		Idle = Signal.new("Idle"),
		KeyDown = Signal.new("KeyDown"),
		KeyUp = Signal.new("KeyUp"),
		WheelForward = Signal.new("WheelForward"),
		WheelBackward = Signal.new("WheelBackward"),
	}
	function m:IsA(name)
		return name == "Mouse" or name == "PlayerMouse" or name == "Instance"
	end
	return setmetatable(m, { __typename = "Instance", __tostring = function()
		return "Instance"
	end })
end
function P:GetMouse()
	mouse = mouse or newMouse()
	return mouse
end
function rt.getMouse()
	return mouse
end

------------------------------------------------------------------------------------------
-- UserInputService / ContextActionService

local UIS = registry(methods, "UserInputService")
events.UserInputService = {
	InputBegan = true,
	InputEnded = true,
	InputChanged = true,
	TouchStarted = true,
	TouchEnded = true,
	TouchMoved = true,
	TouchTap = true,
	TouchLongPress = true,
	JumpRequest = true,
	TextBoxFocused = true,
	TextBoxFocusReleased = true,
	LastInputTypeChanged = true,
	WindowFocused = true,
	WindowFocusReleased = true,
}
rt.keysDown = {} -- KeyCode name -> InputObject
rt.mouseButtons = {} -- UserInputType name -> true
rt.mousePosition = v2(0, 0)
rt.touch = false
local uisState = { MouseBehavior = nil, MouseIconEnabled = true }

function UIS:IsKeyDown(keyCode)
	return rt.keysDown[keyCode.Name] ~= nil
end
function UIS:IsMouseButtonPressed(button)
	return rt.mouseButtons[button.Name] == true
end
function UIS:GetKeysPressed()
	local out = {}
	for _, input in rt.keysDown do
		table.insert(out, input)
	end
	return out
end
function UIS:GetMouseLocation()
	return rt.mousePosition
end
function UIS:GetMouseDelta()
	return v2(0, 0)
end
function UIS:GetFocusedTextBox()
	return nil
end
function UIS:GetLastInputType()
	return rt.enumItem("UserInputType", if rt.touch then "Touch" else "Keyboard")
end
function UIS:GetConnectedGamepads()
	return {}
end
function UIS:GetGamepadConnected()
	return false
end
function UIS:GetNavigationGamepads()
	return {}
end
function UIS:GetSupportedGamepadKeyCodes()
	return {}
end
function UIS:GetStringForKeyCode(keyCode)
	return keyCode.Name
end
function UIS:GetMouseButtonsPressed()
	local out = {}
	for name in rt.mouseButtons do
		table.insert(out, rt.inputObject({ type = name }))
	end
	return out
end
for key, fn in
	{
		TouchEnabled = function()
			return rt.touch
		end,
		KeyboardEnabled = function()
			return true
		end,
		MouseEnabled = function()
			return not rt.touch
		end,
		GamepadEnabled = function()
			return false
		end,
		AccelerometerEnabled = function()
			return false
		end,
		GyroscopeEnabled = function()
			return false
		end,
		VREnabled = function()
			return false
		end,
		MouseBehavior = function()
			return uisState.MouseBehavior or rt.enumItem("MouseBehavior", "Default")
		end,
		MouseIconEnabled = function()
			return uisState.MouseIconEnabled
		end,
		ModalEnabled = function()
			return false
		end,
	}
do
	getter("UserInputService", key, fn)
end
for _, key in { "MouseBehavior", "MouseIconEnabled", "ModalEnabled", "MouseDeltaSensitivity" } do
	setter("UserInputService", key, function(_, _, value)
		uisState[key] = value
	end)
end

local InputObjectMT = { __typename = "Instance" }
InputObjectMT.__index = function(self, key)
	if key == "IsModifierKeyDown" then
		return function(_, modifier)
			local map = { Shift = "LeftShift", Ctrl = "LeftControl", Alt = "LeftAlt", Meta = "LeftSuper" }
			return rt.keysDown[map[modifier.Name] or modifier.Name] ~= nil
		end
	elseif key == "IsA" then
		return function(_, name)
			return name == "InputObject" or name == "Instance"
		end
	end
	error(tostring(key) .. " is not a valid member of InputObject", 2)
end
InputObjectMT.__tostring = function()
	return "InputObject"
end

--- An InputObject from an input message: { type, key?, state?, x?, y? }
function rt.inputObject(msg)
	local position = v3(msg.x or rt.mousePosition.X, msg.y or rt.mousePosition.Y, 0)
	return setmetatable({
		KeyCode = rt.enumItem("KeyCode", msg.key or "Unknown") or rt.enumItem("KeyCode", "Unknown"),
		UserInputType = rt.enumItem("UserInputType", msg.type or "Keyboard"),
		UserInputState = rt.enumItem("UserInputState", msg.state or "Begin"),
		Position = position,
		Delta = v3(0, 0, 0),
		Name = "InputObject",
		ClassName = "InputObject",
	}, InputObjectMT)
end

local CAS = registry(methods, "ContextActionService")
local actions = {} -- name -> { fn, inputs, priority, context }
function CAS:BindAction(name, fn, createTouchButton, ...)
	actions[name] = { fn = fn, inputs = { ... }, priority = 0, context = rt.context }
end
function CAS:BindActionAtPriority(name, fn, createTouchButton, priority, ...)
	actions[name] = { fn = fn, inputs = { ... }, priority = priority, context = rt.context }
end
function CAS:UnbindAction(name)
	actions[name] = nil
end
function CAS:UnbindAllActions()
	table.clear(actions)
end
function CAS:GetBoundActionInfo(name)
	local a = actions[name]
	return if a then { inputTypes = a.inputs, priorityLevel = a.priority, createTouchButton = false } else {}
end
function CAS:GetAllBoundActionInfo()
	local out = {}
	for name, a in actions do
		out[name] = { inputTypes = a.inputs, priorityLevel = a.priority }
	end
	return out
end
function CAS:SetTitle() end
function CAS:SetDescription() end
function CAS:SetImage() end
function CAS:SetPosition() end
function CAS:GetButton()
	return nil
end
events.ContextActionService = { LocalToolEquipped = true, LocalToolUnequipped = true }

--- Runs ContextActionService handlers bound to this input (highest priority first).
function rt.runActions(input)
	local matching = {}
	for name, a in actions do
		for _, bound in a.inputs do
			if bound == input.KeyCode or bound == input.UserInputType then
				table.insert(matching, { name = name, action = a })
				break
			end
		end
	end
	table.sort(matching, function(x, y)
		return x.action.priority > y.action.priority
	end)
	for _, m in matching do
		local result
		local thread = rt.spawnIn(m.action.context, function()
			result = m.action.fn(m.name, input.UserInputState, input)
		end)
		-- Enum.ContextActionResult.Pass lets lower-priority actions see it too.
		if not (result and result.Name == "Pass") then
			break
		end
	end
end

------------------------------------------------------------------------------------------
-- Remotes and bindables

local callbacks = {} -- id -> { name -> fn }
local function callbackMember(class, name)
	setter(class, name, function(_, d, fn)
		callbacks[d.id] = callbacks[d.id] or {}
		callbacks[d.id][name] = fn
	end)
	getter(class, name, function(_, d)
		error(name .. " is a callback member of " .. d.class .. "; you can only set the callback value, get is not available", 3)
	end)
end
local function callback(id, name)
	local list = callbacks[id]
	return list and list[name]
end
rt.callback = callback

callbackMember("RemoteFunction", "OnServerInvoke")
callbackMember("RemoteFunction", "OnClientInvoke")
callbackMember("BindableFunction", "OnInvoke")
callbackMember("MarketplaceService", "ProcessReceipt")

local function requireContext(context, what)
	if rt.context ~= context then
		error(what .. " can only be called from the " .. context, 3)
	end
end

local function remoteEvent(class)
	local RE = registry(methods, class)
	events[class] = { OnServerEvent = true, OnClientEvent = true }
	function RE:FireServer(...)
		requireContext("client", "FireServer")
		local id, args = idOf(self), table.pack(...)
		rt.deferIn("server", function()
			rt.fireEvent(id, "OnServerEvent", rt.localPlayer, table.unpack(args, 1, args.n))
		end)
	end
	function RE:FireClient(player, ...)
		requireContext("server", "FireClient")
		if rt.typeof(player) ~= "Instance" or not isA(player, "Player") then
			error("FireClient: player argument must be a Player object", 2)
		end
		local id, args = idOf(self), table.pack(...)
		rt.deferIn("client", function()
			rt.fireEvent(id, "OnClientEvent", table.unpack(args, 1, args.n))
		end)
	end
	function RE:FireAllClients(...)
		requireContext("server", "FireAllClients")
		local id, args = idOf(self), table.pack(...)
		rt.deferIn("client", function()
			rt.fireEvent(id, "OnClientEvent", table.unpack(args, 1, args.n))
		end)
	end
end
remoteEvent("RemoteEvent")
remoteEvent("UnreliableRemoteEvent")

-- Calls a callback in another context and waits for its results.
local function invokeIn(context, id, name, ...)
	local fn = callback(id, name)
	local start = rt.time
	while not fn do
		-- Roblox queues the call until a callback is set.
		rt.task.wait()
		fn = callback(id, name)
		if rt.time - start > 5 and not rt.warnedInvoke then
			rt.warnedInvoke = true
			rt.output("warn", name .. " isn't set yet; the call is waiting for it")
		end
	end
	local result, waiter
	rt.spawnIn(context, function(...)
		result = table.pack(pcall(fn, ...))
		if waiter then
			rt.wake(waiter)
		end
	end, ...)
	if not result then
		waiter = coroutine.running()
		rt.suspend()
	end
	if not result[1] then
		error(result[2], 3)
	end
	return table.unpack(result, 2, result.n)
end

local RF = registry(methods, "RemoteFunction")
function RF:InvokeServer(...)
	requireContext("client", "InvokeServer")
	return invokeIn("server", idOf(self), "OnServerInvoke", rt.localPlayer, ...)
end
function RF:InvokeClient(player, ...)
	requireContext("server", "InvokeClient")
	return invokeIn("client", idOf(self), "OnClientInvoke", ...)
end

local BE = registry(methods, "BindableEvent")
events.BindableEvent = { Event = true }
function BE:Fire(...)
	rt.fireEvent(idOf(self), "Event", ...)
end

local BF = registry(methods, "BindableFunction")
function BF:Invoke(...)
	local fn = callback(idOf(self), "OnInvoke")
	if not fn then
		error("BindableFunction:Invoke() failed: OnInvoke callback isn't set", 2)
	end
	return fn(...)
end

------------------------------------------------------------------------------------------
-- Other services

local HTTP = registry(methods, "HttpService")
function HTTP:JSONEncode(value)
	local ok, result = pcall(rt.json.encode, value)
	if not ok then
		error("Can't convert to JSON: " .. tostring(result), 2)
	end
	return result
end
function HTTP:JSONDecode(text)
	local ok, result = pcall(rt.json.decode, text)
	if not ok then
		error("Can't parse JSON", 2)
	end
	return result
end
function HTTP:GenerateGUID(wrap)
	local hex = "0123456789ABCDEF"
	local function chars(n)
		local out = {}
		for i = 1, n do
			local r = math.random(1, 16)
			out[i] = hex:sub(r, r)
		end
		return table.concat(out)
	end
	local guid = chars(8) .. "-" .. chars(4) .. "-4" .. chars(3) .. "-" .. chars(4) .. "-" .. chars(12)
	return if wrap == false then guid else "{" .. guid .. "}"
end
function HTTP:UrlEncode(text)
	return (
		tostring(text):gsub("[^%w%-_%.~]", function(c)
			return string.format("%%%02X", c:byte())
		end)
	)
end
local function noHttp()
	error("HTTP requests aren't available in play mode", 3)
end
HTTP.GetAsync, HTTP.PostAsync, HTTP.RequestAsync = noHttp, noHttp, noHttp
getter("HttpService", "HttpEnabled", function()
	return false
end)

local DEB = registry(methods, "Debris")
function DEB:AddItem(item, lifetime)
	rt.task.delay(lifetime or 10, function()
		if item.Parent ~= nil or true then
			pcall(item.Destroy, item)
		end
	end)
end
DEB.addItem = DEB.AddItem

local CS = registry(methods, "CollectionService")
events.CollectionService = { TagAdded = true, TagRemoved = true }
local function tagSignals(tag)
	local s = rt.tagSignals[tag]
	if not s then
		s = { added = Signal.new("InstanceAdded"), removed = Signal.new("InstanceRemoved") }
		rt.tagSignals[tag] = s
	end
	return s
end
function CS:GetTagged(tag)
	return rt.wireList(rt.taggedIds(tag))
end
function CS:AddTag(instance, tag)
	instance:AddTag(tag)
end
function CS:RemoveTag(instance, tag)
	instance:RemoveTag(tag)
end
function CS:HasTag(instance, tag)
	return instance:HasTag(tag)
end
function CS:GetTags(instance)
	return instance:GetTags()
end
function CS:GetInstanceAddedSignal(tag)
	return tagSignals(tag).added
end
function CS:GetInstanceRemovedSignal(tag)
	return tagSignals(tag).removed
end
function CS:GetAllTags()
	return host("alltags") or {}
end

-- DataStores live in memory for the play session.
local stores = {}
local function copy(v)
	if type(v) == "table" then
		return rt.json.decode(rt.json.encode(v))
	end
	return v
end
local function dataStore(name, ordered)
	local key = (if ordered then "ordered:" else "") .. name
	if stores[key] then
		return stores[key]
	end
	local data = {}
	local store = { Name = name, ClassName = if ordered then "OrderedDataStore" else "DataStore" }
	function store:GetAsync(k)
		return copy(data[tostring(k)]), nil
	end
	function store:SetAsync(k, value)
		data[tostring(k)] = copy(value)
		return "1"
	end
	function store:UpdateAsync(k, fn)
		local new = fn(copy(data[tostring(k)]), nil)
		if new ~= nil then
			data[tostring(k)] = copy(new)
		end
		return copy(new), nil
	end
	function store:IncrementAsync(k, delta)
		local value = (tonumber(data[tostring(k)]) or 0) + (delta or 1)
		data[tostring(k)] = value
		return value
	end
	function store:RemoveAsync(k)
		local old = data[tostring(k)]
		data[tostring(k)] = nil
		return copy(old), nil
	end
	function store:GetSortedAsync(ascending, pageSize)
		local entries = {}
		for k, v in data do
			table.insert(entries, { key = k, value = v })
		end
		table.sort(entries, function(a, b)
			if ascending then
				return (tonumber(a.value) or 0) < (tonumber(b.value) or 0)
			end
			return (tonumber(a.value) or 0) > (tonumber(b.value) or 0)
		end)
		local page = {}
		for i = 1, math.min(pageSize or 50, #entries) do
			page[i] = entries[i]
		end
		return {
			IsFinished = true,
			GetCurrentPage = function()
				return page
			end,
			AdvanceToNextPageAsync = function() end,
		}
	end
	function store:ListKeysAsync()
		local keys = {}
		for k in data do
			table.insert(keys, { KeyName = k })
		end
		return {
			IsFinished = true,
			GetCurrentPage = function()
				return keys
			end,
			AdvanceToNextPageAsync = function() end,
		}
	end
	stores[key] = store
	return store
end
local DS = registry(methods, "DataStoreService")
function DS:GetDataStore(name, scope)
	return dataStore(tostring(name) .. "/" .. tostring(scope or "global"))
end
function DS:GetGlobalDataStore()
	return dataStore("<global>")
end
function DS:GetOrderedDataStore(name, scope)
	return dataStore(tostring(name) .. "/" .. tostring(scope or "global"), true)
end
function DS:GetRequestBudgetForRequestType()
	return 100
end

local MPS = registry(methods, "MarketplaceService")
events.MarketplaceService = {
	PromptGamePassPurchaseFinished = true,
	PromptProductPurchaseFinished = true,
	PromptPurchaseFinished = true,
	PromptBundlePurchaseFinished = true,
}
function MPS:UserOwnsGamePassAsync()
	return false
end
function MPS:PlayerOwnsAsset()
	return false
end
function MPS:PlayerOwnsBundle()
	return false
end
function MPS:GetProductInfo(id)
	return { Name = "Product " .. tostring(id), Description = "", PriceInRobux = 0, IsForSale = false, AssetId = id }
end
function MPS:PromptGamePassPurchase(player, id)
	rt.output("info", "Purchase prompt for game pass " .. tostring(id) .. " (not available in play mode)")
	rt.deferIn(nil, function()
		rt.fireEvent(idOf(self), "PromptGamePassPurchaseFinished", player, id, false)
	end)
end
function MPS:PromptProductPurchase(player, id)
	rt.output("info", "Purchase prompt for product " .. tostring(id) .. " (not available in play mode)")
	rt.deferIn(nil, function()
		rt.fireEvent(idOf(self), "PromptProductPurchaseFinished", player.UserId, id, false)
	end)
end
function MPS:PromptPurchase(player, id)
	rt.output("info", "Purchase prompt for asset " .. tostring(id) .. " (not available in play mode)")
	rt.deferIn(nil, function()
		rt.fireEvent(idOf(self), "PromptPurchaseFinished", player, id, false)
	end)
end

local BS = registry(methods, "BadgeService")
function BS:AwardBadge()
	return true
end
function BS:UserHasBadgeAsync()
	return false
end
function BS:GetBadgeInfoAsync(id)
	return { Name = "Badge " .. tostring(id), Description = "", IsEnabled = true }
end

local TS = registry(methods, "TeleportService")
local function noTeleport()
	rt.output("warn", "Teleporting isn't available in play mode")
end
TS.Teleport, TS.TeleportAsync, TS.TeleportToPlaceInstance, TS.TeleportToPrivateServer = noTeleport, noTeleport, noTeleport, noTeleport
function TS:GetLocalPlayerTeleportData()
	return nil
end
function TS:ReserveServer()
	return "", ""
end

local SG = registry(methods, "StarterGui")
function SG:SetCore() end
function SG:GetCore()
	return nil
end
function SG:SetCoreGuiEnabled() end
function SG:GetCoreGuiEnabled()
	return true
end

local GS = registry(methods, "GuiService")
function GS:GetGuiInset()
	return v2(0, 58), v2(0, 0)
end
function GS:IsTenFootInterface()
	return false
end
function GS:CloseInspectMenu() end
events.GuiService = { MenuOpened = true, MenuClosed = true }

local TXS = registry(methods, "TextService")
function TXS:GetTextSize(text, size, font, frameSize)
	local fontName = if rt.typeof(font) == "EnumItem" then font.Name else "SourceSans"
	local w = host("textsize", tostring(text), size, fontName, if frameSize then { frameSize.X, frameSize.Y } else nil)
	return v2(w[1], w[2])
end
function TXS:FilterStringAsync(text)
	return {
		GetNonChatStringForBroadcastAsync = function()
			return text
		end,
		GetNonChatStringForUserAsync = function()
			return text
		end,
		GetChatForUserAsync = function()
			return text
		end,
	}
end

local PS = registry(methods, "PhysicsService")
function PS:RegisterCollisionGroup() end
function PS:UnregisterCollisionGroup() end
function PS:CollisionGroupSetCollidable() end
function PS:CollisionGroupsAreCollidable()
	return true
end
function PS:IsCollisionGroupRegistered()
	return true
end
function PS:GetRegisteredCollisionGroups()
	return {}
end
function PS:SetPartCollisionGroup() end

local PF = registry(methods, "PathfindingService")
function PF:CreatePath()
	return {
		Status = rt.enumItem("PathStatus", "NoPath"),
		Blocked = Signal.new("Blocked"),
		Unblocked = Signal.new("Unblocked"),
		ComputeAsync = function() end,
		GetWaypoints = function()
			return {}
		end,
		CheckOcclusionAsync = function()
			return -1
		end,
		Destroy = function() end,
	}
end

local SS = registry(methods, "SoundService")
function SS:PlayLocalSound() end
function SS:GetListener()
	return rt.enumItem("ListenerType", "Camera"), nil
end
function SS:SetListener() end

local LS = registry(methods, "LocalizationService")
function LS:GetTranslatorForPlayerAsync()
	return {
		LocaleId = "en-us",
		Translate = function(_, _, text)
			return text
		end,
		FormatByKey = function(_, key)
			return key
		end,
	}
end
LS.GetTranslatorForPlayer = LS.GetTranslatorForPlayerAsync
LS.GetTranslatorForLocaleAsync = LS.GetTranslatorForPlayerAsync
function LS:GetCountryRegionForPlayerAsync()
	return "US"
end
