import type { Monaco } from "@monaco-editor/react";
import {
  callAt,
  chainBefore,
  lookup,
  tokenAt,
  tokenBefore,
  visibleAt,
  type Analysis,
  type Decl,
  type Field,
  type Param,
  PRIMITIVE_TYPES,
} from "./luau-analyze";
import { analysisOf, treeFor, type Model, type Position, type Range } from "./luau-model";
import { serviceInsertLine } from "./luau-providers";
import { resolveExpression, type Target, type Tree } from "./luau-resolve";
import {
  classMembers,
  creatableNames,
  findMember,
  loadApi,
  serviceNames,
  signature,
  type Api,
  type ApiMember,
} from "./roblox-api";
import type { NodeInfo } from "./types";

const IDENT_ONLY = /^[A-Za-z_]\w*$/;

type Suggestion = {
  label: string;
  kind: number;
  detail?: string;
  documentation?: { value: string };
  insertText: string;
  insertTextRules?: number;
  filterText?: string;
  sortText?: string;
  tags?: number[];
  range: Range;
  additionalTextEdits?: { range: Range; text: string }[];
};

type Ctx = {
  model: Model;
  /** Text of the cursor's line before the cursor. */
  line: string;
  /** Cursor offset. */
  at: number;
  an: Analysis;
  tree: Tree;
  nodes: Map<string, NodeInfo>;
};

/** Everything the providers need about the script and the cursor. */
function context(model: Model, position: Position): Ctx | null {
  const tree = treeFor(model);
  if (!tree) return null;
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  return {
    model,
    line,
    at: model.getOffsetAt(position),
    an: analysisOf(model),
    tree,
    nodes: tree.nodes,
  };
}

const lineRange = (position: Position, startColumn: number, endColumn: number): Range => ({
  startLineNumber: position.lineNumber,
  endLineNumber: position.lineNumber,
  startColumn,
  endColumn,
});

const doc = (m: ApiMember) => (m.s ? { value: m.s } : undefined);

const paramList = (params: Param[] | undefined) =>
  (params ?? []).map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(", ");

/** A table field shown like an API member. */
const fieldMember = (f: Field): ApiMember => ({
  n: f.name,
  k: f.params || f.method ? "f" : "p",
  p: f.params?.map((p) => [p.name, p.type ?? "any"]),
});

function memberDetail(m: ApiMember) {
  if (m.k === "p") return `${m.t ?? "any"}${m.ro ? " (read-only)" : ""}`;
  if (m.k === "e") return `RBXScriptSignal ${signature({ ...m, t: undefined })}`;
  return signature(m);
}

/** Members available on a target, plus a display name for its owner. */
export function membersOf(api: Api, target: Target): { members: ApiMember[]; owner: string } {
  switch (target.kind) {
    case "instance":
      return { members: classMembers(api, target.className), owner: target.className };
    case "value":
      return { members: api.datatypes[target.type]?.members ?? [], owner: target.type };
    case "static":
      return {
        members: api.datatypes[target.name]?.statics ?? api.libraries[target.name] ?? [],
        owner: target.name,
      };
    case "table":
      return { members: target.fields.map(fieldMember), owner: target.name };
    default:
      return { members: [], owner: "" };
  }
}

/** A short description of what a target is, for hovers. */
function describe(api: Api, target: Target): string {
  switch (target.kind) {
    case "instance":
      return target.className;
    case "value":
      return target.type;
    case "static":
      return api.libraries[target.name] ? `library ${target.name}` : `datatype ${target.name}`;
    case "enums":
      return "Enums";
    case "enum":
      return `Enum.${target.name}`;
    case "table": {
      const names = target.fields.map((f) => f.name);
      return `{ ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""} }`;
    }
  }
}

