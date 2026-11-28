--!nocheck
-- Roblox datatypes: Vector3, Vector2, CFrame, Color3, UDim, UDim2, BrickColor, Enum, ...
local rt = ...

local sqrt, abs, sin, cos, atan2, clamp = math.sqrt, math.abs, math.sin, math.cos, math.atan2, math.clamp
local fmt = tostring

local function noMember(typeName)
	return function(_, key)
		error(tostring(key) .. " is not a valid member of " .. typeName, 2)
	end
end

local function readOnly(typeName)
	return function(_, key)
		error(tostring(key) .. " cannot be assigned to", 2)
	end
end

local function isA(v, name)
	return rt.typeof(v) == name
end

local function badArg(fnName, index, expected, got)
	error(string.format("invalid argument #%d to '%s' (%s expected, got %s)", index, fnName, expected, rt.typeof(got)), 3)
end

local function num(v, fnName, index, default)
	if v == nil and default ~= nil then
		return default
	end
	local n = tonumber(v)
	if n == nil then
		badArg(fnName, index, "number", v)
	end
	return n
end

------------------------------------------------------------------------------------------
-- Vector3

local Vector3 = {}
local V3 = { __typename = "Vector3" }
local V3methods = {}

local function v3(x, y, z)
	return setmetatable({ X = x, Y = y, Z = z }, V3)
end

function V3.__index(self, key)
	local m = V3methods[key]
	if m then
		return m
	end
	if key == "Magnitude" or key == "magnitude" then
		return sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
	elseif key == "Unit" or key == "unit" then
		local m = sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
		if m == 0 then
			return v3(0 / 0, 0 / 0, 0 / 0)
		end
		return v3(self.X / m, self.Y / m, self.Z / m)
	elseif key == "x" then
		return self.X
	elseif key == "y" then
		return self.Y
	elseif key == "z" then
		return self.Z
	end
	error(tostring(key) .. " is not a valid member of Vector3", 2)
end
V3.__newindex = readOnly("Vector3")

function V3.__add(a, b)
	if not isA(a, "Vector3") or not isA(b, "Vector3") then
		error("attempt to perform arithmetic (add) on " .. rt.typeof(a) .. " and " .. rt.typeof(b), 2)
	end
	return v3(a.X + b.X, a.Y + b.Y, a.Z + b.Z)
end
function V3.__sub(a, b)
	if not isA(a, "Vector3") or not isA(b, "Vector3") then
		error("attempt to perform arithmetic (sub) on " .. rt.typeof(a) .. " and " .. rt.typeof(b), 2)
	end
	return v3(a.X - b.X, a.Y - b.Y, a.Z - b.Z)
