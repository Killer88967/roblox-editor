--!nocheck
-- JSON for host messages and HttpService. null decodes to nil.
local rt = ...

local escapes = {
	['"'] = '\\"',
	["\\"] = "\\\\",
	["\b"] = "\\b",
	["\f"] = "\\f",
	["\n"] = "\\n",
	["\r"] = "\\r",
	["\t"] = "\\t",
}

local function escapeString(s: string): string
	return '"' .. s:gsub('[%c"\\]', function(c)
		return escapes[c] or string.format("\\u%04x", c:byte())
	end) .. '"'
end

local function isArray(t): (boolean, number)
	local n = 0
	for k in t do
		if type(k) ~= "number" or k <= 0 or k % 1 ~= 0 then
			return false, 0
		end
		n = math.max(n, k)
	end
	return n == #t, n
end

local encodeValue

local function encodeTable(t, seen)
	if seen[t] then
		error("cannot encode a table that contains itself", 0)
	end
	seen[t] = true
	local parts = {}
	local array, n = isArray(t)
	if array and (n > 0 or next(t) == nil) then
		for i = 1, n do
			parts[i] = encodeValue(t[i], seen)
		end
		seen[t] = nil
		return "[" .. table.concat(parts, ",") .. "]"
	end
	for k, v in t do
		local key = type(k) == "string" and k or tostring(k)
		table.insert(parts, escapeString(key) .. ":" .. encodeValue(v, seen))
	end
	seen[t] = nil
	return "{" .. table.concat(parts, ",") .. "}"
end

function encodeValue(v, seen): string
	local t = type(v)
	if v == nil then
		return "null"
	elseif t == "boolean" then
		return tostring(v)
	elseif t == "number" then
		if v ~= v or v == math.huge or v == -math.huge then
			return "null"
		elseif v % 1 == 0 and math.abs(v) < 2 ^ 53 then
			return string.format("%d", v)
		end
		return string.format("%.17g", v)
	elseif t == "string" then
		return escapeString(v)
	elseif t == "table" then
		return encodeTable(v, seen)
	end
	error("cannot encode a value of type " .. t, 0)
end

local function encode(v): string
	return encodeValue(v, {})
end

local function decode(s: string)
	local pos = 1

	local function fail(what)
		error(string.format("invalid JSON at position %d: %s", pos, what), 0)
	end

	local function skip()
		pos = s:find("[^ \t\r\n]", pos) or #s + 1
	end

	local value

	local function str()
		pos += 1
		local out = {}
		while true do
			local i = s:find('["\\]', pos)
			if not i then
				fail("unterminated string")
			end
			table.insert(out, s:sub(pos, i - 1))
			local c = s:sub(i, i)
			if c == '"' then
				pos = i + 1
				break
			end
			local e = s:sub(i + 1, i + 1)
			if e == "u" then
				local code = tonumber(s:sub(i + 2, i + 5), 16) or fail("bad \\u escape")
				pos = i + 6
				-- Surrogate pairs.
				if code >= 0xD800 and code <= 0xDBFF and s:sub(pos, pos + 1) == "\\u" then
					local low = tonumber(s:sub(pos + 2, pos + 5), 16)
					if low and low >= 0xDC00 and low <= 0xDFFF then
						code = 0x10000 + (code - 0xD800) * 0x400 + (low - 0xDC00)
						pos += 6
					end
				end
				table.insert(out, utf8.char(code))
			else
				local map = { b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
				table.insert(out, map[e] or e)
				pos = i + 2
			end
		end
		return table.concat(out)
	end

	function value()
		skip()
		local c = s:sub(pos, pos)
		if c == "{" then
			pos += 1
			local obj = {}
			skip()
			if s:sub(pos, pos) == "}" then
				pos += 1
				return obj
			end
			while true do
				skip()
				if s:sub(pos, pos) ~= '"' then
					fail("expected a key")
				end
				local k = str()
				skip()
				if s:sub(pos, pos) ~= ":" then
					fail("expected ':'")
				end
				pos += 1
				obj[k] = value()
				skip()
				local d = s:sub(pos, pos)
				pos += 1
				if d == "}" then
					return obj
				elseif d ~= "," then
					fail("expected ',' or '}'")
				end
			end
		elseif c == "[" then
			pos += 1
			local arr = {}
			skip()
			if s:sub(pos, pos) == "]" then
				pos += 1
				return arr
			end
			local n = 0
			while true do
				n += 1
				arr[n] = value()
				skip()
				local d = s:sub(pos, pos)
				pos += 1
				if d == "]" then
					return arr
				elseif d ~= "," then
					fail("expected ',' or ']'")
				end
			end
		elseif c == '"' then
			return str()
		elseif s:sub(pos, pos + 3) == "true" then
			pos += 4
			return true
		elseif s:sub(pos, pos + 4) == "false" then
			pos += 5
			return false
		elseif s:sub(pos, pos + 3) == "null" then
			pos += 4
			return nil
		end
		local num = s:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
		if not num or num == "" then
			fail("unexpected character")
		end
		pos += #num
		return tonumber(num) or fail("bad number")
	end

	local result = value()
	skip()
	if pos <= #s then
		fail("trailing characters")
	end
	return result
end

rt.json = { encode = encode, decode = decode }
