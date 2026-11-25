import type { Monaco } from "@monaco-editor/react";
import { useEditor } from "@/stores/editor";
import { CHAIN_BEFORE, resolveExpression, type Target, type Tree } from "./luau-resolve";
import {
  classMembers,
  creatableNames,
  loadApi,
  serviceNames,
  signature,
  type Api,
  type ApiMember,
} from "./roblox-api";
import type { NodeInfo } from "./types";

const IDENT_ONLY = /^[A-Za-z_]\w*$/;

// The parts of Monaco's types this file uses (Monaco loads from a CDN, so its full type
// package isn't installed).
type Position = { lineNumber: number; column: number };
type Range = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};
type Word = { word: string; startColumn: number; endColumn: number };
type Model = {
  uri: { path: string };
  getLineContent(line: number): string;
  getValueInRange(range: Range): string;
  getWordUntilPosition(position: Position): Word;
  getWordAtPosition(position: Position): Word | null;
};

type Suggestion = {
  label: string;
  kind: number;
  detail?: string;
  documentation?: { value: string };
  insertText: string;
  filterText?: string;
  sortText?: string;
  tags?: number[];
  range: Range;
};

type Ctx = { line: string; code: string; tree: Tree; nodes: Map<string, NodeInfo> };

/** Everything the providers need about the script and the text before the cursor. */
function context(model: Model, position: Position): Ctx | null {
  const scriptId = model.uri.path.match(/script-([0-9a-f]+)\.luau$/)?.[1];
  const { nodes, rootId } = useEditor.getState();
  if (!scriptId || !rootId) return null;
  const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const code = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  return { line, code, tree: { nodes, rootId, scriptId }, nodes };
}

const lineRange = (position: Position, startColumn: number, endColumn: number): Range => ({
  startLineNumber: position.lineNumber,
  endLineNumber: position.lineNumber,
  startColumn,
  endColumn,
});

const doc = (m: ApiMember) => (m.s ? { value: m.s } : undefined);

function memberDetail(m: ApiMember) {
  if (m.k === "p") return `${m.t ?? "any"}${m.ro ? " (read-only)" : ""}`;
  if (m.k === "e") return `RBXScriptSignal ${signature({ ...m, t: undefined })}`;
  return signature(m);
}

/** Members available on a target, plus a display name for its owner. */
function membersOf(api: Api, target: Target): { members: ApiMember[]; owner: string } {
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
    default:
      return { members: [], owner: "" };
  }
}

