--!nocheck
-- Instances: proxies over the play copy of the place (kept in JS), with Roblox's members.
local rt = ...
local host, hostReply = rt.host, rt.hostReply
local Signal = rt.Signal
local dt = rt.datatypes
local v3, v2, c3, cf, udim, udim2 = rt.v3, rt.v2, rt.c3, rt.cf, rt.udim, rt.udim2

local proxies = {} -- id -> proxy
local info = setmetatable({}, { __mode = "k" }) -- proxy -> { id, class }
local destroyed = {} -- id -> true
rt.info = info

------------------------------------------------------------------------------------------
-- Values to and from the host ("wire" values)

local fromWireTypes = {
	Vector3 = function(v)
		return v3(v[1], v[2], v[3])
	end,
	Vector2 = function(v)
		return v2(v[1], v[2])
	end,
	Color3 = function(v)
		return c3(v[1], v[2], v[3])
	end,
	CFrame = function(v)
		local p, o = v.position, v.orientation
		return cf(p[1], p[2], p[3], o[1][1], o[1][2], o[1][3], o[2][1], o[2][2], o[2][3], o[3][1], o[3][2], o[3][3])
	end,
	UDim = function(v)
		return udim(v.scale, v.offset)
	end,
	UDim2 = function(v)
		return udim2(v.x.scale, v.x.offset, v.y.scale, v.y.offset)
	end,
	Rect = function(v)
		return dt.Rect.new(v.min[1], v.min[2], v.max[1], v.max[2])
	end,
	NumberRange = function(v)
		return dt.NumberRange.new(v.min, v.max)
	end,
	ColorSequence = function(v)
		local keys = {}
		for i, k in v do
			keys[i] = rt.ColorSequenceKeypoint.new(k.time, c3(k.color[1], k.color[2], k.color[3]))
		end
		return rt.ColorSequence.new(keys)
	end,
	NumberSequence = function(v)
		local keys = {}
		for i, k in v do
			keys[i] = rt.NumberSequenceKeypoint.new(k.time, k.value, k.envelope)
		end
		return rt.NumberSequence.new(keys)
	end,
	Font = function(v)
		return rt.makeFont(v.family, v.weight, v.italic)
	end,
	BrickColor = function(v)
		return dt.BrickColor.new(v)
	end,
}

function rt.fromWire(w)
	if type(w) ~= "table" then
		return w
	end
	local id = w["$i"]
	if id then
		return rt.wrap(id, w.c)
	end
	local enumName = w["$e"]
	if enumName then
		return rt.enumItem(enumName, w.n or w.v) or w.v
	end
	local t = w["$t"]
	if t then
		local convert = fromWireTypes[t]
		return if convert then convert(w.v) else nil
	end
	return w
end

local toWireTypes = {
	Vector3 = function(v)
		return { v.X, v.Y, v.Z }
	end,
	Vector2 = function(v)
		return { v.X, v.Y }
	end,
	Color3 = function(v)
		return { v.R, v.G, v.B }
	end,
	CFrame = function(c)
		return { position = { c[1], c[2], c[3] }, orientation = { { c[4], c[5], c[6] }, { c[7], c[8], c[9] }, { c[10], c[11], c[12] } } }
	end,
	UDim = function(u)
		return { scale = u.Scale, offset = u.Offset }
	end,
	UDim2 = function(u)
		return { x = { scale = u.X.Scale, offset = u.X.Offset }, y = { scale = u.Y.Scale, offset = u.Y.Offset } }
	end,
	Rect = function(r)
		return { min = { r.Min.X, r.Min.Y }, max = { r.Max.X, r.Max.Y } }
	end,
	NumberRange = function(r)
		return { min = r.Min, max = r.Max }
	end,
	ColorSequence = function(s)
		local out = {}
		for i, k in s.Keypoints do
			out[i] = { time = k.Time, color = { k.Value.R, k.Value.G, k.Value.B } }
		end
		return out
	end,
	NumberSequence = function(s)
		local out = {}
		for i, k in s.Keypoints do
			out[i] = { time = k.Time, value = k.Value, envelope = k.Envelope }
		end
		return out
	end,
	Font = function(f)
		return { family = f.Family, weight = f.Weight.Value, italic = f.Style.Name == "Italic" }
	end,
	BrickColor = function(b)
		return { number = b.Number, color = { b.Color.R, b.Color.G, b.Color.B } }
	end,
}

