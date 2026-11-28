// Generates packages/luau/types/roblox.d.luau: Roblox's API as a Luau definitions file,
// so the type checker knows game, workspace, Instance, Vector3, Enum and the rest.
//
// Input: apps/web/src/data/roblox-api.json (from the Roblox Creator Documentation, CC BY 4.0).
//
// Usage: node scripts/gen-luau-types.mjs

import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const api = JSON.parse(fs.readFileSync(path.join(root, "apps/web/src/data/roblox-api.json"), "utf8"));
const out = path.join(root, "packages/luau/types/roblox.d.luau");

const classes = new Set(Object.keys(api.classes));
const enums = new Set(Object.keys(api.enums));
const datatypes = new Set(Object.keys(api.datatypes));

// Written by hand below instead of generated from the docs.
const MANUAL = new Set(["RBXScriptSignal", "RBXScriptConnection", "EnumItem", "Enum", "Enums", "Instance"]);

const KEYWORDS = new Set(
  "and break do else elseif end false for function if in local nil not or repeat return then true until while".split(" "),
);
// Docs names like "Left Tangent" become "LeftTangent"; keywords get a trailing "_".
const param = (name) => {
  const clean = name.replace(/[^A-Za-z0-9_]/g, "");
  return KEYWORDS.has(clean) ? `${clean}_` : clean;
};

const SIMPLE = {
  float: "number",
  double: "number",
  int: "number",
  int64: "number",
  number: "number",
  bool: "boolean",
  boolean: "boolean",
  string: "string",
  ContentId: "string",
  BinaryString: "string",
  ProtectedString: "string",
  buffer: "buffer",
  "()": "()",
  Variant: "any",
  any: "any",
  Array: "{ any }",
  Dictionary: "{ [any]: any }",
  Map: "{ [any]: any }",
  table: "{ [any]: any }",
  Instances: "{ Instance }",
  Objects: "{ Instance }",
  Function: "(...any) -> ...any",
  function: "(...any) -> ...any",
  OptionalCoordinateFrame: "CFrame?",
};

/** A docs type name as a Luau type. `ret` allows tuples (return types only). */
function luauType(t, ret = false) {
  t = t.trim();
  if (t.includes(",") && !t.includes("<")) {
    const parts = t.split(",").map((p) => luauType(p));
    return ret ? `(${parts.join(", ")})` : "any";
  }
  if (t.includes("|")) {
    const parts = t.split("|").map((p) => p.trim());
    const optional = parts.includes("nil");
    const rest = parts.filter((p) => p !== "nil").map((p) => luauType(p));
    const union = rest.length > 1 ? `(${rest.join(" | ")})` : rest[0];
    return optional ? `${union}?` : union;
  }
  if (t.endsWith("?")) {
    const inner = luauType(t.slice(0, -1));
    return inner === "any" || inner.endsWith("?") ? inner : `${inner}?`;
  }
  let m = t.match(/^(?:List|Array)<(.+)>$/);
  if (m) return `{ ${luauType(m[1])} }`;
  m = t.match(/^Tuple<(.+)>$/);
  if (m) return ret ? `...${luauType(m[1])}` : "any";
  if (t === "Tuple") return ret ? "...any" : "any";
  m = t.match(/^\{(.+)\}$/);
  if (m) return `{ ${luauType(m[1])} }`;
  if (SIMPLE[t]) return SIMPLE[t];
  m = t.match(/^(?:Enum|Datatype)\.(.+)$/);
  if (m) t = m[1];
  if (enums.has(t)) return `Enum${t}`;
  if (classes.has(t) || datatypes.has(t)) return t;
  return "any";
}

/**
 * `name: Type` for each parameter; optional ones (with a default) get `?`. Varargs are
 * `...: T` in a method declaration but `...T` in a function type (`inType`).
 */
