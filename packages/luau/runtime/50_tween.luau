--!nocheck
-- TweenService, GuiObject:TweenPosition/TweenSize, and easing.
local rt = ...
local Signal = rt.Signal
local registry, methods = rt.registry, rt.methods
local idOf = rt.idOf
local pi, sin, cos, sqrt = math.pi, math.sin, math.cos, math.sqrt

-- Easing for the "In" direction; Out and InOut are derived.
local function bounceOut(t)
	if t < 1 / 2.75 then
		return 7.5625 * t * t
	elseif t < 2 / 2.75 then
		t -= 1.5 / 2.75
		return 7.5625 * t * t + 0.75
	elseif t < 2.5 / 2.75 then
		t -= 2.25 / 2.75
		return 7.5625 * t * t + 0.9375
	end
	t -= 2.625 / 2.75
	return 7.5625 * t * t + 0.984375
end

local easeIn = {
	Linear = function(t)
		return t
	end,
	Sine = function(t)
		return 1 - cos(t * pi / 2)
	end,
	Quad = function(t)
		return t * t
	end,
	Cubic = function(t)
		return t * t * t
	end,
	Quart = function(t)
		return t * t * t * t
	end,
	Quint = function(t)
		return t * t * t * t * t
	end,
	Exponential = function(t)
		return if t == 0 then 0 else 2 ^ (10 * t - 10)
	end,
	Circular = function(t)
		return 1 - sqrt(1 - t * t)
	end,
	Back = function(t)
		local s = 1.70158
		return t * t * ((s + 1) * t - s)
	end,
	Elastic = function(t)
		if t == 0 or t == 1 then
			return t
		end
		return -(2 ^ (10 * t - 10)) * sin((t * 10 - 10.75) * (2 * pi / 3))
	end,
	Bounce = function(t)
		return 1 - bounceOut(1 - t)
	end,
}

function rt.ease(style: string, direction: string, t: number): number
	local f = easeIn[style] or easeIn.Quad
	if direction == "In" then
		return f(t)
	elseif direction == "Out" then
		return 1 - f(1 - t)
	end
	if t < 0.5 then
		return f(t * 2) / 2
	end
	return 1 - f((1 - t) * 2) / 2
end

local function lerp(a, b, t)
	local ta = rt.typeof(a)
	if ta == "number" then
		return a + (b - a) * t
	elseif ta == "UDim" then
		return rt.udim(a.Scale + (b.Scale - a.Scale) * t, math.floor(a.Offset + (b.Offset - a.Offset) * t + 0.5))
	elseif ta == "Vector3" or ta == "Vector2" or ta == "Color3" or ta == "UDim2" or ta == "CFrame" then
		return a:Lerp(b, t)
	elseif ta == "Rect" then
		return rt.datatypes.Rect.new(a.Min:Lerp(b.Min, t), a.Max:Lerp(b.Max, t))
	elseif ta == "NumberRange" then
		return rt.datatypes.NumberRange.new(a.Min + (b.Min - a.Min) * t, a.Max + (b.Max - a.Max) * t)
	end
	-- Booleans, enums and anything else snap at the end.
	return if t >= 1 then b else a
end

local active = {} -- running tweens
local byInstance = {} -- id -> { property -> tween }

local Tween = { __typename = "Instance" }
Tween.__index = Tween
Tween.__tostring = function()
	return "Tween"
end

local function setState(tween, name)
	tween.PlaybackState = rt.enumItem("PlaybackState", name)
end

local function release(tween)
	local index = table.find(active, tween)
	if index then
		table.remove(active, index)
	end
	local props = byInstance[idOf(tween.Instance)]
	if props then
		for prop in tween._goals do
			if props[prop] == tween then
				props[prop] = nil
			end
		end
	end
end

function Tween:Play()
	local state = self.PlaybackState.Name
	if state == "Playing" or state == "Delayed" then
		return
	end
	if state ~= "Paused" then
		self._elapsed = 0
		self._start = nil
	end
	-- A newer tween on the same property takes over.
	local id = idOf(self.Instance)
	byInstance[id] = byInstance[id] or {}
	for prop in self._goals do
		local other = byInstance[id][prop]
		if other and other ~= self then
			other:Cancel()
		end
		byInstance[id][prop] = self
	end
	setState(self, if self._elapsed < self.TweenInfo.DelayTime then "Delayed" else "Playing")
	if not table.find(active, self) then
		table.insert(active, self)
	end
end

function Tween:Pause()
	if self.PlaybackState.Name == "Playing" or self.PlaybackState.Name == "Delayed" then
		setState(self, "Paused")
		release(self)
	end
end

function Tween:Cancel()
	local state = self.PlaybackState.Name
	if state == "Completed" or state == "Cancelled" then
		return
	end
	release(self)
	self._elapsed = 0
	self._start = nil
	setState(self, "Cancelled")
	self.Completed:Fire(self.PlaybackState)
end

