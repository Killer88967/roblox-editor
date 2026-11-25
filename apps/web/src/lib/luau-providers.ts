import type { Monaco } from "@monaco-editor/react";
import {
  chainBefore,
  lookup,
  positionOf,
  tokenAt,
  visibleAt,
  type Analysis,
  type Decl,
} from "./luau-analyze";
import { REPLACEMENTS } from "./luau-diagnostics";
import { analysisOf, rangeOf, treeFor, type Model, type Position, type Range } from "./luau-model";
import { resolveExpression } from "./luau-resolve";
import { loadApi, serviceNames } from "./roblox-api";

const IDENT_ONLY = /^[A-Za-z_]\w*$/;

/** The name token at (or just before) an offset. */
function nameAt(an: Analysis, offset: number) {
  for (const o of [offset, offset - 1]) {
    const k = tokenAt(an, o);
    if (k >= 0 && an.toks[k].k === "name") return k;
  }
  return -1;
}

/** The variable a name token declares or refers to (not `.field` accesses). */
function declOf(an: Analysis, k: number): Decl | undefined {
  const t = an.toks[k];
  const prev = an.toks[k - 1];
  if (prev?.k === "op" && (prev.v === "." || prev.v === ":")) return undefined;
  return an.decls.find((d) => d.s === t.s && d.name === t.v) ?? lookup(an, t.v, t.s);
}

/** Every place a variable appears: its declaration and its uses. */
function occurrences(an: Analysis, decl: Decl) {
  const out: { s: number; e: number; write: boolean }[] = [];
  if (decl.e > decl.s) out.push({ s: decl.s, e: decl.e, write: true });
  for (const r of an.refs) {
    const t = an.toks[r];
    if (t.v !== decl.name || lookup(an, t.v, t.s)?.id !== decl.id) continue;
    const next = an.toks[r + 1];
    out.push({ s: t.s, e: t.e, write: next?.k === "op" && next.v === "=" });
  }
  return out;
}