/** Whether the cursor is inside a comment or an unfinished string on this line. */
function inCommentOrString(line: string) {
  const withoutStrings = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
  return /--/.test(withoutStrings) || /["'`]/.test(withoutStrings.replace(/""/g, ""));
}

let registered = false;

/**
 * Studio-style script intelligence for the "luau" language: completions after `.` and `:`,
 * inside common string arguments, and for globals/locals while typing; hover info; and
 * parameter hints for methods, Connect on events, library functions and constructors.
 */
export function registerCompletions(monaco: Monaco) {
  if (registered) return;
  registered = true;
  // Start fetching the API data now so the first suggestions are quick.
  void loadApi();

  const K = monaco.languages.CompletionItemKind;
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
  function afterColon(api: Api, target: Target, range: Range) {
    if (target.kind !== "instance" && target.kind !== "value") return [];
    return fromMembers(
      membersOf(api, target).members.filter((m) => m.k === "m"),
      range,
    );
  }

  /** Inside `GetService("`, `Instance.new("`, `WaitForChild("`, `IsA("` and friends. */
  function inString(api: Api, ctx: Ctx, range: Range): Suggestion[] | null {
    const m = ctx.line.match(/(?:(.*?)\s*[.:]\s*)?(\w+)\s*\(\s*["'][^"']*$/);
    if (!m) return null;
    const before = (m[1] ?? "").match(/[A-Za-z_][\w.:()[\]"'\s]*$/)?.[0]?.trim() ?? "";
    const fn = m[2];
    const target = () => (before ? resolveExpression(before, ctx.code, ctx.tree, api) : null);
    let items: { label: string; detail?: string }[] = [];

    if (fn === "GetService") {
      items = serviceNames(api).map((label) => ({ label }));
    } else if (fn === "new" && /(^|\W)Instance$/.test(before)) {
      items = creatableNames(api).map((label) => ({ label }));
    } else if (
      /^(IsA|FindFirstChildOfClass|FindFirstChildWhichIsA|FindFirstAncestorOfClass|FindFirstAncestorWhichIsA)$/.test(
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
    } else if (/^(WaitForChild|FindFirstChild)$/.test(fn)) {
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

  /** Locals, globals, libraries and datatypes while typing a fresh identifier. */
  function bare(api: Api, code: string, range: Range): Suggestion[] {
    const out: Suggestion[] = [];
    const seen = new Set<string>();
    const add = (s: Suggestion) => {
      if (seen.has(s.label)) return;
      seen.add(s.label);
      out.push(s);
    };
    // Locals, parameters-free functions and multi-assignments defined above the cursor.
    for (const m of code.matchAll(
      /\b(?:local\s+function|function|local)\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)/g,
    )) {
      for (const name of m[1].split(/\s*,\s*/)) {
        add({ label: name, kind: K.Variable, insertText: name, sortText: `0${name}`, range });
      }
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
    return out;
  }

  monaco.languages.registerCompletionItemProvider("luau", {
    triggerCharacters: [".", ":", '"', "'"],
    async provideCompletionItems(model: Model, position: Position) {
      const ctx = context(model, position);
      if (!ctx) return { suggestions: [] };
      const api = await loadApi();
      const word = model.getWordUntilPosition(position);
      const range = lineRange(position, word.startColumn, word.endColumn);

      const strings = inString(api, ctx, range);
      if (strings) return { suggestions: strings };
      if (inCommentOrString(ctx.line)) return { suggestions: [] };

      const chain = ctx.line.match(CHAIN_BEFORE);
      if (chain) {
        const [, expr, sep] = chain;
        const target = resolveExpression(expr, ctx.code, ctx.tree, api);
        if (!target) return { suggestions: [] };
        // For ["Name"] children the inserted text replaces the `.` as well.
        const sepIndex = ctx.line.lastIndexOf(sep, word.startColumn - 2);
        const dotRange = lineRange(position, sepIndex + 1, word.endColumn);
        return {
          suggestions:
            sep === "."
              ? afterDot(api, target, ctx.nodes, range, dotRange)
              : afterColon(api, target, range),
        };
      }

      // A fresh identifier, not right after `.` or `:`.
      if (/(^|[^\w.:])\w*$/.test(ctx.line)) return { suggestions: bare(api, ctx.code, range) };
      return { suggestions: [] };
    },
  });

  monaco.languages.registerHoverProvider("luau", {
    async provideHover(model: Model, position: Position) {
      const word = model.getWordAtPosition(position);
      const ctx = context(model, { ...position, column: word?.endColumn ?? position.column });
      if (!word || !ctx) return null;
      const api = await loadApi();
      const range = lineRange(position, word.startColumn, word.endColumn);
      const chain = ctx.line.match(CHAIN_BEFORE);

      let member: ApiMember | undefined;
      let owner = "";
      if (chain) {
        const target = resolveExpression(chain[1], ctx.code, ctx.tree, api);
        if (target) ({ owner } = membersOf(api, target));
        member = target ? membersOf(api, target).members.find((m) => m.n === word.word) : undefined;
      } else {
        member = api.globals.find((g) => g.n === word.word);
      }

      if (member) {
        const sep = member.k === "m" ? ":" : ".";
        const kind = { p: "property", m: "method", e: "event", c: "callback", f: "function" }[
          member.k
        ];
        const name = `${owner}${owner ? sep : ""}${member.n}`;
        const head = member.k === "p" ? `${name}: ${member.t}` : `${name}${signature(member)}`;
        return {
          range,
          contents: [
            { value: `\`\`\`luau\n(${kind}) ${head}\n\`\`\`` },
            ...(member.s ? [{ value: member.s }] : []),
            ...(member.d ? [{ value: "_Deprecated._" }] : []),
          ],
        };
      }

      // A child or a variable that leads to an instance in the place: show where it is.
      const expr = chain ? `${chain[1]}${chain[2]}${word.word}` : word.word;
      const target = resolveExpression(expr, ctx.code, ctx.tree, api);
      if (target?.kind !== "instance") return null;
      const path: string[] = [];
      for (let id = target.id; id && id !== ctx.tree.rootId; id = ctx.nodes.get(id)?.parent) {
        path.unshift(ctx.nodes.get(id)?.name ?? "?");
      }
      const summary = api.classes[target.className]?.s;
      return {
        range,
        contents: [
          {
            value: `\`\`\`luau\n${path.length ? `game.${path.join(".")}` : expr}: ${target.className}\n\`\`\``,
          },
          ...(summary ? [{ value: summary }] : []),
        ],
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

      // The innermost unclosed `(` on this line, and how many commas follow it.
      const line = ctx.line;
      let depth = 0;
      let open = -1;
      let commas = 0;
      for (let i = line.length - 1; i >= 0; i--) {
        const ch = line[i];
        if (ch === ")") depth++;
        else if (ch === "(") {
          if (depth === 0) {
            open = i;
            break;
          }
          depth--;
        } else if (ch === "," && depth === 0) commas++;
      }
      if (open < 0) return null;

      const before = line.slice(0, open);
      const chain = before.match(CHAIN_BEFORE);
      let member: ApiMember | undefined;
      let owner = "";
      let sep = "";
      let note: string | undefined;

      if (chain) {
        const [, expr, s, name] = chain;
        sep = s;
        const target = resolveExpression(expr, ctx.code, ctx.tree, api);
        if (target) {
          ({ owner } = membersOf(api, target));
          member = membersOf(api, target).members.find((m) => m.n === name);
          // Connect/Once on an event: say what the callback receives.
          if (
            target.kind === "value" &&
            target.event &&
            /^(Connect|Once|ConnectParallel)$/.test(name)
          ) {
            note = `The function receives: ${target.event.n}${signature({ ...target.event, t: undefined })}`;
          }
        }
      } else {
        const fn = before.match(/([A-Za-z_]\w*)\s*$/)?.[1];
        member = api.globals.find((g) => g.n === fn && g.k === "f");
      }
      if (!member?.p) return null;

      const params = member.p.map(([n, t, d]) =>
        d !== undefined ? `${n}: ${t} = ${d}` : `${n}: ${t}`,
      );
      const label = `${owner}${owner ? sep : ""}${member.n}(${params.join(", ")})${member.t ? `: ${member.t}` : ""}`;
      return {
        value: {
          signatures: [
            {
              label,
              documentation: { value: [member.s, note].filter(Boolean).join("\n\n") },
              parameters: params.map((p) => ({ label: p })),
            },
          ],
          activeSignature: 0,
          activeParameter: Math.min(commas, Math.max(0, params.length - 1)),
        },
        dispose() {},
      };
    },
  });
}