function Tween:Destroy()
	release(self)
end

function Tween:IsA(name)
	return name == "Tween" or name == "TweenBase" or name == "Instance"
end

local function apply(tween, alpha)
	local instance = tween.Instance
	for prop, goal in tween._goals do
		instance[prop] = lerp(tween._start[prop], goal, alpha)
	end
end

local function update(tween, step)
	local info = tween.TweenInfo
	tween._elapsed += step
	local t = tween._elapsed - info.DelayTime
	if t < 0 then
		return false
	end
	if tween.PlaybackState.Name == "Delayed" then
		setState(tween, "Playing")
	end
	if not tween._start then
		tween._start = {}
		for prop in tween._goals do
			tween._start[prop] = tween.Instance[prop]
		end
	end
	local duration = math.max(info.Time, 0)
	local cycle = if info.Reverses then duration * 2 else duration
	local repeats = info.RepeatCount
	local finished = repeats >= 0 and (cycle == 0 or t >= cycle * (repeats + 1))
	if finished then
		apply(tween, if info.Reverses then 0 else 1)
		return true
	end
	local within = if cycle == 0 then 0 else t % cycle
	local alpha
	if within <= duration then
		alpha = if duration == 0 then 1 else within / duration
	else
		alpha = 1 - (within - duration) / duration
	end
	apply(tween, rt.ease(info.EasingStyle.Name, info.EasingDirection.Name, alpha))
	return false
end

--- Advances every running tween.
function rt.tweenStep(step)
	for _, tween in table.clone(active) do
		local state = tween.PlaybackState.Name
		if state == "Playing" or state == "Delayed" then
			local ok, done = pcall(update, tween, step)
			if not ok then
				release(tween)
				setState(tween, "Cancelled")
				rt.output("error", "Tween failed: " .. tostring(done))
			elseif done then
				release(tween)
				setState(tween, "Completed")
				tween.Completed:Fire(tween.PlaybackState)
			end
		end
	end
end

local function createTween(instance, tweenInfo, goals)
	if rt.typeof(instance) ~= "Instance" then
		error("TweenService:Create: Unable to cast value to Object", 3)
	end
	if rt.typeof(tweenInfo) ~= "TweenInfo" then
		error("TweenService:Create: Argument 2 missing or nil (TweenInfo expected)", 3)
	end
	local copy = {}
	for prop, value in goals do
		copy[prop] = value
		local ok, current = pcall(function()
			return instance[prop]
		end)
		if not ok then
			error("TweenService:Create property named '" .. tostring(prop) .. "' cannot be tweened due to type mismatch (property is a 'nil', but given type is '" .. rt.typeof(value) .. "')", 3)
		end
	end
	local tween = setmetatable({
		Instance = instance,
		TweenInfo = tweenInfo,
		Name = "Tween",
		ClassName = "Tween",
		Completed = Signal.new("Completed"),
		_goals = copy,
		_elapsed = 0,
	}, Tween)
	setState(tween, "Begin")
	return tween
end

local TS = registry(methods, "TweenService")
function TS:Create(instance, tweenInfo, goals)
	return createTween(instance, tweenInfo, goals)
end
function TS:GetValue(alpha, style, direction)
	return rt.ease(style.Name, direction.Name, math.clamp(alpha, 0, 1))
end
function TS:SmoothDamp(current, target, velocity, smoothTime, maxSpeed, step)
	return target, velocity
end

-- GuiObject:TweenPosition(endPosition, easingDirection, easingStyle, time, override, callback)
local function enumArg(enumName, value, default)
	if value == nil then
		return rt.enumItem(enumName, default)
	elseif type(value) == "string" then
		return rt.enumItem(enumName, value) or rt.enumItem(enumName, default)
	end
	return value
end

local function guiTween(self, goals, direction, style, time, override, callback)
	local id = idOf(self)
	local current = byInstance[id]
	if current and not override then
		for prop in goals do
			if current[prop] then
				return false
			end
		end
	end
	local info = rt.datatypes.TweenInfo.new(
		time or 1,
		enumArg("EasingStyle", style, "Quad"),
		enumArg("EasingDirection", direction, "Out")
	)
	local tween = createTween(self, info, goals)
	if callback then
		tween.Completed:Connect(function(state)
			callback(rt.enumItem("TweenStatus", if state.Name == "Completed" then "Completed" else "Canceled"))
		end)
	end
	tween:Play()
	return true
end

local GO = registry(methods, "GuiObject")
function GO:TweenPosition(position, direction, style, time, override, callback)
	return guiTween(self, { Position = position }, direction, style, time, override, callback)
end
function GO:TweenSize(size, direction, style, time, override, callback)
	return guiTween(self, { Size = size }, direction, style, time, override, callback)
end
function GO:TweenSizeAndPosition(size, position, direction, style, time, override, callback)
	return guiTween(self, { Size = size, Position = position }, direction, style, time, override, callback)
end