function rt.toWire(v)
	local t = rt.typeof(v)
	if t == "nil" or t == "boolean" or t == "number" or t == "string" then
		return v
	elseif t == "Instance" then
		return { ["$i"] = info[v].id }
	elseif t == "EnumItem" then
		return { ["$e"] = rawget(v, "EnumType")._name, n = v.Name, v = v.Value }
	end
	local convert = toWireTypes[t]
	if convert then
		return { ["$t"] = t, v = convert(v) }
	end
	return { ["$t"] = t }
end

------------------------------------------------------------------------------------------
-- Classes and members

local classes = {}

function rt.classInfo(name: string)
	local c = classes[name]
	if c then
		return c
	end
	local chain = host("chain", name)
	if not chain or #chain == 0 then
		chain = { name, "Instance" }
	end
	local set = {}
	for _, n in chain do
		set[n] = true
	end
	c = { name = name, chain = chain, set = set, members = {}, setters = {} }
	classes[name] = c
	return c
end

local function isA(proxy, className)
	local d = info[proxy]
	return d ~= nil and rt.classInfo(d.class).set[className] == true
end
rt.isA = isA

-- Registries keyed by class name: methods[class][key] = fn, events[class] = { name = true },
-- getters/setters[class][key] = fn(proxy, data, value?).
local methods, events, getters, setters = {}, {}, {}, {}
rt.methods, rt.events, rt.getters, rt.setters = methods, events, getters, setters

local function registry(reg, class)
	reg[class] = reg[class] or {}
	return reg[class]
end
rt.registry = registry

local function resolveMember(c, key)
	for _, class in c.chain do
		local m = methods[class]
		if m and m[key] then
			return { kind = "method", fn = m[key] }
		end
		local e = events[class]
		if e and e[key] then
			return { kind = "event" }
		end
		local g = getters[class]
		if g and g[key] then
			return { kind = "get", fn = g[key] }
		end
	end
	return false
end

local function resolveSetter(c, key)
	for _, class in c.chain do
		local s = setters[class]
		if s and s[key] then
			return s[key]
		end
	end
	return false
end

------------------------------------------------------------------------------------------
-- Signals per instance

local signals = {} -- id -> { name -> Signal }
local propertySignals = {} -- id -> { property -> Signal }
local attributeSignals = {} -- id -> { attribute -> Signal }
rt.listening = {} -- event name -> number of connections (to skip work nobody listens for)

local function countListeners(name)
	local previous = 0
	return function(n)
		rt.listening[name] = (rt.listening[name] or 0) + (n - previous)
		previous = n
	end
end

function rt.getSignal(id, name)
	local list = signals[id]
	if not list then
		list = {}
		signals[id] = list
	end
	local s = list[name]
	if not s then
		s = Signal.new(name, countListeners(name))
		list[name] = s
	end
	return s
end

--- Fires an instance event if anything is listening to it.
function rt.fireEvent(id, name, ...)
	local list = signals[id]
	local s = list and list[name]
	if s then
		s:Fire(...)
	end
end

function rt.hasListeners(id, name)
	local list = signals[id]
	local s = list and list[name]
	return s ~= nil and s:HasListeners()
end

function rt.propertyChanged(id, key)
	local props = propertySignals[id]
	if props and props[key] then
		props[key]:Fire()
	end
	local list = signals[id]
	if list and list.Changed then
		local proxy = proxies[id]
		if proxy and isA(proxy, "ValueBase") then
			-- ValueBase.Changed only fires for Value, and passes the new value.
			if key == "Value" then
				list.Changed:Fire(proxy.Value)
			end
		else
			list.Changed:Fire(key)
		end
	end
end

------------------------------------------------------------------------------------------
-- Proxies

local function fullName(proxy)
	local d = info[proxy]
	return host("fullname", d.id) or d.class
end

local function index(self, key)
	local d = info[self]
	if type(key) ~= "string" then
		error("invalid member " .. tostring(key) .. " of " .. d.class, 2)
	end
	local c = rt.classInfo(d.class)
	local m = c.members[key]
	if m == nil then
		m = resolveMember(c, key)
		c.members[key] = m
	end
	if m then
		if m.kind == "method" then
			return m.fn
		elseif m.kind == "event" then
			return rt.getSignal(d.id, key)
		end
		local value, handled = m.fn(self, d)
		if handled ~= false then
			return value
		end
	end
	local reply = hostReply("get", d.id, key)
	if reply.k == "p" or reply.k == "c" then
		return rt.fromWire(reply.v)
	end
	error(key .. " is not a valid member of " .. d.class .. ' "' .. fullName(self) .. '"', 2)