/** Where `local X = game:GetService("X")` lines go: after the last one near the top. */
export function serviceInsertLine(an: Analysis) {
  let line = 1;
  for (const d of an.decls) {
    if (d.kind !== "local" || d.to !== Infinity) continue;
    if (d.src?.k === "rhs" && /GetService\s*\(/.test(d.src.text)) {
      line = Math.max(line, positionOf(an, d.s).lineNumber + 1);
    }
  }
  return line;
}

function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

const COLOR_RE =
  /Color3\s*\.\s*(fromRGB|new|fromHex)\s*\(\s*(?:(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)|["']#?([0-9a-fA-F]{6})["'])\s*\)/g;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, places: number) => Number(n.toFixed(places));

let registered = false;

/**
 * The rest of the script editor's language features: go to definition, find references,
 * rename, highlight occurrences, outline, folding, format document/selection, inline color
 * swatches with a picker for Color3 values, and quick fixes for diagnostics.
 */
export function registerProviders(monaco: Monaco) {
  if (registered) return;
  registered = true;
  const L = monaco.languages;

  L.registerDefinitionProvider("luau", {
    async provideDefinition(model: Model, position: Position) {
      const an = analysisOf(model);
      const k = nameAt(an, model.getOffsetAt(position));
      if (k < 0) return null;
      const prev = an.toks[k - 1];
      // `M.field`: jump to where the field is defined in this script.
      if (prev?.k === "op" && (prev.v === "." || prev.v === ":")) {
        const tree = treeFor(model);
        const chain = chainBefore(an, k - 1);
        if (!tree || !chain) return null;
        const target = resolveExpression(chain.expr, chain.at, an, tree, await loadApi());
        if (target?.kind !== "table" || target.an !== an) return null;
        const f = target.fields.find((x) => x.name === an.toks[k].v);
        return f ? { uri: model.uri, range: rangeOf(model, f.s, f.e) } : null;
      }
      const d = declOf(an, k);
      return d && d.e > d.s ? { uri: model.uri, range: rangeOf(model, d.s, d.e) } : null;
    },
  });

  L.registerReferenceProvider("luau", {
    provideReferences(model: Model, position: Position) {
      const an = analysisOf(model);
      const k = nameAt(an, model.getOffsetAt(position));
      const d = k >= 0 ? declOf(an, k) : undefined;
      if (!d) return [];
      return occurrences(an, d).map((o) => ({ uri: model.uri, range: rangeOf(model, o.s, o.e) }));
    },
  });

  L.registerDocumentHighlightProvider("luau", {
    provideDocumentHighlights(model: Model, position: Position) {
      const an = analysisOf(model);
      const k = nameAt(an, model.getOffsetAt(position));
      if (k < 0) return [];
      const d = declOf(an, k);
      const H = L.DocumentHighlightKind;
      if (d) {
        return occurrences(an, d).map((o) => ({
          range: rangeOf(model, o.s, o.e),
          kind: o.write ? H.Write : H.Read,
        }));
      }
      // Properties and other names: every token with the same text.
      const name = an.toks[k].v;
      return an.toks
        .filter((t) => t.k === "name" && t.v === name)
        .map((t) => ({ range: rangeOf(model, t.s, t.e), kind: H.Text }));
    },
  });

  L.registerRenameProvider("luau", {
    resolveRenameLocation(model: Model, position: Position) {
      const an = analysisOf(model);
      const k = nameAt(an, model.getOffsetAt(position));
      const d = k >= 0 ? declOf(an, k) : undefined;
      if (!d)
        return {
          rejectReason: "Only variables and functions defined in this script can be renamed.",
        };
      const t = an.toks[k];
      return { range: rangeOf(model, t.s, t.e), text: t.v };
    },
    provideRenameEdits(model: Model, position: Position, newName: string) {
      if (!IDENT_ONLY.test(newName))
        return { rejectReason: `'${newName}' is not a valid name.`, edits: [] };
      const an = analysisOf(model);
      const k = nameAt(an, model.getOffsetAt(position));
      const d = k >= 0 ? declOf(an, k) : undefined;
      if (!d) return { rejectReason: "Nothing to rename here.", edits: [] };
      return {
        edits: occurrences(an, d).map((o) => ({
          resource: model.uri,
          versionId: undefined,
          textEdit: { range: rangeOf(model, o.s, o.e), text: newName },
        })),
      };
    },
  });

  L.registerDocumentSymbolProvider("luau", {
    displayName: "Luau",
    provideDocumentSymbols(model: Model) {
      const an = analysisOf(model);
      const S = L.SymbolKind;
      const symbol = (name: string, detail: string, kind: number, s: number, e: number) => {
        const range = rangeOf(model, s, e);
        return { name, detail, kind, range, selectionRange: range, tags: [] };
      };
      const out = [];
      for (const d of an.decls) {
        if (d.kind === "function") {
          out.push(
            symbol(
              d.name,
              `(${(d.params ?? []).map((p) => p.name).join(", ")})`,
              S.Function,
              d.s,
              d.e,
            ),
          );
        } else if ((d.kind === "local" || d.kind === "global") && d.to === Infinity && d.e > d.s) {
          out.push(symbol(d.name, d.kind, d.params ? S.Function : S.Variable, d.s, d.e));
        }
      }
      for (const [table, fields] of an.fields) {
        if (!an.byName.has(table)) continue;
        for (const f of fields) {
          if (!f.params && !f.method) continue;
          out.push(symbol(`${table}${f.method ? ":" : "."}${f.name}`, "", S.Method, f.s, f.e));
        }
      }
      return out.sort((a, b) => a.range.startLineNumber - b.range.startLineNumber);
    },
  });

  L.registerFoldingRangeProvider("luau", {
    provideFoldingRanges(model: Model) {
      const an = analysisOf(model);
      return an.folds.map((f) => ({
        start: f.start,
        end: f.end,
        kind:
          f.kind === "comment"
            ? L.FoldingRangeKind.Comment
            : f.kind === "region"
              ? L.FoldingRangeKind.Region
              : undefined,
      }));
    },
  });

  /** Re-indents lines `from`..`to` to match their block depth. */
  const indentEdits = (
    model: Model,
    options: { tabSize: number; insertSpaces: boolean },
    from: number,
    to: number,
  ) => {
    const an = analysisOf(model);
    const unit = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
    const edits: { range: Range; text: string }[] = [];
    for (let l = from; l <= to; l++) {
      const level = an.indents[l];
      if (level === null || level === undefined) continue;
      const text = model.getLineContent(l);
      const leading = text.match(/^[ \t]*/)?.[0] ?? "";
      const want = text.trim() ? unit.repeat(level) : "";
      if (leading !== want) {
        edits.push({
          range: {
            startLineNumber: l,
            startColumn: 1,
            endLineNumber: l,
            endColumn: leading.length + 1,
          },
          text: want,
        });
      }
    }
    return edits;
  };

  L.registerDocumentFormattingEditProvider("luau", {
    displayName: "Luau indentation",
    provideDocumentFormattingEdits(
      model: Model,
      options: { tabSize: number; insertSpaces: boolean },
    ) {
      return indentEdits(model, options, 1, model.getLineCount());
    },
  });
  L.registerDocumentRangeFormattingEditProvider("luau", {
    displayName: "Luau indentation",
    provideDocumentRangeFormattingEdits(
      model: Model,
      range: Range,
      options: { tabSize: number; insertSpaces: boolean },
    ) {
      return indentEdits(model, options, range.startLineNumber, range.endLineNumber);
    },
  });

  L.registerColorProvider("luau", {
    provideDocumentColors(model: Model) {
      const an = analysisOf(model);
      const out = [];
      for (const m of an.masked.matchAll(COLOR_RE)) {
        const [, fn, a, b, c, hexColor] = m;
        let rgb: number[] | null = null;
        if (fn === "fromHex" && hexColor) {
          rgb = [0, 2, 4].map((i) => parseInt(hexColor.slice(i, i + 2), 16) / 255);
        } else if (a !== undefined) {
          const nums = [a, b, c].map(Number);
          rgb = fn === "fromRGB" ? nums.map((n) => n / 255) : nums;
        }
        if (!rgb || rgb.some((n) => Number.isNaN(n))) continue;
        const [red, green, blue] = rgb.map(clamp01);
        out.push({
          color: { red, green, blue, alpha: 1 },
          range: rangeOf(model, m.index, m.index + m[0].length),
        });
      }
      return out;
    },
    provideColorPresentations(
      model: Model,
      info: { color: { red: number; green: number; blue: number }; range: Range },
    ) {
      const { red, green, blue } = info.color;
      const current = model.getValueInRange(info.range);
      const fn = current.match(/Color3\s*\.\s*(\w+)/)?.[1] ?? "fromRGB";
      const to255 = (n: number) => Math.round(clamp01(n) * 255);
      const text =
        fn === "new"
          ? `Color3.new(${round(red, 3)}, ${round(green, 3)}, ${round(blue, 3)})`
          : fn === "fromHex"
            ? `Color3.fromHex("#${[red, green, blue].map((n) => to255(n).toString(16).padStart(2, "0")).join("")}")`
            : `Color3.fromRGB(${to255(red)}, ${to255(green)}, ${to255(blue)})`;
      return [{ label: text, textEdit: { range: info.range, text } }];
    },
  });

  L.registerCodeActionProvider("luau", {
    async provideCodeActions(
      model: Model,
      _range: Range,
      context: {
        markers: {
          code?: string | { value: string };
          message: string;
          startLineNumber: number;
          startColumn: number;
          endLineNumber: number;
          endColumn: number;
        }[];
      },
    ) {
      const an = analysisOf(model);
      const api = await loadApi();
      const actions: object[] = [];
      const edit = (range: Range, text: string) => ({
        edits: [{ resource: model.uri, versionId: undefined, textEdit: { range, text } }],
      });
      for (const marker of context.markers) {
        const raw = typeof marker.code === "object" ? marker.code.value : marker.code;
        const [code, name] = (raw ?? "").split(":");
        if (!code || !name) continue;
        const range: Range = {
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn,
        };
        const fix = (title: string, r: Range, text: string, preferred = false) =>
          actions.push({
            title,
            kind: "quickfix",
            diagnostics: [marker],
            edit: edit(r, text),
            isPreferred: preferred,
          });

        if (code === "unused") fix(`Rename to '_${name}'`, range, `_${name}`, true);

        if (code === "deprecated" && REPLACEMENTS[name]) {
          fix(`Use '${REPLACEMENTS[name]}'`, range, REPLACEMENTS[name], true);
        }
        const better = marker.message.match(/use '(\w+)' instead/)?.[1];
        if (code === "deprecated" && better && !REPLACEMENTS[name])
          fix(`Use '${better}'`, range, better, true);

        if (code === "unknown-global") {
          if (serviceNames(api).includes(name)) {
            const line = serviceInsertLine(an);
            fix(
              `Add local ${name} = game:GetService("${name}")`,
              { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
              `local ${name} = game:GetService("${name}")\n`,
              true,
            );
          }
          // Typos: suggest close names.
          const offset = model.getOffsetAt({
            lineNumber: range.startLineNumber,
            column: range.startColumn,
          });
          const candidates = new Set<string>([
            ...visibleAt(an, offset).map((d) => d.name),
            ...api.globals.filter((g) => !g.d).map((g) => g.n),
            ...Object.keys(api.libraries),
            ...Object.keys(api.datatypes),
          ]);
          const close = [...candidates]
            .map((c) => [c, editDistance(name.toLowerCase(), c.toLowerCase())] as const)
            .filter(([c, d]) => d <= (name.length > 4 ? 2 : 1) && c !== name)
            .sort((a, b) => a[1] - b[1])
            .slice(0, 3);
          for (const [c] of close) fix(`Change to '${c}'`, range, c);
        }
        if (code === "member") {
          // A misspelled member: offer close names from the same type.
          const near = marker.message.match(/is not a valid member of (\w+)/)?.[1];
          if (near && api.classes[near]) {
            const names = new Set<string>();
            for (let c: string | undefined = near; c; c = api.classes[c]?.super) {
              for (const m of api.classes[c]?.members ?? []) if (!m.d) names.add(m.n);
            }
            const close = [...names]
              .map((c) => [c, editDistance(name.toLowerCase(), c.toLowerCase())] as const)
              .filter(([, d]) => d <= 2)
              .sort((a, b) => a[1] - b[1])
              .slice(0, 3);
            for (const [c] of close) fix(`Change to '${c}'`, range, c, close[0][0] === c);
          }
        }
      }
      return { actions, dispose() {} };
    },
  });
}