end
function V3.__mul(a, b)
	if type(a) == "number" then
		return v3(a * b.X, a * b.Y, a * b.Z)
	elseif type(b) == "number" then
		return v3(a.X * b, a.Y * b, a.Z * b)
	elseif isA(a, "Vector3") and isA(b, "Vector3") then
		return v3(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
	end
	error("attempt to perform arithmetic (mul) on " .. rt.typeof(a) .. " and " .. rt.typeof(b), 2)
end
function V3.__div(a, b)
	if type(a) == "number" then
		return v3(a / b.X, a / b.Y, a / b.Z)
	elseif type(b) == "number" then
		return v3(a.X / b, a.Y / b, a.Z / b)
	end
	return v3(a.X / b.X, a.Y / b.Y, a.Z / b.Z)
end
function V3.__idiv(a, b)
	if type(b) == "number" then
		return v3(a.X // b, a.Y // b, a.Z // b)
	end
	return v3(a.X // b.X, a.Y // b.Y, a.Z // b.Z)
end
function V3.__unm(a)
	return v3(-a.X, -a.Y, -a.Z)
end
function V3.__eq(a, b)
	return a.X == b.X and a.Y == b.Y and a.Z == b.Z
end
function V3.__tostring(a)
	return fmt(a.X) .. ", " .. fmt(a.Y) .. ", " .. fmt(a.Z)
end

function V3methods:Lerp(goal, alpha)
	return v3(self.X + (goal.X - self.X) * alpha, self.Y + (goal.Y - self.Y) * alpha, self.Z + (goal.Z - self.Z) * alpha)
end
function V3methods:Dot(o)
	return self.X * o.X + self.Y * o.Y + self.Z * o.Z
end
function V3methods:Cross(o)
	return v3(self.Y * o.Z - self.Z * o.Y, self.Z * o.X - self.X * o.Z, self.X * o.Y - self.Y * o.X)
end
function V3methods:FuzzyEq(o, epsilon)
	epsilon = epsilon or 1e-5
	return abs(self.X - o.X) <= epsilon and abs(self.Y - o.Y) <= epsilon and abs(self.Z - o.Z) <= epsilon
end
function V3methods:Max(...)
	local x, y, z = self.X, self.Y, self.Z
	for _, o in { ... } do
		x, y, z = math.max(x, o.X), math.max(y, o.Y), math.max(z, o.Z)
	end
	return v3(x, y, z)
end
function V3methods:Min(...)
	local x, y, z = self.X, self.Y, self.Z
	for _, o in { ... } do
		x, y, z = math.min(x, o.X), math.min(y, o.Y), math.min(z, o.Z)
	end
	return v3(x, y, z)
end
function V3methods:Abs()
	return v3(abs(self.X), abs(self.Y), abs(self.Z))
end
function V3methods:Ceil()
	return v3(math.ceil(self.X), math.ceil(self.Y), math.ceil(self.Z))
end
function V3methods:Floor()
	return v3(math.floor(self.X), math.floor(self.Y), math.floor(self.Z))
end
function V3methods:Sign()
	return v3(math.sign(self.X), math.sign(self.Y), math.sign(self.Z))
end
function V3methods:Angle(o, axis)
	local angle = atan2(self:Cross(o).Magnitude, self:Dot(o))
	if axis and self:Cross(o):Dot(axis) < 0 then
		return -angle
	end
	return angle
end

function Vector3.new(x, y, z)
	return v3(num(x, "Vector3.new", 1, 0), num(y, "Vector3.new", 2, 0), num(z, "Vector3.new", 3, 0))
end
Vector3.zero = v3(0, 0, 0)
Vector3.one = v3(1, 1, 1)
Vector3.xAxis = v3(1, 0, 0)
Vector3.yAxis = v3(0, 1, 0)
Vector3.zAxis = v3(0, 0, 1)
function Vector3.FromNormalId(id)
	local n = if type(id) == "number" then id else id.Value
	return ({ [0] = v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), v3(-1, 0, 0), v3(0, -1, 0), v3(0, 0, -1) })[n]
end
function Vector3.FromAxis(axis)
	local n = if type(axis) == "number" then axis else axis.Value
	return ({ [0] = v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1) })[n]
end
rt.v3 = v3

------------------------------------------------------------------------------------------
-- Vector2

local Vector2 = {}
local V2 = { __typename = "Vector2" }
local V2methods = {}

local function v2(x, y)
	return setmetatable({ X = x, Y = y }, V2)
end

function V2.__index(self, key)
	local m = V2methods[key]
	if m then
		return m
	end
	if key == "Magnitude" or key == "magnitude" then
		return sqrt(self.X * self.X + self.Y * self.Y)
	elseif key == "Unit" or key == "unit" then
		local m = sqrt(self.X * self.X + self.Y * self.Y)
		return if m == 0 then v2(0 / 0, 0 / 0) else v2(self.X / m, self.Y / m)
	elseif key == "x" then
		return self.X
	elseif key == "y" then
		return self.Y
	end
	error(tostring(key) .. " is not a valid member of Vector2", 2)
end
V2.__newindex = readOnly("Vector2")
function V2.__add(a, b)
	return v2(a.X + b.X, a.Y + b.Y)
end
function V2.__sub(a, b)
	return v2(a.X - b.X, a.Y - b.Y)
end
function V2.__mul(a, b)
	if type(a) == "number" then
		return v2(a * b.X, a * b.Y)
	elseif type(b) == "number" then
		return v2(a.X * b, a.Y * b)
	end
	return v2(a.X * b.X, a.Y * b.Y)
end
function V2.__div(a, b)
	if type(b) == "number" then
		return v2(a.X / b, a.Y / b)
	end
	return v2(a.X / b.X, a.Y / b.Y)
end
function V2.__idiv(a, b)
	if type(b) == "number" then
		return v2(a.X // b, a.Y // b)
	end
	return v2(a.X // b.X, a.Y // b.Y)
end
function V2.__unm(a)
	return v2(-a.X, -a.Y)
end
function V2.__eq(a, b)
	return a.X == b.X and a.Y == b.Y
end
function V2.__tostring(a)
	return fmt(a.X) .. ", " .. fmt(a.Y)
end
function V2methods:Lerp(goal, alpha)
	return v2(self.X + (goal.X - self.X) * alpha, self.Y + (goal.Y - self.Y) * alpha)
end
function V2methods:Dot(o)
	return self.X * o.X + self.Y * o.Y
end
function V2methods:Cross(o)
	return self.X * o.Y - self.Y * o.X
end
function V2methods:FuzzyEq(o, epsilon)
	epsilon = epsilon or 1e-5
	return abs(self.X - o.X) <= epsilon and abs(self.Y - o.Y) <= epsilon
end
function V2methods:Abs()
	return v2(abs(self.X), abs(self.Y))
end
function V2methods:Ceil()
	return v2(math.ceil(self.X), math.ceil(self.Y))
end
function V2methods:Floor()
	return v2(math.floor(self.X), math.floor(self.Y))
end
function V2methods:Sign()
	return v2(math.sign(self.X), math.sign(self.Y))
end
function V2methods:Max(...)
	local x, y = self.X, self.Y
	for _, o in { ... } do
		x, y = math.max(x, o.X), math.max(y, o.Y)
	end
	return v2(x, y)
end
function V2methods:Min(...)
	local x, y = self.X, self.Y
	for _, o in { ... } do
		x, y = math.min(x, o.X), math.min(y, o.Y)
	end
	return v2(x, y)
end
function V2methods:Angle(o, signed)
	local angle = atan2(self:Cross(o), self:Dot(o))
	return if signed then angle else abs(angle)
end

function Vector2.new(x, y)
	return v2(num(x, "Vector2.new", 1, 0), num(y, "Vector2.new", 2, 0))
end
Vector2.zero = v2(0, 0)
Vector2.one = v2(1, 1)
Vector2.xAxis = v2(1, 0)
Vector2.yAxis = v2(0, 1)
rt.v2 = v2

------------------------------------------------------------------------------------------
-- CFrame: [1..3] position, [4..12] rotation rows (r00 r01 r02 r10 r11 r12 r20 r21 r22)

local CFrame = {}
local CF = { __typename = "CFrame" }
local CFmethods = {}

local function cf(x, y, z, a, b, c, d, e, f, g, h, i)
	return setmetatable({ x, y, z, a, b, c, d, e, f, g, h, i }, CF)
end

local function fromQuaternion(x, y, z, qx, qy, qz, qw)
	local n = sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
	if n == 0 then
		return cf(x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	end
	qx, qy, qz, qw = qx / n, qy / n, qz / n, qw / n
	return cf(
		x,
		y,
		z,
		1 - 2 * (qy * qy + qz * qz),
		2 * (qx * qy - qz * qw),
		2 * (qx * qz + qy * qw),
		2 * (qx * qy + qz * qw),
		1 - 2 * (qx * qx + qz * qz),
		2 * (qy * qz - qx * qw),
		2 * (qx * qz - qy * qw),
		2 * (qy * qz + qx * qw),
		1 - 2 * (qx * qx + qy * qy)
	)
end

local function toQuaternion(c)
	local m00, m01, m02, m10, m11, m12, m20, m21, m22 = c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11], c[12]
	local trace = m00 + m11 + m22
	if trace > 0 then
		local s = sqrt(1 + trace) * 2
		return (m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4
	elseif m00 > m11 and m00 > m22 then
		local s = sqrt(1 + m00 - m11 - m22) * 2
		return s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s
	elseif m11 > m22 then
		local s = sqrt(1 + m11 - m00 - m22) * 2
		return (m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s
	end
	local s = sqrt(1 + m22 - m00 - m11) * 2
	return (m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s
end

local function mul(a, b)
	return cf(
		a[4] * b[1] + a[5] * b[2] + a[6] * b[3] + a[1],
		a[7] * b[1] + a[8] * b[2] + a[9] * b[3] + a[2],
		a[10] * b[1] + a[11] * b[2] + a[12] * b[3] + a[3],
		a[4] * b[4] + a[5] * b[7] + a[6] * b[10],
		a[4] * b[5] + a[5] * b[8] + a[6] * b[11],
		a[4] * b[6] + a[5] * b[9] + a[6] * b[12],
		a[7] * b[4] + a[8] * b[7] + a[9] * b[10],
		a[7] * b[5] + a[8] * b[8] + a[9] * b[11],
		a[7] * b[6] + a[8] * b[9] + a[9] * b[12],
		a[10] * b[4] + a[11] * b[7] + a[12] * b[10],
		a[10] * b[5] + a[11] * b[8] + a[12] * b[11],
		a[10] * b[6] + a[11] * b[9] + a[12] * b[12]
	)
end

local function inverse(c)
	local x, y, z = c[1], c[2], c[3]
	return cf(
		-(c[4] * x + c[7] * y + c[10] * z),
		-(c[5] * x + c[8] * y + c[11] * z),
		-(c[6] * x + c[9] * y + c[12] * z),
		c[4],
		c[7],
		c[10],
		c[5],
		c[8],
		c[11],
		c[6],
		c[9],
		c[12]
	)
end

local function rotate(c, v)
	return v3(c[4] * v.X + c[5] * v.Y + c[6] * v.Z, c[7] * v.X + c[8] * v.Y + c[9] * v.Z, c[10] * v.X + c[11] * v.Y + c[12] * v.Z)
end

local function lookAt(at, target, up)
	up = up or v3(0, 1, 0)
	local look = target - at
	if look.Magnitude < 1e-9 then
		return cf(at.X, at.Y, at.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	end
	look = look.Unit
	local right = look:Cross(up)
	if right.Magnitude < 1e-6 then
		right = look:Cross(if abs(look.Y) < 0.9 then v3(0, 1, 0) else v3(0, 0, 1))
	end
	right = right.Unit
	local upv = right:Cross(look).Unit
	return cf(at.X, at.Y, at.Z, right.X, upv.X, -look.X, right.Y, upv.Y, -look.Y, right.Z, upv.Z, -look.Z)
end

local function rx(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, 1, 0, 0, 0, c, -s, 0, s, c)
end
local function ry(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, c, 0, s, 0, 1, 0, -s, 0, c)
end
local function rz(a)
	local c, s = cos(a), sin(a)
	return cf(0, 0, 0, c, -s, 0, s, c, 0, 0, 0, 1)
end

function CF.__index(self, key)
	local m = CFmethods[key]
	if m then
		return m
	end
	if key == "Position" or key == "p" then
		return v3(self[1], self[2], self[3])
	elseif key == "X" or key == "x" then
		return self[1]
	elseif key == "Y" or key == "y" then
		return self[2]
	elseif key == "Z" or key == "z" then
		return self[3]
	elseif key == "LookVector" or key == "lookVector" then
		return v3(-self[6], -self[9], -self[12])
	elseif key == "RightVector" or key == "XVector" then
		return v3(self[4], self[7], self[10])
	elseif key == "UpVector" or key == "YVector" then
		return v3(self[5], self[8], self[11])
	elseif key == "ZVector" then
		return v3(self[6], self[9], self[12])
	elseif key == "Rotation" then
		return cf(0, 0, 0, self[4], self[5], self[6], self[7], self[8], self[9], self[10], self[11], self[12])
	end
	error(tostring(key) .. " is not a valid member of CFrame", 2)
end
CF.__newindex = readOnly("CFrame")

function CF.__mul(a, b)
	if isA(b, "CFrame") then
		return mul(a, b)
	elseif isA(b, "Vector3") then
		local r = rotate(a, b)
		return v3(r.X + a[1], r.Y + a[2], r.Z + a[3])
	end
	error("attempt to perform arithmetic (mul) on CFrame and " .. rt.typeof(b), 2)
end
function CF.__add(a, b)
	if not isA(b, "Vector3") then
		error("attempt to perform arithmetic (add) on CFrame and " .. rt.typeof(b), 2)
	end
	return cf(a[1] + b.X, a[2] + b.Y, a[3] + b.Z, a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12])
end
function CF.__sub(a, b)
	if not isA(b, "Vector3") then
		error("attempt to perform arithmetic (sub) on CFrame and " .. rt.typeof(b), 2)
	end
	return cf(a[1] - b.X, a[2] - b.Y, a[3] - b.Z, a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12])
end
function CF.__eq(a, b)
	for i = 1, 12 do
		if a[i] ~= b[i] then
			return false
		end
	end
	return true
end
function CF.__tostring(a)
	local parts = table.create(12)
	for i = 1, 12 do
		parts[i] = fmt(a[i])
	end
	return table.concat(parts, ", ")
end

function CFmethods:Inverse()
	return inverse(self)
end
CFmethods.inverse = CFmethods.Inverse
function CFmethods:ToWorldSpace(...)
	local out = {}
	for i, c in { ... } do
		out[i] = mul(self, c)
	end
	return table.unpack(out)
end
function CFmethods:ToObjectSpace(...)
	local inv = inverse(self)
	local out = {}
	for i, c in { ... } do
		out[i] = mul(inv, c)
	end
	return table.unpack(out)
end
CFmethods.toObjectSpace = CFmethods.ToObjectSpace
CFmethods.toWorldSpace = CFmethods.ToWorldSpace
function CFmethods:PointToWorldSpace(...)
	local out = {}
	for i, v in { ... } do
		out[i] = self * v
	end
	return table.unpack(out)
end
function CFmethods:PointToObjectSpace(...)
	local inv = inverse(self)
	local out = {}
	for i, v in { ... } do
		out[i] = inv * v
	end
	return table.unpack(out)
end
function CFmethods:VectorToWorldSpace(...)
	local out = {}
	for i, v in { ... } do
		out[i] = rotate(self, v)
	end
	return table.unpack(out)
end
function CFmethods:VectorToObjectSpace(...)
	local inv = inverse(self)
	local out = {}
	for i, v in { ... } do
		out[i] = rotate(inv, v)
	end
	return table.unpack(out)
end
CFmethods.pointToObjectSpace = CFmethods.PointToObjectSpace
CFmethods.pointToWorldSpace = CFmethods.PointToWorldSpace
CFmethods.vectorToObjectSpace = CFmethods.VectorToObjectSpace
CFmethods.vectorToWorldSpace = CFmethods.VectorToWorldSpace
function CFmethods:GetComponents()
	return table.unpack(self, 1, 12)
end
CFmethods.components = CFmethods.GetComponents
function CFmethods:ToEulerAnglesXYZ()
	local x = atan2(-self[9], self[12])
	local y = math.asin(clamp(self[6], -1, 1))
	local z = atan2(-self[5], self[4])
	return x, y, z
end
CFmethods.toEulerAnglesXYZ = CFmethods.ToEulerAnglesXYZ
function CFmethods:ToEulerAnglesYXZ()
	local x = math.asin(clamp(-self[9], -1, 1))
	local y = atan2(self[6], self[12])
	local z = atan2(self[7], self[8])
	return x, y, z
end
CFmethods.ToOrientation = CFmethods.ToEulerAnglesYXZ
function CFmethods:ToAxisAngle()
	local qx, qy, qz, qw = toQuaternion(self)
	if qw < 0 then
		qx, qy, qz, qw = -qx, -qy, -qz, -qw
	end
	local angle = 2 * math.acos(clamp(qw, -1, 1))
	local s = sqrt(1 - qw * qw)
	if s < 1e-6 then
		return v3(1, 0, 0), angle
	end
	return v3(qx / s, qy / s, qz / s), angle
end
function CFmethods:Lerp(goal, alpha)
	local ax, ay, az, aw = toQuaternion(self)
	local bx, by, bz, bw = toQuaternion(goal)
	local d = ax * bx + ay * by + az * bz + aw * bw
	if d < 0 then
		bx, by, bz, bw, d = -bx, -by, -bz, -bw, -d
	end
	local s0, s1
	if d > 0.9995 then
		s0, s1 = 1 - alpha, alpha
	else
		local theta = math.acos(d)
		local st = sin(theta)
		s0, s1 = sin((1 - alpha) * theta) / st, sin(alpha * theta) / st
	end
	return fromQuaternion(
		self[1] + (goal[1] - self[1]) * alpha,
		self[2] + (goal[2] - self[2]) * alpha,
		self[3] + (goal[3] - self[3]) * alpha,
		ax * s0 + bx * s1,
		ay * s0 + by * s1,
		az * s0 + bz * s1,
		aw * s0 + bw * s1
	)
end
CFmethods.lerp = CFmethods.Lerp
function CFmethods:Orthonormalize()
	local x = v3(self[4], self[7], self[10]).Unit
	local y = v3(self[5], self[8], self[11])
	y = (y - x * x:Dot(y)).Unit
	local z = x:Cross(y)
	return cf(self[1], self[2], self[3], x.X, y.X, z.X, x.Y, y.Y, z.Y, x.Z, y.Z, z.Z)
end
function CFmethods:FuzzyEq(o, epsilon)
	epsilon = epsilon or 1e-5
	for i = 1, 12 do
		if abs(self[i] - o[i]) > epsilon then
			return false
		end
	end
	return true
end

function CFrame.new(...)
	local n = select("#", ...)
	local a = { ... }
	if n == 0 then
		return cf(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	elseif n == 1 then
		local p = a[1]
		if not isA(p, "Vector3") then
			badArg("CFrame.new", 1, "Vector3", p)
		end
		return cf(p.X, p.Y, p.Z, 1, 0, 0, 0, 1, 0, 0, 0, 1)
	elseif n == 2 then
		return lookAt(a[1], a[2])
	elseif n == 3 then
		return cf(num(a[1], "CFrame.new", 1), num(a[2], "CFrame.new", 2), num(a[3], "CFrame.new", 3), 1, 0, 0, 0, 1, 0, 0, 0, 1)
	elseif n == 7 then
		return fromQuaternion(a[1], a[2], a[3], a[4], a[5], a[6], a[7])
	elseif n == 12 then
		for i = 1, 12 do
			num(a[i], "CFrame.new", i)
		end
		return cf(table.unpack(a, 1, 12))
	end
	error("Invalid number of arguments: " .. n, 2)
end
CFrame.identity = cf(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1)
function CFrame.Angles(x, y, z)
	return mul(mul(rx(num(x, "CFrame.Angles", 1, 0)), ry(num(y, "CFrame.Angles", 2, 0))), rz(num(z, "CFrame.Angles", 3, 0)))
end
CFrame.fromEulerAnglesXYZ = CFrame.Angles
function CFrame.fromEulerAnglesYXZ(x, y, z)
	return mul(mul(ry(y or 0), rx(x or 0)), rz(z or 0))
end
CFrame.fromOrientation = CFrame.fromEulerAnglesYXZ
function CFrame.fromEulerAngles(x, y, z, order)
	return CFrame.Angles(x, y, z)
end
function CFrame.fromAxisAngle(axis, angle)
	axis = axis.Unit
	local s = sin(angle / 2)
	return fromQuaternion(0, 0, 0, axis.X * s, axis.Y * s, axis.Z * s, cos(angle / 2))
end
function CFrame.lookAt(at, target, up)
	return lookAt(at, target, up)
end
function CFrame.lookAlong(at, direction, up)
	return lookAt(at, at + direction, up)
end
function CFrame.fromMatrix(pos, vx, vy, vz)
	vz = vz or vx:Cross(vy).Unit
	return cf(pos.X, pos.Y, pos.Z, vx.X, vy.X, vz.X, vx.Y, vy.Y, vz.Y, vx.Z, vy.Z, vz.Z)
end
rt.cf = cf

------------------------------------------------------------------------------------------
-- Color3

local Color3 = {}
local C3 = { __typename = "Color3" }
local C3methods = {}

local function c3(r, g, b)
	return setmetatable({ R = r, G = g, B = b }, C3)
end

function C3.__index(self, key)
	local m = C3methods[key]
	if m then
		return m
	end
	if key == "r" then
		return self.R
	elseif key == "g" then
		return self.G
	elseif key == "b" then
		return self.B
	end
	error(tostring(key) .. " is not a valid member of Color3", 2)
end
C3.__newindex = readOnly("Color3")
function C3.__eq(a, b)
	return a.R == b.R and a.G == b.G and a.B == b.B
end
function C3.__tostring(a)
	return fmt(a.R) .. ", " .. fmt(a.G) .. ", " .. fmt(a.B)
end
function C3methods:Lerp(goal, alpha)
	return c3(self.R + (goal.R - self.R) * alpha, self.G + (goal.G - self.G) * alpha, self.B + (goal.B - self.B) * alpha)
end
function C3methods:ToHSV()
	local r, g, b = self.R, self.G, self.B
	local max, min = math.max(r, g, b), math.min(r, g, b)
	local d = max - min
	local h = 0
	if d > 0 then
		if max == r then
			h = ((g - b) / d) % 6
		elseif max == g then
			h = (b - r) / d + 2
		else
			h = (r - g) / d + 4
		end
		h /= 6
	end
	return h, if max == 0 then 0 else d / max, max
end
function C3methods:ToHex()
	return string.format(
		"%02X%02X%02X",
		math.floor(clamp(self.R, 0, 1) * 255 + 0.5),
		math.floor(clamp(self.G, 0, 1) * 255 + 0.5),
		math.floor(clamp(self.B, 0, 1) * 255 + 0.5)
	)
end

function Color3.new(r, g, b)
	return c3(num(r, "Color3.new", 1, 0), num(g, "Color3.new", 2, 0), num(b, "Color3.new", 3, 0))
end
function Color3.fromRGB(r, g, b)
	return c3(num(r, "Color3.fromRGB", 1, 0) / 255, num(g, "Color3.fromRGB", 2, 0) / 255, num(b, "Color3.fromRGB", 3, 0) / 255)
end
function Color3.fromHSV(h, s, v)
	h = (h % 1) * 6
	local i = math.floor(h)
	local f = h - i
	local p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
	local r, g, b
	if i == 0 then
		r, g, b = v, t, p
	elseif i == 1 then
		r, g, b = q, v, p
	elseif i == 2 then
		r, g, b = p, v, t
	elseif i == 3 then
		r, g, b = p, q, v
	elseif i == 4 then
		r, g, b = t, p, v
	else
		r, g, b = v, p, q
	end
	return c3(r, g, b)
end
function Color3.toHSV(c)
	return c:ToHSV()
end
function Color3.fromHex(hex)
	hex = tostring(hex):gsub("^#", "")
	if #hex == 3 then
		hex = hex:gsub(".", "%0%0")
	end
	local n = tonumber(hex, 16)
	if #hex ~= 6 or not n then
		error("Unable to convert characters to hex value", 2)
	end
	return c3(bit32.rshift(n, 16) / 255, bit32.band(bit32.rshift(n, 8), 255) / 255, bit32.band(n, 255) / 255)
end
rt.c3 = c3

------------------------------------------------------------------------------------------
-- UDim, UDim2

local UDim = {}
local UD = { __typename = "UDim" }
local function udim(s, o)
	return setmetatable({ Scale = s, Offset = o }, UD)
end
UD.__index = noMember("UDim")
UD.__newindex = readOnly("UDim")
function UD.__add(a, b)
	return udim(a.Scale + b.Scale, a.Offset + b.Offset)
end
function UD.__sub(a, b)
	return udim(a.Scale - b.Scale, a.Offset - b.Offset)
end
function UD.__unm(a)
	return udim(-a.Scale, -a.Offset)
end
function UD.__eq(a, b)
	return a.Scale == b.Scale and a.Offset == b.Offset
end
function UD.__tostring(a)
	return fmt(a.Scale) .. ", " .. fmt(a.Offset)
end
function UDim.new(s, o)
	return udim(num(s, "UDim.new", 1, 0), math.floor(num(o, "UDim.new", 2, 0)))
end

local UDim2 = {}
local UD2 = { __typename = "UDim2" }
local UD2methods = {}
local function udim2(xs, xo, ys, yo)
	return setmetatable({ X = udim(xs, xo), Y = udim(ys, yo) }, UD2)
end
function UD2.__index(self, key)
	local m = UD2methods[key]
	if m then
		return m
	end
	if key == "Width" then
		return self.X
	elseif key == "Height" then
		return self.Y
	end
	error(tostring(key) .. " is not a valid member of UDim2", 2)
end
UD2.__newindex = readOnly("UDim2")
function UD2.__add(a, b)
	return udim2(a.X.Scale + b.X.Scale, a.X.Offset + b.X.Offset, a.Y.Scale + b.Y.Scale, a.Y.Offset + b.Y.Offset)
end
function UD2.__sub(a, b)
	return udim2(a.X.Scale - b.X.Scale, a.X.Offset - b.X.Offset, a.Y.Scale - b.Y.Scale, a.Y.Offset - b.Y.Offset)
end
function UD2.__unm(a)
	return udim2(-a.X.Scale, -a.X.Offset, -a.Y.Scale, -a.Y.Offset)
end
function UD2.__eq(a, b)
	return a.X == b.X and a.Y == b.Y
end
function UD2.__tostring(a)
	return "{" .. tostring(a.X) .. "}, {" .. tostring(a.Y) .. "}"
end
function UD2methods:Lerp(goal, alpha)
	local function l(a, b)
		return a + (b - a) * alpha
	end
	return udim2(
		l(self.X.Scale, goal.X.Scale),
		math.floor(l(self.X.Offset, goal.X.Offset) + 0.5),
		l(self.Y.Scale, goal.Y.Scale),
		math.floor(l(self.Y.Offset, goal.Y.Offset) + 0.5)
	)
end
function UDim2.new(a, b, c, d)
	if isA(a, "UDim") then
		return setmetatable({ X = a, Y = b or udim(0, 0) }, UD2)
	end
	return udim2(
		num(a, "UDim2.new", 1, 0),
		math.floor(num(b, "UDim2.new", 2, 0)),
		num(c, "UDim2.new", 3, 0),
		math.floor(num(d, "UDim2.new", 4, 0))
	)
end
function UDim2.fromScale(x, y)
	return udim2(x or 0, 0, y or 0, 0)
end
function UDim2.fromOffset(x, y)
	return udim2(0, math.floor(x or 0), 0, math.floor(y or 0))
end
rt.udim, rt.udim2 = udim, udim2

------------------------------------------------------------------------------------------
-- NumberRange, NumberSequence, ColorSequence, Rect

local NumberRange = {}
local NR = { __typename = "NumberRange", __index = noMember("NumberRange"), __newindex = readOnly("NumberRange") }
function NR.__eq(a, b)
	return a.Min == b.Min and a.Max == b.Max
end
function NR.__tostring(a)
	return fmt(a.Min) .. " " .. fmt(a.Max)
end
function NumberRange.new(min, max)
	min = num(min, "NumberRange.new", 1)
	max = num(max, "NumberRange.new", 2, min)
	if max < min then
		error("NumberRange: invalid range", 2)
	end
	return setmetatable({ Min = min, Max = max }, NR)
end

local function keypointType(name, valueKey)
	local T = {}
	local M = { __typename = name, __index = noMember(name), __newindex = readOnly(name) }
	function M.__eq(a, b)
		return a.Time == b.Time and a.Value == b.Value
	end
	function M.__tostring(a)
		return fmt(a.Time) .. " " .. tostring(a.Value)
	end
	function T.new(time, value, envelope)
		return setmetatable({ Time = time, Value = value, Envelope = envelope or 0 }, M)
	end
	return T
end

local NumberSequenceKeypoint = keypointType("NumberSequenceKeypoint")
local ColorSequenceKeypoint = keypointType("ColorSequenceKeypoint")

local function sequenceType(name, Keypoint, valueType)
	local T = {}
	local M = { __typename = name, __index = noMember(name), __newindex = readOnly(name) }
	function M.__eq(a, b)
		if #a.Keypoints ~= #b.Keypoints then
			return false
		end
		for i, k in a.Keypoints do
			if k ~= b.Keypoints[i] then
				return false
			end
		end
		return true
	end
	function M.__tostring(a)
		local parts = {}
		for _, k in a.Keypoints do
			table.insert(parts, tostring(k))
		end
		return table.concat(parts, " ")
	end
	function T.new(a, b)
		local keypoints
		if type(a) == "table" and not getmetatable(a) then
			keypoints = table.clone(a)
		elseif b ~= nil then
			keypoints = { Keypoint.new(0, a), Keypoint.new(1, b) }
		else
			keypoints = { Keypoint.new(0, a), Keypoint.new(1, a) }
		end
		table.freeze(keypoints)
		return setmetatable({ Keypoints = keypoints }, M)
	end
	return T
end

local NumberSequence = sequenceType("NumberSequence", NumberSequenceKeypoint)
local ColorSequence = sequenceType("ColorSequence", ColorSequenceKeypoint)

local Rect = {}
local RC = { __typename = "Rect", __newindex = readOnly("Rect") }
function RC.__index(self, key)
	if key == "Width" then
		return self.Max.X - self.Min.X
	elseif key == "Height" then
		return self.Max.Y - self.Min.Y
	end
	error(tostring(key) .. " is not a valid member of Rect", 2)
end
function RC.__eq(a, b)
	return a.Min == b.Min and a.Max == b.Max
end
function RC.__tostring(a)
	return tostring(a.Min) .. ", " .. tostring(a.Max)
end
function Rect.new(a, b, c, d)
	if isA(a, "Vector2") then
		return setmetatable({ Min = a, Max = b }, RC)
	end
	return setmetatable({ Min = v2(a or 0, b or 0), Max = v2(c or 0, d or 0) }, RC)
end

------------------------------------------------------------------------------------------
-- Enum

local enums = {}
local EnumItemMT = { __typename = "EnumItem" }
local EnumMT = { __typename = "Enum" }
local enumMethods = {}

function EnumItemMT.__index(self, key)
	if key == "IsA" then
		return function(item, name)
			return rawget(item, "EnumType")._name == name
		end
	end
	error(tostring(key) .. " is not a valid member of \"" .. tostring(self) .. "\"", 2)
end
EnumItemMT.__newindex = readOnly("EnumItem")
function EnumItemMT.__tostring(self)
	return "Enum." .. rawget(self, "EnumType")._name .. "." .. rawget(self, "Name")
end

function EnumMT.__index(self, key)
	local item = rawget(self, "_items")[key]
	if item then
		return item
	end
	local m = enumMethods[key]
	if m then
		return m
	end
	error(tostring(key) .. " is not a valid member of \"Enum." .. rawget(self, "_name") .. "\"", 2)
end
EnumMT.__newindex = readOnly("Enum")
function EnumMT.__tostring(self)
	return rawget(self, "_name")
end

function enumMethods:GetEnumItems()
	local list = table.clone(rawget(self, "_list"))
	return list
end
function enumMethods:FromName(name)
	return rawget(self, "_items")[name]
end
function enumMethods:FromValue(value)
	return rawget(self, "_byValue")[value]
end

--- The Enum.<name> table, or nil if there's no such enum.
function rt.getEnum(name: string)
	local e = enums[name]
	if e ~= nil then
		return e or nil
	end
	local items = rt.host("enum", name)
	if not items then
		enums[name] = false
		return nil
	end
	e = setmetatable({ _name = name, _items = {}, _byValue = {}, _list = {} }, EnumMT)
	for _, entry in items do
		local item = setmetatable({ Name = entry.name, Value = entry.value, EnumType = e }, EnumItemMT)
		rawget(e, "_items")[entry.name] = item
		rawget(e, "_byValue")[entry.value] = rawget(e, "_byValue")[entry.value] or item
		table.insert(rawget(e, "_list"), item)
	end
	enums[name] = e
	return e
end

--- An EnumItem by enum name and item name or value.
function rt.enumItem(enumName: string, item)
	local e = rt.getEnum(enumName)
	if not e then
		return nil
	end
	if type(item) == "number" then
		return rawget(e, "_byValue")[item]
	end
	return rawget(e, "_items")[item]
end

local Enum = setmetatable({}, {
	__typename = "Enums",
	__index = function(_, key)
		if key == "GetEnums" then
			return function()
				local list = {}
				for _, e in enums do
					if e then
						table.insert(list, e)
					end
				end
				return list
			end
		end
		local e = rt.getEnum(key)
		if not e then
			error(tostring(key) .. " is not a valid member of \"Enum\"", 2)
		end
		return e
	end,
	__newindex = readOnly("Enum"),
	__tostring = function()
		return "Enums"
	end,
})

------------------------------------------------------------------------------------------
-- TweenInfo

local TweenInfo = {}
local TI = { __typename = "TweenInfo", __index = noMember("TweenInfo"), __newindex = readOnly("TweenInfo") }
function TI.__tostring(t)
	return string.format(
		"Time:%s DelayTime:%s RepeatCount:%d Reverses:%s EasingDirection:%s EasingStyle:%s",
		fmt(t.Time),
		fmt(t.DelayTime),
		t.RepeatCount,
		if t.Reverses then "True" else "False",
		t.EasingDirection.Name,
		t.EasingStyle.Name
	)
end
function TweenInfo.new(time, style, direction, repeatCount, reverses, delay)
	return setmetatable({
		Time = num(time, "TweenInfo.new", 1, 1),
		EasingStyle = style or rt.enumItem("EasingStyle", "Quad"),
		EasingDirection = direction or rt.enumItem("EasingDirection", "Out"),
		RepeatCount = num(repeatCount, "TweenInfo.new", 4, 0),
		Reverses = reverses == true,
		DelayTime = num(delay, "TweenInfo.new", 6, 0),
	}, TI)
end

------------------------------------------------------------------------------------------
-- Font

local Font = {}
local FT = { __typename = "Font", __index = noMember("Font") }
function FT.__eq(a, b)
	return a.Family == b.Family and a.Weight == b.Weight and a.Style == b.Style
end
function FT.__tostring(f)
	return string.format("Font { Family = %s, Weight = %s, Style = %s }", f.Family, f.Weight.Name, f.Style.Name)
end
function FT.__newindex(self, key, value)
	if key == "Bold" then
		rawset(self, "Weight", rt.enumItem("FontWeight", if value then "Bold" else "Regular"))
	elseif key == "Weight" or key == "Style" or key == "Family" then
		rawset(self, key, value)
	else
		error(tostring(key) .. " is not a valid member of Font", 2)
	end
end
local function makeFont(family, weight, italic)
	local f = setmetatable({}, FT)
	rawset(f, "Family", family)
	rawset(f, "Weight", rt.enumItem("FontWeight", weight) or rt.enumItem("FontWeight", 400))
	rawset(f, "Style", rt.enumItem("FontStyle", if italic then "Italic" else "Normal"))
	return f
end
-- Bold is computed: read through __index would error, so expose it via a proxy key.
local fontIndex = FT.__index
FT.__index = function(self, key)
	if key == "Bold" then
		return rawget(self, "Weight").Value >= 600
	end
	return fontIndex(self, key)
end
function Font.new(family, weight, style)
	local w = if weight then weight.Value else 400
	local italic = style ~= nil and style.Name == "Italic"
	return makeFont(family, w, italic)
end
function Font.fromName(name, weight, style)
	return Font.new("rbxasset://fonts/families/" .. name .. ".json", weight, style)
end
function Font.fromId(id, weight, style)
	return Font.new("rbxassetid://" .. tostring(id), weight, style)
end
-- Enum.Font names that don't match their family file.
local legacyFamilies = {
	Legacy = "LegacyArial",
	SourceSans = "SourceSansPro",
	Cartoon = "ComicNeueAngular",
	Code = "Inconsolata",
	Highway = "HighwayGothic",
	SciFi = "Zekton",
	Arcade = "PressStart2P",
	Fantasy = "Balthazar",
	Antique = "Antique",
	Gotham = "GothamSSm",
	Bodoni = "AccanthisADFStd",
	Garamond = "Guru",
}
function Font.fromEnum(enumItem)
	local name = enumItem.Name
	local weight, italic = 400, false
	local base = name
	for suffix, w in { Black = 900, ExtraBold = 800, Bold = 700, SemiBold = 600, Semibold = 600, Medium = 500, Light = 300 } do
		if name:sub(-#suffix) == suffix and #name > #suffix then
			base, weight = name:sub(1, -#suffix - 1), w
		end
	end
	if base:sub(-6) == "Italic" then
		base, italic = base:sub(1, -7), true
	end
	return makeFont("rbxasset://fonts/families/" .. (legacyFamilies[base] or base) .. ".json", weight, italic)
end
rt.makeFont = makeFont

------------------------------------------------------------------------------------------
-- BrickColor (common palette)

local palette = {
	{ 1, "White", 242, 243, 243 },
	{ 5, "Brick yellow", 215, 197, 154 },
	{ 18, "Nougat", 204, 142, 105 },
	{ 21, "Bright red", 196, 40, 28 },
	{ 23, "Bright blue", 13, 105, 172 },
	{ 24, "Bright yellow", 245, 205, 48 },
	{ 26, "Black", 27, 42, 53 },
	{ 28, "Dark green", 40, 127, 71 },
	{ 37, "Bright green", 75, 151, 75 },
	{ 38, "Dark orange", 160, 95, 53 },
	{ 45, "Light blue", 180, 210, 228 },
	{ 101, "Medium red", 218, 134, 122 },
	{ 102, "Medium blue", 110, 153, 202 },
	{ 104, "Bright violet", 107, 50, 124 },
	{ 106, "Bright orange", 218, 133, 65 },
	{ 119, "Br. yellowish green", 164, 189, 71 },
	{ 125, "Light orange", 234, 184, 146 },
	{ 135, "Sand blue", 116, 134, 157 },
	{ 141, "Earth green", 39, 70, 45 },
	{ 151, "Sand green", 120, 144, 130 },
	{ 153, "Sand red", 149, 121, 119 },
	{ 192, "Reddish brown", 105, 64, 40 },
	{ 194, "Medium stone grey", 163, 162, 165 },
	{ 199, "Dark stone grey", 99, 95, 98 },
	{ 208, "Light stone grey", 229, 228, 223 },
	{ 1001, "Institutional white", 248, 248, 248 },
	{ 1002, "Mid gray", 205, 205, 205 },
	{ 1003, "Really black", 17, 17, 17 },
	{ 1004, "Really red", 255, 0, 0 },
	{ 1005, "Deep orange", 255, 176, 0 },
	{ 1006, "Alder", 180, 128, 255 },
	{ 1007, "Dusty Rose", 163, 75, 75 },
	{ 1008, "Olive", 193, 190, 66 },
	{ 1009, "New Yeller", 255, 255, 0 },
	{ 1010, "Really blue", 0, 0, 255 },
	{ 1011, "Navy blue", 0, 32, 96 },
	{ 1012, "Deep blue", 33, 84, 185 },
	{ 1013, "Cyan", 4, 175, 236 },
	{ 1014, "CGA brown", 170, 85, 0 },
	{ 1015, "Magenta", 170, 0, 170 },
	{ 1016, "Pink", 255, 102, 204 },
	{ 1018, "Teal", 18, 238, 212 },
	{ 1019, "Toothpaste", 0, 255, 255 },
	{ 1020, "Lime green", 0, 255, 0 },
	{ 1021, "Camo", 58, 125, 21 },
	{ 1022, "Grime", 127, 142, 100 },
	{ 1023, "Lavender", 140, 91, 159 },
	{ 1024, "Pastel light blue", 175, 221, 255 },
	{ 1025, "Pastel orange", 255, 201, 201 },
	{ 1026, "Pastel violet", 177, 167, 255 },
	{ 1027, "Pastel blue-green", 159, 243, 233 },
	{ 1028, "Pastel green", 204, 255, 204 },
	{ 1029, "Pastel yellow", 255, 255, 204 },
	{ 1030, "Pastel brown", 255, 204, 153 },
	{ 1031, "Royal purple", 98, 37, 209 },
	{ 1032, "Hot pink", 255, 0, 191 },
}

local BrickColor = {}
local BC = { __typename = "BrickColor", __newindex = readOnly("BrickColor") }
function BC.__index(self, key)
	if key == "r" then
		return self.Color.R
	elseif key == "g" then
		return self.Color.G
	elseif key == "b" then
		return self.Color.B
	end
	error(tostring(key) .. " is not a valid member of BrickColor", 2)
end
function BC.__eq(a, b)
	return a.Number == b.Number
end
function BC.__tostring(a)
	return a.Name
end
local brickColors, byName, byNumber = {}, {}, {}
for _, entry in palette do
	local bc = setmetatable({ Number = entry[1], Name = entry[2], Color = c3(entry[3] / 255, entry[4] / 255, entry[5] / 255) }, BC)
	table.insert(brickColors, bc)
	byName[entry[2]] = bc
	byNumber[entry[1]] = bc
end
local function nearestBrickColor(color)
	local best, bestDistance = byNumber[194], math.huge
	for _, bc in brickColors do
		local dr, dg, db = bc.Color.R - color.R, bc.Color.G - color.G, bc.Color.B - color.B
		local d = dr * dr + dg * dg + db * db
		if d < bestDistance then
			best, bestDistance = bc, d
		end
	end
	return best
end
function BrickColor.new(a, b, c)
	if type(a) == "string" then
		return byName[a] or byNumber[194]
	elseif type(a) == "number" and b == nil then
		return byNumber[a] or byNumber[194]
	elseif isA(a, "Color3") then
		return nearestBrickColor(a)
	end
	return nearestBrickColor(c3(a or 0, b or 0, c or 0))
end
function BrickColor.random()
	return brickColors[math.random(#brickColors)]
end
function BrickColor.palette(i)
	return brickColors[(i % #brickColors) + 1]
end
for name, key in
	{ White = "White", Gray = "Medium stone grey", DarkGray = "Dark stone grey", Black = "Black", Red = "Bright red", Yellow = "Bright yellow", Green = "Dark green", Blue = "Bright blue" }
do
	BrickColor[name] = function()
		return byName[key]
	end
end
rt.nearestBrickColor = nearestBrickColor

------------------------------------------------------------------------------------------
-- Random, DateTime, Ray, misc

local Random = {}
local RN = { __typename = "Random", __newindex = readOnly("Random") }
local RNmethods = {}
RN.__index = function(_, key)
	return RNmethods[key] or error(tostring(key) .. " is not a valid member of Random", 2)
end
-- Park–Miller: exact in doubles.
local function nextRaw(self)
	local s = (rawget(self, "_s") * 48271) % 2147483647
	rawset(self, "_s", s)
	return s / 2147483647
end
function RNmethods:NextNumber(min, max)
	min, max = min or 0, max or 1
	return min + (max - min) * nextRaw(self)
end
function RNmethods:NextInteger(min, max)
	return math.floor(min + (max - min + 1) * nextRaw(self))
end
function RNmethods:NextUnitVector()
	local z = nextRaw(self) * 2 - 1
	local t = nextRaw(self) * 2 * math.pi
	local r = sqrt(1 - z * z)
	return v3(r * cos(t), r * sin(t), z)
end
function RNmethods:Shuffle(t)
	for i = #t, 2, -1 do
		local j = self:NextInteger(1, i)
		t[i], t[j] = t[j], t[i]
	end
end
function RNmethods:Clone()
	return setmetatable({ _s = rawget(self, "_s") }, RN)
end
function Random.new(seed)
	local s = math.floor(tonumber(seed) or (os.clock() * 1e6 + math.random(1, 1e6))) % 2147483646 + 1
	return setmetatable({ _s = s }, RN)
end

local DateTime = {}
local DT = { __typename = "DateTime", __newindex = readOnly("DateTime") }
local DTmethods = {}
DT.__index = function(self, key)
	if key == "UnixTimestamp" then
		return math.floor(rawget(self, "_ms") / 1000)
	elseif key == "UnixTimestampMillis" then
		return rawget(self, "_ms")
	end
	return DTmethods[key] or error(tostring(key) .. " is not a valid member of DateTime", 2)
end
function DTmethods:ToIsoDate()
	return os.date("!%Y-%m-%dT%H:%M:%SZ", math.floor(rawget(self, "_ms") / 1000))
end
function DTmethods:ToUniversalTime()
	local t = os.date("!*t", math.floor(rawget(self, "_ms") / 1000))
	return { Year = t.year, Month = t.month, Day = t.day, Hour = t.hour, Minute = t.min, Second = t.sec, Millisecond = rawget(self, "_ms") % 1000 }
end
DTmethods.ToLocalTime = DTmethods.ToUniversalTime
function DTmethods:FormatUniversalTime(format)
	return self:ToIsoDate()
end
DTmethods.FormatLocalTime = DTmethods.FormatUniversalTime
local startUnix, startClock = os.time(), __clock()
local function unixNow()
	return startUnix + (__clock() - startClock)
end
rt.unixNow = unixNow
function DateTime.now()
	return setmetatable({ _ms = math.floor(unixNow() * 1000) }, DT)
end
function DateTime.fromUnixTimestamp(s)
	return setmetatable({ _ms = math.floor(s * 1000) }, DT)
end
function DateTime.fromUnixTimestampMillis(ms)
	return setmetatable({ _ms = math.floor(ms) }, DT)
end

local Ray = {}
local RY = { __typename = "Ray", __newindex = readOnly("Ray") }
local RYmethods = {}
RY.__index = function(self, key)
	if key == "Unit" then
		return setmetatable({ Origin = self.Origin, Direction = self.Direction.Unit }, RY)
	end
	return RYmethods[key] or error(tostring(key) .. " is not a valid member of Ray", 2)
end
function RYmethods:ClosestPoint(p)
	local d = self.Direction.Unit
	local t = math.max((p - self.Origin):Dot(d), 0)
	return self.Origin + d * t
end
function RYmethods:Distance(p)
	return (p - self:ClosestPoint(p)).Magnitude
end
function Ray.new(origin, direction)
	return setmetatable({ Origin = origin, Direction = direction }, RY)
end

local PhysicalProperties = {}
function PhysicalProperties.new(density, friction, elasticity, frictionWeight, elasticityWeight)
	return setmetatable({
		Density = density or 0.7,
		Friction = friction or 0.3,
		Elasticity = elasticity or 0.5,
		FrictionWeight = frictionWeight or 1,
		ElasticityWeight = elasticityWeight or 1,
	}, { __typename = "PhysicalProperties" })
end

rt.datatypes = {
	Vector3 = Vector3,
	Vector2 = Vector2,
	CFrame = CFrame,
	Color3 = Color3,
	UDim = UDim,
	UDim2 = UDim2,
	NumberRange = NumberRange,
	NumberSequence = NumberSequence,
	NumberSequenceKeypoint = NumberSequenceKeypoint,
	ColorSequence = ColorSequence,
	ColorSequenceKeypoint = ColorSequenceKeypoint,
	Rect = Rect,
	Enum = Enum,
	TweenInfo = TweenInfo,
	Font = Font,
	BrickColor = BrickColor,
	Random = Random,
	DateTime = DateTime,
	Ray = Ray,
	PhysicalProperties = PhysicalProperties,
}
rt.NumberRangeMT, rt.RectMT = NR, RC
rt.NumberSequence, rt.ColorSequence = NumberSequence, ColorSequence
rt.NumberSequenceKeypoint, rt.ColorSequenceKeypoint = NumberSequenceKeypoint, ColorSequenceKeypoint