end

local function newindex(self, key, value)
	local d = info[self]
	local c = rt.classInfo(d.class)
	local setter = c.setters[key]
	if setter == nil then
		setter = resolveSetter(c, key)
		c.setters[key] = setter
	end
	if setter then
		setter(self, d, value)
		return
	end
	local member = c.members[key]
	if member == nil then
		member = resolveMember(c, key)
		c.members[key] = member
	end
	if member and member.kind ~= "get" then
		error("Unable to assign property " .. key .. ". Property is read only", 2)
	end
	local ok, changed = pcall(host, "set", d.id, key, rt.toWire(value))
	if not ok then
		error(changed, 2)
	end
	if changed then
		rt.propertyChanged(d.id, key)
	end
end

local function tostr(self)
	local d = info[self]
	return host("name", d.id) or d.class
end

function rt.wrap(id, class)
	if id == nil then
		return nil
	end
	local p = proxies[id]
	if p then
		return p
	end
	class = class or host("classof", id) or "Instance"
	p = newproxy(true)
	local mt = getmetatable(p)
	mt.__index = index
	mt.__newindex = newindex
	mt.__tostring = tostr
	mt.__type = "Instance"
	mt.__metatable = "The metatable is locked"
	info[p] = { id = id, class = class }
	proxies[id] = p
	return p
end

local function idOf(proxy)
	local d = info[proxy]
	return d and d.id
end
rt.idOf = idOf