function params(list = [], inType = false) {
  return list
    .map(([name, type, def]) => {
      if (name.endsWith("...")) return inType ? `...${luauType(type)}` : `...: ${luauType(type)}`;
      let t = luauType(type);
      if (def !== undefined && !t.endsWith("?") && t !== "any") t = /[|>]/.test(t) ? `(${t})?` : `${t}?`;
      return `${param(name)}: ${t}`;
    })
    .join(", ");
}

/** `declare extern type` (Luau's syntax for a native class) with an optional base type. */
const declareType = (name, base, body) =>
  `declare extern type ${name}${base ? ` extends ${base}` : ""} with\n${body ? `${body}\n` : ""}end`;

const returnType = (t) => (t ? luauType(t, true) : "()");
const fnType = (m) => `(${params(m.p, true)}) -> ${returnType(m.t)}`;

/** The body of a type declaration from docs members. */
function classBody(members, extra = []) {
  const lines = [];
  const seen = new Set();
  for (const m of members) {
    if (seen.has(m.n) && m.k !== "m") continue;
    seen.add(m.n);
    if (m.k === "p") lines.push(`\t${m.n}: ${luauType(m.t)}`);
    else if (m.k === "e") lines.push(`\t${m.n}: RBXScriptSignal<${(m.p ?? []).map((p) => luauType(p[1])).join(", ")}>`);
    else if (m.k === "c") lines.push(`\t${m.n}: ${fnType(m)}`);
    else if (m.k === "m") {
      const p = params(m.p);
      lines.push(`\tfunction ${m.n}(self${p ? `, ${p}` : ""}): ${returnType(m.t)}`);
    }
  }
  return [...lines, ...extra].join("\n");
}

// Arithmetic the docs don't list.
const OPERATORS = {
  Vector3: [
    "__add(self, other: Vector3): Vector3",
    "__sub(self, other: Vector3): Vector3",
    "__mul(self, other: Vector3 | number): Vector3",
    "__div(self, other: Vector3 | number): Vector3",
    "__idiv(self, other: Vector3 | number): Vector3",
    "__unm(self): Vector3",
  ],
  Vector2: [
    "__add(self, other: Vector2): Vector2",
    "__sub(self, other: Vector2): Vector2",
    "__mul(self, other: Vector2 | number): Vector2",
    "__div(self, other: Vector2 | number): Vector2",
    "__idiv(self, other: Vector2 | number): Vector2",
    "__unm(self): Vector2",
  ],
  Vector3int16: [
    "__add(self, other: Vector3int16): Vector3int16",
    "__sub(self, other: Vector3int16): Vector3int16",
    "__mul(self, other: Vector3int16 | number): Vector3int16",
    "__div(self, other: Vector3int16 | number): Vector3int16",
  ],
  Vector2int16: [
    "__add(self, other: Vector2int16): Vector2int16",
    "__sub(self, other: Vector2int16): Vector2int16",
    "__mul(self, other: Vector2int16 | number): Vector2int16",
    "__div(self, other: Vector2int16 | number): Vector2int16",
  ],
  CFrame: [
    "__mul(self, other: CFrame): CFrame",
    "__mul(self, other: Vector3): Vector3",
    "__add(self, other: Vector3): CFrame",
    "__sub(self, other: Vector3): CFrame",
  ],
  UDim2: ["__add(self, other: UDim2): UDim2", "__sub(self, other: UDim2): UDim2", "__unm(self): UDim2"],
  UDim: ["__add(self, other: UDim): UDim", "__sub(self, other: UDim): UDim", "__unm(self): UDim"],
};