/** Whether the cursor is inside a comment or an unfinished string. */
function inCommentOrString(ctx: Ctx) {
  const withoutStrings = ctx.line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  if (/--/.test(withoutStrings) || /["'`]/.test(withoutStrings.replace(/""/g, ""))) return true;
  // Inside a multi-line comment or long string.
  const lineStart = ctx.at - ctx.line.length;
  if (ctx.an.masked.slice(lineStart, ctx.at) !== ctx.an.code.slice(lineStart, ctx.at)) return true;
  const k = tokenBefore(ctx.an, ctx.at);
  const t = ctx.an.toks[k];
  return !!t && t.k === "str" && t.e > ctx.at;
}

/** The `.`/`:` access being typed at the cursor, worked out from tokens (works across lines). */
function accessAt(ctx: Ctx) {
  const { an, at } = ctx;
  let k = tokenBefore(an, at);
  let t = an.toks[k];
  if (!t) return null;
  if (t.k === "name" && t.e === at) {
    k--;
    t = an.toks[k];
  }
  if (!t || t.k !== "op" || (t.v !== "." && t.v !== ":" && t.v !== "::" && t.v !== "->")) {
    return null;
  }
  // Only whitespace between the separator and the word being typed.
  const word = ctx.model.getWordUntilPosition(ctx.model.getPositionAt(at));
  const gap = an.code.slice(t.e, at - word.word.length);
  if (gap.trim()) return null;
  return { sepIndex: k, sep: t.v };
}

/** Whether a `:` at token k starts a type annotation (`local x: `, `function(a: `). */
function isTypeColon(an: Analysis, k: number) {
  const before = an.toks[k - 1];
  const before2 = an.toks[k - 2];
  if (!before || before.k !== "name") return before?.v === ")" && isFunctionParams(an, k - 1);
  if (before2?.k === "kw" && (before2.v === "local" || before2.v === "for")) return true;
  // A parameter: inside the `(` of a function definition.
  const open = an.top[k];
  return (
    open >= 0 &&
    an.toks[open].v === "(" &&
    isFunctionParams(an, an.match[open] >= 0 ? an.match[open] : open)
  );
}

/** Whether token k (a `)` or `(`) belongs to a function definition's parameter list. */
function isFunctionParams(an: Analysis, k: number) {
  const open = an.toks[k].v === ")" ? an.match[k] : k;
  if (open < 0) return false;
  let j = open - 1;
  // function name.part:method(
  while (an.toks[j] && (an.toks[j].k === "name" || an.toks[j].v === "." || an.toks[j].v === ":"))
    j--;
  return an.toks[j]?.k === "kw" && an.toks[j].v === "function";
}

let registered = false;

/**
 * Studio-style script intelligence for the "luau" language: completions after `.` and `:`
 * (instances, datatypes, libraries, enums, tables and required modules), inside common
 * string arguments, enum values after `=` and in arguments, snippets, keywords, services
 * (adding the GetService line), type annotations, hover info and parameter hints.
 */
export function registerCompletions(monaco: Monaco) {
  if (registered) return;
  registered = true;
  // Start fetching the API data now so the first suggestions are quick.
  void loadApi();

  const K = monaco.languages.CompletionItemKind;
  const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const kindOf = (m: ApiMember) =>
    ({ p: K.Property, m: K.Method, e: K.Event, c: K.Function, f: K.Function })[m.k];
  const deprecated = (m: ApiMember) =>
    m.d ? [monaco.languages.CompletionItemTag.Deprecated] : undefined;

  const fromMembers = (members: ApiMember[], range: Range): Suggestion[] =>
    members.map((m) => ({
      label: m.n,
      kind: kindOf(m),
      detail: memberDetail(m),
      documentation: doc(m),
      insertText: m.n,
      // Deprecated members sink to the bottom.
      sortText: `${m.d ? "9" : "1"}${m.n}`,
      tags: deprecated(m),
      range,
    }));

  const enumItems = (api: Api, enumName: string, range: Range, sort = "0"): Suggestion[] =>
    (api.enums[enumName] ?? []).map((item) => ({
      label: `Enum.${enumName}.${item}`,
      kind: K.EnumMember,
      detail: `Enum.${enumName}`,
      insertText: `Enum.${enumName}.${item}`,
      sortText: `${sort}${item}`,
      range,
    }));

  /** Suggestions after `target.` */
  function afterDot(
    api: Api,
    target: Target,
    nodes: Map<string, NodeInfo>,
    range: Range,
    dotRange: Range,
  ) {
    const out: Suggestion[] = [];
    switch (target.kind) {
      case "instance": {
        // Children first, like Studio. Names that aren't identifiers become ["..."].
        for (const childId of target.id ? (nodes.get(target.id)?.children ?? []) : []) {
          const c = nodes.get(childId);
          if (!c) continue;
          const plain = IDENT_ONLY.test(c.name);
          out.push({
            label: c.name,
            kind: K.Field,
            detail: c.class,
            insertText: plain
              ? c.name
              : `["${c.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`,
            filterText: plain ? c.name : `.${c.name}`,
            sortText: `0${c.name}`,
            range: plain ? range : dotRange,
          });
        }
        const members = classMembers(api, target.className).filter(
          (m) => m.k === "p" || m.k === "e",
        );
        out.push(...fromMembers(members, range));
        break;
      }
      case "value": {
        const members = api.datatypes[target.type]?.members ?? [];
        out.push(
          ...fromMembers(
            members.filter((m) => m.k === "p"),
            range,
          ),
        );
        break;
      }
      case "static":
        out.push(...fromMembers(membersOf(api, target).members, range));
        break;
      case "table":
        for (const f of target.fields) {
          if (f.method) continue;
          out.push({
            label: f.name,
            kind: f.params ? K.Function : K.Field,
            detail: f.params ? `(${paramList(f.params)})` : target.name,
            insertText: f.name,
            sortText: `0${f.name}`,
            range,
          });
        }
        break;
      case "enums":
        for (const name of Object.keys(api.enums)) {
          out.push({ label: name, kind: K.Enum, insertText: name, range });
        }
        break;
      case "enum":
        for (const item of api.enums[target.name] ?? []) {
          out.push({
            label: item,
            kind: K.EnumMember,
            detail: `Enum.${target.name}`,
            insertText: item,
            range,
          });
        }
        break;
    }
    return out;
  }

  /** Suggestions after `target:` (methods). */
  function afterColon(api: Api, target: Target, range: Range): Suggestion[] {
    if (target.kind === "table") {
      return target.fields
        .filter((f) => f.method || f.params)
        .map((f) => ({
          label: f.name,
          kind: K.Method,
          detail: `(${paramList(f.params)})`,
          insertText: f.name,
          sortText: `${f.method ? "0" : "1"}${f.name}`,
          range,
        }));
    }
    if (target.kind !== "instance" && target.kind !== "value") return [];
    return fromMembers(
      membersOf(api, target).members.filter((m) => m.k === "m"),
      range,
    );
  }

  /** Type names for annotations (`local x: `, `function(a: `, `:: `, `-> `). */
  function typeNames(api: Api, an: Analysis, range: Range): Suggestion[] {
    const out: Suggestion[] = [];
    for (const t of PRIMITIVE_TYPES)
      out.push({ label: t, kind: K.Keyword, insertText: t, sortText: `0${t}`, range });
    for (const t of an.typeNames)
      out.push({ label: t, kind: K.Interface, insertText: t, sortText: `0${t}`, range });
    for (const t of Object.keys(api.datatypes))
      out.push({ label: t, kind: K.Struct, insertText: t, sortText: `1${t}`, range });
    for (const t of Object.keys(api.classes))
      out.push({ label: t, kind: K.Class, insertText: t, sortText: `2${t}`, range });
    return out;
  }

  /** Inside `GetService("`, `Instance.new("`, `WaitForChild("`, `IsA("` and friends. */
  function inString(api: Api, ctx: Ctx, range: Range): Suggestion[] | null {
    const m = ctx.line.match(/(?:(.*?)\s*[.:]\s*)?(\w+)\s*\(\s*["'][^"']*$/);
    if (!m) return null;
    const before = (m[1] ?? "").match(/[A-Za-z_][\w.:()[\]"'\s]*$/)?.[0]?.trim() ?? "";
    const fn = m[2];
    const target = () => (before ? resolveExpression(before, ctx.at, ctx.an, ctx.tree, api) : null);
    let items: { label: string; detail?: string }[] = [];

    if (fn === "GetService") {
      items = serviceNames(api).map((label) => ({ label }));
    } else if (fn === "new" && /(^|\W)Instance$/.test(before)) {
      items = creatableNames(api).map((label) => ({ label }));
    } else if (
      /^(IsA|FindFirstChildOfClass|FindFirstChildWhichIsA|FindFirstAncestorOfClass|FindFirstAncestorWhichIsA|GetChildrenOfClass)$/.test(
        fn,
      )
    ) {
      items = Object.keys(api.classes).map((label) => ({ label }));
    } else if (fn === "GetPropertyChangedSignal") {
      const t = target();
      if (t?.kind === "instance") {
        items = classMembers(api, t.className)
          .filter((x) => x.k === "p")
          .map((x) => ({ label: x.n, detail: x.t }));
      }
    } else if (/^(WaitForChild|FindFirstChild|FindFirstAncestor|FindFirstDescendant)$/.test(fn)) {
      const t = target();
      if (t?.kind === "instance" && t.id) {
        items = (ctx.nodes.get(t.id)?.children ?? [])
          .map((c) => ctx.nodes.get(c))
          .filter((c): c is NodeInfo => !!c)
          .map((c) => ({ label: c.name, detail: c.class }));
      }
    } else {
      return null;
    }
    return items.map((n) => ({
      label: n.label,
      kind: K.Value,
      detail: n.detail,
      insertText: n.label,
      range,
    }));
  }

  /** `part.Material = ` / `x.Visible == `: the property's enum items or true/false. */
  function afterEquals(api: Api, ctx: Ctx, range: Range): Suggestion[] | null {
    const m = ctx.line.match(
      /([A-Za-z_]\w*(?:\s*(?:\.\s*[A-Za-z_]\w*|:\s*\w+\s*\([^()]*\)|\(\s*[^()]*\)|\[\s*["'][^"']+["']\s*\]))*)\s*\.\s*([A-Za-z_]\w*)\s*(?:==|~=|=)\s*\w*$/,
    );
    if (!m) return null;
    const target = resolveExpression(m[1], ctx.at, ctx.an, ctx.tree, api);
    if (target?.kind !== "instance") return null;
    const prop = findMember(api, target.className, m[2]);
    if (prop?.k !== "p" || !prop.t) return null;
    const enumName = prop.t.replace(/^Enum\./, "");
    if (api.enums[enumName]) return enumItems(api, enumName, range);
    if (prop.t === "boolean" || prop.t === "bool") {
      return ["true", "false"].map((v) => ({
        label: v,
        kind: K.Constant,
        insertText: v,
        sortText: `0${v}`,
        range,
      }));
    }
    return null;
  }

  /** Enum items when the argument being typed expects an enum (`IsKeyDown(` → Enum.KeyCode). */
  function enumArgument(api: Api, ctx: Ctx, range: Range): Suggestion[] {
    const call = callAt(ctx.an, ctx.at);
    if (!call) return [];
    let member: ApiMember | undefined;
    if (call.expr) {
      const target = resolveExpression(call.expr, call.at, ctx.an, ctx.tree, api);
      if (target) member = membersOf(api, target).members.find((x) => x.n === call.name);
    } else {
      member = api.globals.find((g) => g.n === call.name);
    }
    const type = member?.p?.[call.arg]?.[1]?.replace(/\?$/, "").replace(/^Enum\./, "");
    return type && api.enums[type] ? enumItems(api, type, range) : [];
  }

  const SNIPPETS: [string, string, string][] = [
    ["function", "function ${1:name}(${2})\n\t$0\nend", "function … end"],
    ["local function", "local function ${1:name}(${2})\n\t$0\nend", "local function … end"],
    ["if", "if ${1:condition} then\n\t$0\nend", "if … then … end"],
    ["if else", "if ${1:condition} then\n\t$2\nelse\n\t$0\nend", "if … then … else … end"],
    ["elseif", "elseif ${1:condition} then\n\t$0", "elseif … then"],
    ["for", "for ${1:i} = ${2:1}, ${3:10} do\n\t$0\nend", "numeric for loop"],
    ["for pairs", "for ${1:key}, ${2:value} in pairs(${3:t}) do\n\t$0\nend", "for … in pairs()"],
    ["for ipairs", "for ${1:i}, ${2:v} in ipairs(${3:t}) do\n\t$0\nend", "for … in ipairs()"],
    ["for in", "for ${1:_}, ${2:v} in ${3:t} do\n\t$0\nend", "for … in t (generalized iteration)"],
    ["while", "while ${1:true} do\n\t$0\nend", "while … do … end"],
    ["repeat", "repeat\n\t$0\nuntil ${1:condition}", "repeat … until"],
    ["do", "do\n\t$0\nend", "do … end"],
    ["pcall", "local ${1:ok}, ${2:result} = pcall(function()\n\t$0\nend)", "protected call"],
    [
      "GetService",
      'local ${1:Players} = game:GetService("${1}")',
      "local Service = game:GetService(…)",
    ],
    ["Connect", "${1:event}:Connect(function(${2})\n\t$0\nend)", "connect a function to an event"],
  ];
  const KEYWORDS = [
    "and",
    "break",
    "continue",
    "else",
    "end",
    "false",
    "in",
    "local",
    "nil",
    "not",
    "or",
    "return",
    "then",
    "true",
    "until",
  ];

  /** Locals, globals, libraries, datatypes, snippets, keywords and services for a fresh word. */
  function bare(api: Api, ctx: Ctx, range: Range): Suggestion[] {
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const add = (s: Suggestion) => {
      if (seen.has(s.label)) return;
      seen.add(s.label);
      out.push(s);
    };
    out.push(...enumArgument(api, ctx, range));

    const visible = visibleAt(ctx.an, ctx.at);
    for (const d of visible) {
      add({
        label: d.name,
        kind: d.params ? K.Function : K.Variable,
        detail: d.params
          ? `function ${d.name}(${paramList(d.params)})`
          : d.kind === "param"
            ? "parameter"
            : d.kind,
        insertText: d.name,
        sortText: `0${d.name}`,
        range,
      });
    }
    for (const g of api.globals) {
      add({
        label: g.n,
        kind: g.k === "f" ? K.Function : K.Variable,
        detail: g.k === "f" ? signature(g) : g.t,
        documentation: doc(g),
        insertText: g.n,
        sortText: `${g.d ? "9" : "1"}${g.n}`,
        tags: deprecated(g),
        range,
      });
    }
    for (const name of Object.keys(api.libraries)) {
      add({
        label: name,
        kind: K.Module,
        detail: "library",
        insertText: name,
        sortText: `2${name}`,
        range,
      });
    }
    for (const name of Object.keys(api.datatypes)) {
      add({
        label: name,
        kind: K.Class,
        detail: "datatype",
        insertText: name,
        sortText: `2${name}`,
        range,
      });
    }
    for (const kw of KEYWORDS)
      add({ label: kw, kind: K.Keyword, insertText: kw, sortText: `1${kw}`, range });
    for (const [label, body, detail] of SNIPPETS) {
      out.push({
        label,
        kind: K.Snippet,
        detail,
        insertText: body,
        insertTextRules: SNIPPET,
        sortText: `1${label}`,
        range,
      });
    }

    // Services not in a variable yet: picking one adds the GetService line at the top.
    const line = serviceInsertLine(ctx.an);
    const at = { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 };
    for (const name of serviceNames(api)) {
      if (seen.has(name)) continue;
      const text = `local ${name} = game:GetService("${name}")\n`;
      add({
        label: name,
        kind: K.Module,
        detail: "Service",
        documentation: { value: `Adds \`${text.trim()}\` at the top of the script.` },
        insertText: name,
        sortText: `3${name}`,
        additionalTextEdits: [{ range: at, text }],
        range,
      });
    }
    return out;
  }

  monaco.languages.registerCompletionItemProvider("luau", {
    triggerCharacters: [".", ":", '"', "'", " ", "=", "(", ","],
    async provideCompletionItems(
      model: Model,
      position: Position,
      trigger: { triggerCharacter?: string },
    ) {
      const ctx = context(model, position);
      if (!ctx) return { suggestions: [] };
      const api = await loadApi();
      const word = model.getWordUntilPosition(position);
      const range = lineRange(position, word.startColumn, word.endColumn);

      // A space or `=` only brings up enum values / true-false after `x.Prop = `, and `(`
      // or `,` only enum values for an argument that takes one.
      const ch = trigger.triggerCharacter;
      if (ch === " " || ch === "=" || ch === "(" || ch === ",") {
        if (inCommentOrString(ctx)) return { suggestions: [] };
        if (ch === "(" || ch === ",") return { suggestions: enumArgument(api, ctx, range) };
        return { suggestions: afterEquals(api, ctx, range) ?? [] };
      }

      const strings = inString(api, ctx, range);
      if (strings) return { suggestions: strings };
      if (inCommentOrString(ctx)) return { suggestions: [] };

      // Naming something new: nothing to suggest.
      if (
        /(^|[^\w.])(local|function|for)\s+(\w+\s*,\s*)*\w*$/.test(ctx.line) &&
        !/=/.test(ctx.line)
      ) {
        return { suggestions: [] };
      }

      const access = accessAt(ctx);
      if (access) {
        const { sepIndex, sep } = access;
        if (sep === "::" || sep === "->" || (sep === ":" && isTypeColon(ctx.an, sepIndex))) {
          return { suggestions: typeNames(api, ctx.an, range) };
        }
        const chain = chainBefore(ctx.an, sepIndex);
        const target = chain
          ? resolveExpression(chain.expr, chain.at, ctx.an, ctx.tree, api)
          : null;
        if (!target) return { suggestions: [] };
        // For ["Name"] children the inserted text replaces the `.` as well.
        const sepPos = model.getPositionAt(ctx.an.toks[sepIndex].s);
        const dotRange =
          sepPos.lineNumber === position.lineNumber
            ? lineRange(position, sepPos.column, word.endColumn)
            : range;
        return {
          suggestions:
            sep === "."
              ? afterDot(api, target, ctx.nodes, range, dotRange)
              : afterColon(api, target, range),
        };
      }
      // Typing right after a `.`/`:` that we couldn't make sense of.
      if (/[.:]\s*\w*$/.test(ctx.line) && !/\.\.\s*\w*$/.test(ctx.line)) return { suggestions: [] };

      const equals = afterEquals(api, ctx, range);
      const fresh = bare(api, ctx, range);
      return { suggestions: equals ? [...equals, ...fresh] : fresh };
    },
  });

  monaco.languages.registerHoverProvider("luau", {
    async provideHover(model: Model, position: Position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const ctx = context(model, { ...position, column: word.endColumn });
      if (!ctx) return null;
      const api = await loadApi();
      const range = lineRange(position, word.startColumn, word.endColumn);
      const k = tokenAt(ctx.an, model.getOffsetAt({ ...position, column: word.startColumn }));
      const tok = ctx.an.toks[k];
      if (!tok || tok.k !== "name") return null;
      const code = (s: string) => ({ value: `\`\`\`luau\n${s}\n\`\`\`` });

      const prev = ctx.an.toks[k - 1];
      const isAccess = prev?.k === "op" && (prev.v === "." || prev.v === ":");
      if (isAccess) {
        const chain = chainBefore(ctx.an, k - 1);
        const target = chain
          ? resolveExpression(chain.expr, chain.at, ctx.an, ctx.tree, api)
          : null;
        if (!target) return null;
        if (target.kind === "enums" || target.kind === "enum") {
          const what =
            target.kind === "enums"
              ? `(enum) Enum.${tok.v}`
              : `(enum item) Enum.${target.name}.${tok.v}`;
          return { range, contents: [code(what)] };
        }
        const { members, owner } = membersOf(api, target);
        const member = members.find((m) => m.n === tok.v);
        if (member) {
          const sep = member.k === "m" || prev.v === ":" ? ":" : ".";
          const kind = { p: "property", m: "method", e: "event", c: "callback", f: "function" }[
            member.k
          ];
          const name = `${owner}${owner ? sep : ""}${member.n}`;
          const head =
            member.k === "p"
              ? `${name}: ${member.t ?? "any"}`
              : member.k === "e"
                ? `${name}: RBXScriptSignal${member.p?.length ? ` ${signature({ ...member, t: undefined })}` : ""}`
                : `${name}${signature(member)}`;
          return {
            range,
            contents: [
              code(`(${kind}) ${head}`),
              ...(member.s ? [{ value: member.s }] : []),
              ...(member.d ? [{ value: "_Deprecated._" }] : []),
            ],
          };
        }
      }

      // A local, parameter or global defined in this script.
      const expr = isAccess ? `${chainBefore(ctx.an, k - 1)?.expr}${prev.v}${tok.v}` : tok.v;
      const decl = isAccess ? undefined : lookup(ctx.an, tok.v, tok.s);
      const target = resolveExpression(expr, tok.s, ctx.an, ctx.tree, api);
      if (!isAccess && !decl) {
        const g = api.globals.find((x) => x.n === tok.v);
        if (g) {
          const head = g.k === "f" ? `function ${g.n}${signature(g)}` : `${g.n}: ${g.t ?? "any"}`;
          return {
            range,
            contents: [
              code(`(global) ${head}`),
              ...(g.s ? [{ value: g.s }] : []),
              ...(g.d ? [{ value: "_Deprecated._" }] : []),
            ],
          };
        }
        if (api.libraries[tok.v]) return { range, contents: [code(`(library) ${tok.v}`)] };
        if (api.datatypes[tok.v]) return { range, contents: [code(`(datatype) ${tok.v}`)] };
      }
      if (decl?.params && !target) {
        return {
          range,
          contents: [
            code(`${decl.isLocal ? "local " : ""}function ${decl.name}(${paramList(decl.params)})`),
          ],
        };
      }
      if (!target) {
        return decl ? { range, contents: [code(`${label(decl)} ${decl.name}`)] } : null;
      }
      if (target.kind === "instance") {
        const path: string[] = [];
        for (let id = target.id; id && id !== ctx.tree.rootId; id = ctx.nodes.get(id)?.parent) {
          path.unshift(ctx.nodes.get(id)?.name ?? "?");
        }
        const summary = api.classes[target.className]?.s;
        return {
          range,
          contents: [
            code(`${decl ? `${label(decl)} ` : ""}${expr}: ${target.className}`),
            ...(path.length ? [{ value: `\`game.${path.join(".")}\`` }] : []),
            ...(summary ? [{ value: summary }] : []),
          ],
        };
      }
      return {
        range,
        contents: [code(`${decl ? `${label(decl)} ` : ""}${expr}: ${describe(api, target)}`)],
      };
    },
  });

  monaco.languages.registerSignatureHelpProvider("luau", {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    async provideSignatureHelp(model: Model, position: Position) {
      const ctx = context(model, position);
      if (!ctx) return null;
      const api = await loadApi();
      const call = callAt(ctx.an, ctx.at);
      if (!call) return null;

      let params: string[] | undefined;
      let label = "";
      let docs: string | undefined;
      let note: string | undefined;

      if (call.expr) {
        const target = resolveExpression(call.expr, call.at, ctx.an, ctx.tree, api);
        if (target) {
          const { members, owner } = membersOf(api, target);
          const member = members.find((m) => m.n === call.name);
          // Connect/Once on an event: say what the callback receives.
          if (
            target.kind === "value" &&
            target.event &&
            /^(Connect|Once|ConnectParallel)$/.test(call.name)
          ) {
            note = `The function receives: ${target.event.n}${signature({ ...target.event, t: undefined })}`;
          }
          if (member?.p) {
            params = member.p.map(([n, t, d]) =>
              d !== undefined ? `${n}: ${t} = ${d}` : `${n}: ${t}`,
            );
            label = `${owner}${call.sep}${member.n}(${params.join(", ")})${member.t ? `: ${member.t}` : ""}`;
            docs = member.s;
          }
        }
      } else {
        const decl = lookup(ctx.an, call.name, call.at);
        if (decl?.params) {
          params = decl.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name));
          label = `${call.name}(${params.join(", ")})`;
        } else {
          const g = api.globals.find((x) => x.n === call.name && x.k === "f");
          if (g?.p) {
            params = g.p.map(([n, t, d]) => (d !== undefined ? `${n}: ${t} = ${d}` : `${n}: ${t}`));
            label = `${g.n}(${params.join(", ")})${g.t ? `: ${g.t}` : ""}`;
            docs = g.s;
          }
        }
      }
      if (!params) return null;
      return {
        value: {
          signatures: [
            {
              label,
              documentation: { value: [docs, note].filter(Boolean).join("\n\n") },
              parameters: params.map((p) => ({ label: p })),
            },
          ],
          activeSignature: 0,
          activeParameter: Math.min(call.arg, Math.max(0, params.length - 1)),
        },
        dispose() {},
      };
    },
  });
}

const label = (d: Decl) =>
  d.kind === "param"
    ? "(parameter)"
    : d.kind === "global"
      ? "(global)"
      : d.kind === "for"
        ? "(loop variable)"
        : "local";