local function list(wires)
	local out = table.create(#wires)
	for i, w in wires do
		out[i] = rt.fromWire(w)
	end
	return out
end
rt.wireList = list

local function checkInstance(v, fnName, index)
	if rt.typeof(v) ~= "Instance" then
		error(string.format("invalid argument #%d to '%s' (Instance expected, got %s)", index, fnName, rt.typeof(v)), 3)
	end
end

------------------------------------------------------------------------------------------
-- Instance members

local I = registry(methods, "Instance")
events.Instance = {
	Changed = true,
	ChildAdded = true,
	ChildRemoved = true,
	DescendantAdded = true,
	DescendantRemoving = true,
	AncestryChanged = true,
	Destroying = true,
	AttributeChanged = true,
}

function I:FindFirstChild(name, recursive)
	return rt.fromWire(host("find", idOf(self), tostring(name), recursive == true))
end
function I:FindFirstDescendant(name)
	return rt.fromWire(host("find", idOf(self), tostring(name), true))
end
function I:FindFirstChildOfClass(className)
	return rt.fromWire(host("findclass", idOf(self), className, false, true))
end
function I:FindFirstChildWhichIsA(className, recursive)
	return rt.fromWire(host("findclass", idOf(self), className, recursive == true, false))
end
local function ancestors(self)
	return list(host("ancestors", idOf(self)))
end
function I:FindFirstAncestor(name)
	for _, a in ancestors(self) do
		if a.Name == name then
			return a
		end
	end
	return nil
end
function I:FindFirstAncestorOfClass(className)
	for _, a in ancestors(self) do
		if info[a].class == className then
			return a
		end
	end
	return nil
end
function I:FindFirstAncestorWhichIsA(className)
	for _, a in ancestors(self) do
		if isA(a, className) then
			return a
		end
	end
	return nil
end
function I:GetChildren()
	return list(host("children", idOf(self)))
end
function I:GetDescendants()
	return list(host("descendants", idOf(self)))
end
function I:IsA(className)
	return isA(self, className)
end
function I:IsDescendantOf(other)
	if other == nil then
		return false
	end
	checkInstance(other, "IsDescendantOf", 1)
	for _, a in ancestors(self) do
		if a == other then
			return true
		end
	end
	return false
end
function I:IsAncestorOf(other)
	if other == nil then
		return false
	end
	return other:IsDescendantOf(self)
end
function I:GetFullName()
	return fullName(self)
end
function I:GetDebugId()
	return idOf(self)
end
function I:GetActor()
	return nil
end
function I:IsPropertyModified()
	return false
end
function I:ResetPropertyToDefault() end

function I:WaitForChild(name, timeout)
	local child = self:FindFirstChild(name)
	if child then
		return child
	end
	local start = rt.time
	local warned = false
	while true do
		rt.task.wait()
		child = self:FindFirstChild(name)
		if child then
			return child
		end
		local elapsed = rt.time - start
		if timeout and elapsed >= timeout then
			return nil
		end
		if not timeout and not warned and elapsed >= 5 then
			warned = true
			rt.output("warn", 'Infinite yield possible on \'' .. fullName(self) .. ':WaitForChild("' .. tostring(name) .. '")\'')
		end
	end
end

function I:Destroy()
	local id = idOf(self)
	if destroyed[id] then
		return
	end
	rt.fireEvent(id, "Destroying")
	local parent = rt.fromWire(host("parentof", id))
	local all = host("destroy", id) -- ids of the instance and its descendants
	for _, gone in all or { id } do
		destroyed[gone] = true
		local s = signals[gone]
		if s then
			for _, signal in s do
				signal:DisconnectAll()
			end
			signals[gone] = nil
		end
		propertySignals[gone] = nil
		rt.onDestroyed(gone)
	end
	if parent then
		rt.fireEvent(idOf(parent), "ChildRemoved", self)
	end
end
I.destroy = I.Destroy
I.Remove = function(self)
	self.Parent = nil
end
I.remove = I.Remove

function I:ClearAllChildren()
	for _, child in self:GetChildren() do
		child:Destroy()
	end
end

function I:Clone()
	local w = host("clone", idOf(self))
	local copy = rt.fromWire(w)
	if copy then
		rt.copyInstanceState(idOf(self), idOf(copy))
	end
	return copy
end
I.clone = I.Clone
I.findFirstChild = I.FindFirstChild
I.getChildren = I.GetChildren
I.children = I.GetChildren
I.isA = I.IsA
I.isDescendantOf = I.IsDescendantOf

function I:GetPropertyChangedSignal(property)
	local id = idOf(self)
	local props = propertySignals[id]
	if not props then
		props = {}
		propertySignals[id] = props
	end
	local s = props[property]
	if not s then
		s = Signal.new(property)
		props[property] = s
	end
	return s
end

-- Attributes: seeded from the place file, then kept here.
local attributes = {} -- id -> { name -> value }
local function attrsOf(id)
	local a = attributes[id]
	if not a then
		a = {}
		for name, w in host("attrs", id) or {} do
			a[name] = rt.fromWire(w)
		end
		attributes[id] = a
	end
	return a
end
local attributeTypes = {
	["nil"] = true,
	string = true,
	boolean = true,
	number = true,
	UDim = true,
	UDim2 = true,
	BrickColor = true,
	Color3 = true,
	Vector2 = true,
	Vector3 = true,
	CFrame = true,
	NumberSequence = true,
	ColorSequence = true,
	NumberRange = true,
	Rect = true,
	Font = true,
	EnumItem = true,
}
function I:GetAttribute(name)
	return attrsOf(idOf(self))[name]
end
function I:GetAttributes()
	return table.clone(attrsOf(idOf(self)))
end
function I:SetAttribute(name, value)
	if type(name) ~= "string" then
		error("invalid argument #1 to 'SetAttribute' (string expected)", 2)
	end
	if not attributeTypes[rt.typeof(value)] then
		error(rt.typeof(value) .. " is not a supported attribute type", 2)
	end
	local id = idOf(self)
	local a = attrsOf(id)
	if a[name] == value then
		return
	end
	a[name] = value
	local s = attributeSignals[id]
	if s and s[name] then
		s[name]:Fire()
	end
	rt.fireEvent(id, "AttributeChanged", name)
end
function I:GetAttributeChangedSignal(name)
	local id = idOf(self)
	local s = attributeSignals[id]
	if not s then
		s = {}
		attributeSignals[id] = s
	end
	s[name] = s[name] or Signal.new(name)
	return s[name]
end

-- Tags (CollectionService): seeded from the place file, then kept here.
local tags = {} -- id -> { tag -> true }
rt.tagSignals = {} -- tag -> { added = Signal, removed = Signal }
local function tagsOf(id)
	local t = tags[id]
	if not t then
		t = {}
		for _, tag in host("tags", id) or {} do
			t[tag] = true
		end
		tags[id] = t
	end
	return t
end
rt.tagsOf = tagsOf
function rt.taggedIds(tag)
	local out, seen = {}, {}
	for _, w in host("tagged", tag) or {} do
		local id = w["$i"]
		seen[id] = true
		if not tags[id] or tags[id][tag] then
			table.insert(out, w)
		end
	end
	for id, t in tags do
		if t[tag] and not seen[id] and not destroyed[id] then
			table.insert(out, { ["$i"] = id })
		end
	end
	return out
end
function I:AddTag(tag)
	local t = tagsOf(idOf(self))
	if not t[tag] then
		t[tag] = true
		local s = rt.tagSignals[tag]
		if s then
			s.added:Fire(self)
		end
	end
end
function I:RemoveTag(tag)
	local t = tagsOf(idOf(self))
	if t[tag] then
		t[tag] = nil
		local s = rt.tagSignals[tag]
		if s then
			s.removed:Fire(self)
		end
	end
end
function I:HasTag(tag)
	return tagsOf(idOf(self))[tag] == true
end
function I:GetTags()
	local out = {}
	for tag in tagsOf(idOf(self)) do
		table.insert(out, tag)
	end
	return out
end

--- After Clone: carry over attributes and tags changed at runtime (root only).
function rt.copyInstanceState(fromId, toId)
	if attributes[fromId] then
		attributes[toId] = table.clone(attributes[fromId])
	end
	if tags[fromId] then
		tags[toId] = table.clone(tags[fromId])
	end
end

local S = registry(setters, "Instance")
local G = registry(getters, "Instance")

function G.ClassName(self, d)
	return d.class
end
function S.ClassName()
	error("Unable to assign property ClassName. Property is read only", 3)
end

function S.Name(self, d, value)
	if value == nil then
		error("Unable to assign property Name. string expected, got nil", 3)
	end
	if host("set", d.id, "Name", tostring(value)) then
		rt.propertyChanged(d.id, "Name")
	end
end

function S.Parent(self, d, value)
	if value ~= nil and rt.typeof(value) ~= "Instance" then
		error("Unable to assign property Parent. Object expected, got " .. rt.typeof(value), 3)
	end
	if destroyed[d.id] then
		error(
			"The Parent property of " .. tostr(self) .. " is locked, current parent: NULL, new parent " .. (if value then tostr(value) else "NULL"),
			3
		)
	end
	local old = rt.fromWire(host("parentof", d.id))
	if old == value then
		return
	end
	local ok, err = pcall(host, "set", d.id, "Parent", rt.toWire(value))
	if not ok then
		error(err, 3)
	end
	if old then
		rt.fireEvent(idOf(old), "ChildRemoved", self)
		if (rt.listening.DescendantRemoving or 0) > 0 then
			rt.fireEvent(idOf(old), "DescendantRemoving", self)
			for _, a in ancestors(old) do
				rt.fireEvent(idOf(a), "DescendantRemoving", self)
			end
		end
	end
	if value then
		rt.fireEvent(idOf(value), "ChildAdded", self)
		if (rt.listening.DescendantAdded or 0) > 0 then
			local added = { self }
			for _, desc in self:GetDescendants() do
				table.insert(added, desc)
			end
			local targets = { value }
			for _, a in ancestors(value) do
				table.insert(targets, a)
			end
			for _, target in targets do
				for _, inst in added do
					rt.fireEvent(idOf(target), "DescendantAdded", inst)
				end
			end
		end
	end
	rt.propertyChanged(d.id, "Parent")
	rt.fireEvent(d.id, "AncestryChanged", self, value)
	rt.onReparented(self, value)
end

-- Overridden by the scripts and services files.
function rt.onReparented(instance, parent) end
function rt.onDestroyed(id) end

------------------------------------------------------------------------------------------
-- Parts and models (no physics: positions only change when scripts set them)

local PV = registry(methods, "PVInstance")
local BP = registry(methods, "BasePart")
local BPget = registry(getters, "BasePart")
local BPset = registry(setters, "BasePart")
events.BasePart = { Touched = true, TouchEnded = true }

local function setCFrame(part, value)
	part.CFrame = value
end

function BPget.Position(self)
	return self.CFrame.Position
end
function BPset.Position(self, d, value)
	local c = self.CFrame
	setCFrame(self, c.Rotation + value)
	rt.propertyChanged(d.id, "Position")
end
function BPget.Orientation(self)
	local x, y, z = self.CFrame:ToOrientation()
	return v3(math.deg(x), math.deg(y), math.deg(z))
end
function BPset.Orientation(self, d, value)
	local c = self.CFrame
	setCFrame(self, dt.CFrame.new(c.Position) * dt.CFrame.fromOrientation(math.rad(value.X), math.rad(value.Y), math.rad(value.Z)))
	rt.propertyChanged(d.id, "Orientation")
end
function BPget.Rotation(self)
	local x, y, z = self.CFrame:ToEulerAnglesXYZ()
	return v3(math.deg(x), math.deg(y), math.deg(z))
end
function BPset.Rotation(self, d, value)
	local c = self.CFrame
	setCFrame(self, dt.CFrame.new(c.Position) * dt.CFrame.Angles(math.rad(value.X), math.rad(value.Y), math.rad(value.Z)))
	rt.propertyChanged(d.id, "Rotation")
end
function BPget.BrickColor(self)
	return rt.nearestBrickColor(self.Color)
end
function BPset.BrickColor(self, d, value)
	self.Color = value.Color
	rt.propertyChanged(d.id, "BrickColor")
end
local zero = v3(0, 0, 0)
for _, name in { "AssemblyLinearVelocity", "AssemblyAngularVelocity", "Velocity", "RotVelocity" } do
	BPget[name] = function()
		return zero
	end
	BPset[name] = function() end
end
function BPget.AssemblyMass(self)
	local s = self.Size
	return s.X * s.Y * s.Z * 0.7
end

function BP:GetPivot()
	return self.CFrame
end
function BP:PivotTo(target)
	self.CFrame = target
end
function BP:GetMass()
	local s = self.Size
	return s.X * s.Y * s.Z * 0.7
end
function BP:GetTouchingParts()
	return {}
end
function BP:GetConnectedParts()
	return { self }
end
function BP:GetJoints()
	return {}
end
function BP:SetNetworkOwner() end
function BP:SetNetworkOwnershipAuto() end
function BP:GetNetworkOwner()
	return nil
end
function BP:CanSetNetworkOwnership()
	return true
end
function BP:ApplyImpulse() end
function BP:ApplyAngularImpulse() end
function BP:ApplyImpulseAtPosition() end
function BP:BreakJoints() end
function BP:MakeJoints() end
function BP:GetVelocityAtPosition()
	return zero
end
function BP:GetClosestPointOnSurface(p)
	return p
end

local function parts(model)
	local out = {}
	for _, d in model:GetDescendants() do
		if isA(d, "BasePart") then
			table.insert(out, d)
		end
	end
	return out
end

local function boundingBox(model)
	local found = parts(model)
	if #found == 0 then
		return dt.CFrame.new(), zero
	end
	local min, max = v3(math.huge, math.huge, math.huge), v3(-math.huge, -math.huge, -math.huge)
	for _, part in found do
		local c, s = part.CFrame, part.Size / 2
		for _, corner in
			{ v3(s.X, s.Y, s.Z), v3(-s.X, s.Y, s.Z), v3(s.X, -s.Y, s.Z), v3(s.X, s.Y, -s.Z), v3(-s.X, -s.Y, s.Z), v3(-s.X, s.Y, -s.Z), v3(s.X, -s.Y, -s.Z), v3(-s.X, -s.Y, -s.Z) }
		do
			local p = c * corner
			min, max = min:Min(p), max:Max(p)
		end
	end
	return dt.CFrame.new((min + max) / 2), max - min
end

function PV:GetPivot()
	if isA(self, "BasePart") then
		return self.CFrame
	end
	local primary = self.PrimaryPart
	if primary then
		return primary.CFrame
	end
	return (boundingBox(self))
end
function PV:PivotTo(target)
	if isA(self, "BasePart") then
		self.CFrame = target
		return
	end
	local delta = target * self:GetPivot():Inverse()
	for _, part in parts(self) do
		part.CFrame = delta * part.CFrame
	end
end

local M = registry(methods, "Model")
function M:GetBoundingBox()
	return boundingBox(self)
end
function M:GetExtentsSize()
	local _, size = boundingBox(self)
	return size
end
function M:SetPrimaryPartCFrame(target)
	if not self.PrimaryPart then
		error("Model:SetPrimaryPartCFrame() failed because no PrimaryPart has been set, or the PrimaryPart no longer exists.", 2)
	end
	self:PivotTo(target)
end
function M:GetPrimaryPartCFrame()
	local primary = self.PrimaryPart
	return if primary then primary.CFrame else nil
end
function M:MoveTo(position)
	local pivot = self:GetPivot()
	self:PivotTo(pivot.Rotation + position)
end
function M:TranslateBy(delta)
	self:PivotTo(self:GetPivot() + delta)
end
function M:GetScale()
	return 1
end
function M:ScaleTo() end

------------------------------------------------------------------------------------------
-- Misc classes

events.GuiButton = {
	MouseButton1Click = true,
	MouseButton1Down = true,
	MouseButton1Up = true,
	MouseButton2Click = true,
	MouseButton2Down = true,
	MouseButton2Up = true,
	Activated = true,
}
events.GuiObject = {
	MouseEnter = true,
	MouseLeave = true,
	MouseMoved = true,
	InputBegan = true,
	InputEnded = true,
	InputChanged = true,
	TouchTap = true,
	TouchLongPress = true,
	MouseWheelForward = true,
	MouseWheelBackward = true,
	SelectionGained = true,
	SelectionLost = true,
}
events.TextBox = { FocusLost = true, Focused = true, ReturnPressedFromOnScreenKeyboard = true }
events.ClickDetector = { MouseClick = true, RightMouseClick = true, MouseHoverEnter = true, MouseHoverLeave = true }
events.ProximityPrompt = {
	Triggered = true,
	TriggerEnded = true,
	PromptShown = true,
	PromptHidden = true,
	PromptButtonHoldBegan = true,
	PromptButtonHoldEnded = true,
}
events.Sound = { Ended = true, Played = true, Paused = true, Resumed = true, Stopped = true, Loaded = true, DidLoop = true }
events.Tool = { Activated = true, Deactivated = true, Equipped = true, Unequipped = true }
events.Humanoid = {
	Died = true,
	HealthChanged = true,
	Running = true,
	Jumping = true,
	StateChanged = true,
	MoveToFinished = true,
	Touched = true,
}

local TB = registry(methods, "TextBox")
function TB:CaptureFocus()
	rt.fireEvent(idOf(self), "Focused")
end
function TB:ReleaseFocus(submitted)
	rt.fireEvent(idOf(self), "FocusLost", submitted == true, nil)
end
function TB:IsFocused()
	return false
end

local SND = registry(methods, "Sound")
function SND:Play()
	self.Playing = true
	rt.fireEvent(idOf(self), "Played", self.SoundId)
end
function SND:Stop()
	self.Playing = false
	rt.fireEvent(idOf(self), "Stopped", self.SoundId)
end
function SND:Pause()
	self.Playing = false
	rt.fireEvent(idOf(self), "Paused", self.SoundId)
end
function SND:Resume()
	self.Playing = true
	rt.fireEvent(idOf(self), "Resumed", self.SoundId)
end

local HUM = registry(methods, "Humanoid")
function HUM:TakeDamage(amount)
	local health = math.max(self.Health - amount, 0)
	self.Health = health
	rt.fireEvent(idOf(self), "HealthChanged", health)
	if health <= 0 then
		rt.fireEvent(idOf(self), "Died")
	end
end
function HUM:MoveTo() end
function HUM:ChangeState() end
function HUM:GetState()
	return rt.enumItem("HumanoidStateType", "Running")
end
function HUM:EquipTool() end
function HUM:UnequipTools() end

-- Animations don't play (no characters), but scripts can set them up.
local function animationTrack(animation)
	local track = {
		Animation = animation,
		IsPlaying = false,
		Looped = false,
		Length = 0,
		Speed = 1,
		TimePosition = 0,
		WeightCurrent = 0,
		Stopped = Signal.new("Stopped"),
		Ended = Signal.new("Ended"),
		DidLoop = Signal.new("DidLoop"),
		KeyframeReached = Signal.new("KeyframeReached"),
	}
	function track:Play()
		self.IsPlaying = true
	end
	function track:Stop()
		self.IsPlaying = false
		self.Stopped:Fire()
	end
	function track:AdjustSpeed(speed)
		self.Speed = speed
	end
	function track:AdjustWeight() end
	function track:GetMarkerReachedSignal(name)
		return Signal.new(name)
	end
	return setmetatable(track, { __typename = "Instance" })
end
HUM.LoadAnimation = function(_, animation)
	return animationTrack(animation)
end
registry(methods, "Animator").LoadAnimation = HUM.LoadAnimation
registry(methods, "AnimationController").LoadAnimation = HUM.LoadAnimation