const parts = [
  "-- Generated by scripts/gen-luau-types.mjs from the Roblox Creator Documentation",
  "-- (https://github.com/Roblox/creator-docs, CC BY 4.0). Do not edit.",
  "",
  `type RBXScriptSignal<T... = ...any> = {
	Connect: (self: any, callback: (T...) -> ()) -> RBXScriptConnection,
	ConnectParallel: (self: any, callback: (T...) -> ()) -> RBXScriptConnection,
	Once: (self: any, callback: (T...) -> ()) -> RBXScriptConnection,
	Wait: (self: any) -> T...,
}`,
  declareType("RBXScriptConnection", null, "\tConnected: boolean\n\tfunction Disconnect(self): ()"),
  declareType(
    "EnumItem",
    null,
    "\tName: string\n\tValue: number\n\tEnumType: Enum\n\tfunction IsA(self, enumName: string): boolean",
  ),
  declareType(
    "Enum",
    null,
    "\tfunction GetEnumItems(self): { EnumItem }\n\tfunction FromName(self, name: string): EnumItem?\n\tfunction FromValue(self, value: number): EnumItem?",
  ),
];

// Enums: a class per enum for its items, and one for the enum itself (Enum.Material).
const enumList = [...enums].sort();
for (const name of enumList) {
  parts.push(declareType(`Enum${name}`, "EnumItem", ""));
  const items = api.enums[name].map((item) => `\t${item}: Enum${name}`);
  parts.push(declareType(`Enum${name}_INTERNAL`, "Enum", items.join("\n")));
}
const enumFields = enumList.map((n) => `\t${n}: Enum${n}_INTERNAL`);
parts.push(declareType("Enums", null, [...enumFields, "\tfunction GetEnums(self): { Enum }"].join("\n")));

// Datatypes: members on a class, constructors on a global table of the same name.
for (const name of [...datatypes].sort()) {
  if (MANUAL.has(name)) continue;
  const dt = api.datatypes[name];
  const ops = (OPERATORS[name] ?? []).map((o) => `\tfunction ${o}`);
  parts.push(declareType(name, null, classBody(dt.members ?? [], ops)));
  // Constructors with several forms (CFrame.new) become overloads: (A) & (B).
  const byName = new Map();
  for (const st of dt.statics ?? []) {
    const type = st.k === "p" ? luauType(st.t) : `(${fnType(st)})`;
    byName.set(st.n, [...(byName.get(st.n) ?? []), type]);
  }
  const statics = [...byName].map(([n, types]) => `\t${n}: ${[...new Set(types)].join(" & ")},`);
  if (statics.length) parts.push(`declare ${name}: {\n${statics.join("\n")}\n}`);
}

// Classes, base classes first.
const written = new Set();
function writeClass(name) {
  if (written.has(name)) return;
  written.add(name);
  const c = api.classes[name];
  const base = c.super && classes.has(c.super) ? c.super : null;
  if (base) writeClass(base);
  parts.push(declareType(name, base, classBody(c.members)));
}
for (const name of [...classes].sort()) writeClass(name);

// Instance.new("Part") and game:GetService("Players") return Instance here; the checker
// narrows them to Part and Players from the string (see packages/luau/src/analysis.cpp).
parts.push(`declare Instance: {
	new: (className: string, parent: Instance?) -> Instance,
	fromExisting: <T>(existingInstance: T) -> T,
}`);

// Roblox globals and the task library (Luau's own globals are built in).
parts.push(`declare game: DataModel
declare workspace: Workspace
declare Workspace: Workspace
declare script: LuaSourceContainer
declare Enum: Enums
declare shared: { [any]: any }
declare plugin: Plugin
declare function wait(seconds: number?): (number, number)
declare function delay(seconds: number, callback: (...any) -> ()): ()
declare function spawn(callback: (...any) -> ()): ()
declare function tick(): number
declare function time(): number
declare function elapsedTime(): number
declare function warn(...: any): ()
declare function printidentity(prefix: string?): ()
declare function settings(): GlobalSettings
declare function UserSettings(): UserSettings
declare function version(): string
declare function stats(): Stats
declare task: {
${api.libraries.task.map((f) => `\t${f.n}: ${fnType(f)},`).join("\n")}
}`);

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${parts.join("\n\n")}\n`);
console.log(`wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
