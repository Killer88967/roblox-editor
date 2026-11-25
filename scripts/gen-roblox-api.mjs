// Generates apps/web/src/data/roblox-api.json from Roblox's engine API reference.
//
// Source: Roblox Creator Documentation (https://github.com/Roblox/creator-docs),
// content/en-us/reference/engine, licensed CC BY 4.0. The output is a trimmed,
// modified subset (names, types, parameters, short summaries) for editor autocomplete.
//
// Usage:
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/Roblox/creator-docs
//   git -C creator-docs sparse-checkout set content/en-us/reference/engine
//   node scripts/gen-roblox-api.mjs creator-docs

import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const docs = process.argv[2];
if (!docs) {
  console.error("usage: node scripts/gen-roblox-api.mjs <path to creator-docs checkout>");
  process.exit(1);
}
const root = path.join(docs, "content/en-us/reference/engine");
const out = path.join(import.meta.dirname, "../apps/web/src/data/roblox-api.json");

const load = (dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => parse(fs.readFileSync(path.join(root, dir, f), "utf8")));

/** First sentence of a summary, as plain text, at most ~160 characters. */
function short(text) {
  if (!text) return undefined;
  let s = String(text)
    // `Class.Foo.Bar|Label` -> Label, `Enum.X.Y` -> X.Y
    .replace(/`(?:Class|Enum|Datatype|Global|Library)\.([^`|]+)\|([^`]+)`/g, "$2")
    .replace(/`(?:Class|Enum|Datatype|Global|Library)\.([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = s.search(/\.(\s|$)/);
  if (end > 0) s = s.slice(0, end + 1);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s || undefined;
}

const tagged = (m, tag) => (m.tags ?? []).includes(tag);
const bareName = (full) => full.split(/[.:]/).pop();
const params = (list) =>
  (list ?? []).map((p) => {
    const out = [p.name, String(p.type ?? "any")];
    if (p.default !== null && p.default !== undefined && p.default !== "")
      out.push(String(p.default));
    return out;
  });
const returns = (list) => (list ?? []).map((r) => String(r.type)).join(", ") || undefined;

/** Members scripts can use: no hidden/internal ones, no Roblox-only security. */
function usable(m, kind) {
  if (tagged(m, "Hidden") || tagged(m, "NotScriptable") || tagged(m, "NotBrowsable")) return false;
  const sec = m.security;
  if (kind === "p") return !sec || sec.read === "None";
  return !sec || sec === "None";
}

function member(m, kind) {
  const entry = { n: bareName(m.name), k: kind };
  if (kind === "p") entry.t = String(m.type ?? "any");
  if (kind !== "p") entry.p = params(m.parameters);
  if (kind === "m" || kind === "c") entry.t = returns(m.returns);
  const s = short(m.summary);
  if (s) entry.s = s;
  if (tagged(m, "Deprecated")) entry.d = 1;
  if (tagged(m, "ReadOnly")) entry.ro = 1;
  if (tagged(m, "Yields")) entry.y = 1;
  return entry;
}

const classes = {};
for (const c of load("classes")) {
  const members = [];
  for (const [list, kind] of [
    ["properties", "p"],
    ["methods", "m"],
    ["events", "e"],
    ["callbacks", "c"],
  ]) {
    for (const m of c[list] ?? []) if (usable(m, kind)) members.push(member(m, kind));
  }
  const entry = { members };
  if (c.inherits?.length) entry.super = c.inherits[0];
  const tags = (c.tags ?? []).filter((t) => ["NotCreatable", "Service", "Deprecated"].includes(t));
  if (tags.length) entry.tags = tags;
  const s = short(c.summary);
  if (s) entry.s = s;
  classes[c.name] = entry;
}

const enums = {};
for (const e of load("enums")) {
  enums[e.name] = (e.items ?? []).filter((i) => !tagged(i, "Deprecated")).map((i) => i.name);
}

/** Static functions/constructors/constants of a datatype or library: `Vector3.new`, `task.wait`. */
function statics(entries, kind) {
  return (entries ?? []).map((f) => {
    const e = { n: bareName(f.name), k: kind };
    if (kind === "f") {
      e.p = params(f.parameters);
      e.t = returns(f.returns);
    } else {
      e.t = String(f.type ?? "any");
    }
    const s = short(f.summary);
    if (s) e.s = s;
    if (tagged(f, "Deprecated")) e.d = 1;
    return e;
  });
}

const datatypes = {};
for (const d of load("datatypes")) {
  // Constructors return the datatype itself when the docs don't say.
  const constructors = statics(d.constructors, "f").map((c) => ({ ...c, t: c.t ?? d.name }));
  datatypes[d.name] = {
    statics: [...constructors, ...statics(d.functions, "f"), ...statics(d.constants, "p")],
    members: [
      ...(d.properties ?? []).map((p) => ({
        n: bareName(p.name),
        k: "p",
        t: String(p.type ?? "any"),
        s: short(p.summary),
      })),
      ...(d.methods ?? []).map((m) => ({
        n: bareName(m.name),
        k: "m",
        p: params(m.parameters),
        t: returns(m.returns),
        s: short(m.summary),
      })),
    ],
  };
}

const libraries = {};
for (const l of load("libraries")) {
  libraries[l.name] = [...statics(l.functions, "f"), ...statics(l.properties, "p")];
}

const globals = [];
for (const g of load("globals")) {
  globals.push(...statics(g.functions, "f"), ...statics(g.properties, "p"));
}

const studioVersion = fs.readFileSync(path.join(root, "STUDIO_VERSION"), "utf8").trim();
const data = {
  about: {
    source:
      "Roblox Creator Documentation, https://github.com/Roblox/creator-docs (content/en-us/reference/engine)",
    license:
      "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Trimmed and modified for editor autocomplete.",
    studioVersion,
  },
  classes,
  enums,
  datatypes,
  libraries,
  globals,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));
console.log(
  `wrote ${path.relative(process.cwd(), out)}: ${Object.keys(classes).length} classes, ` +
    `${Object.keys(enums).length} enums, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`,
);
