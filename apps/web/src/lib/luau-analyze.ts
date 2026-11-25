/**
 * A small, forgiving Luau analyzer for the script editor: a tokenizer, block matching
 * (syntax errors, folding, indentation), and an index of declarations (locals, parameters,
 * loop variables, globals, table fields) with their scopes. Nothing here depends on Monaco.
 */

export type TokKind = "name" | "kw" | "num" | "str" | "op";
/** A token: kind, text, start/end offsets and 1-based line. */
export type Tok = { k: TokKind; v: string; s: number; e: number; line: number };

export type Severity = "error" | "warning" | "info" | "hint";
export type Problem = {
  s: number;
  e: number;
  message: string;
  severity: Severity;
  tag?: "unnecessary" | "deprecated";
  /** Machine-readable kind, for quick fixes. */
  code?: "unknown-global" | "unused" | "syntax" | "member" | "deprecated";
  /** The name a quick fix should act on. */
  name?: string;
};

export type Fold = { start: number; end: number; kind?: "comment" | "region" };

export type Param = { name: string; type?: string; s: number; e: number };

/** Where a variable's value comes from, for working out its type. */
export type Source =
  | { k: "rhs"; text: string; at: number }
  | { k: "type"; text: string }
  | { k: "connect"; expr: string; index: number; at: number }
  | { k: "iter"; expr: string; index: number; at: number }
  | { k: "number" }
  | { k: "self"; table: string; at: number };

export type Decl = {
  id: number;
  name: string;
  kind: "local" | "global" | "param" | "function" | "for";
  /** `local function` / `function name()`: the parameters. */
  params?: Param[];
  /** Declared with `local`. */
  isLocal: boolean;
  /** The name token's range. */
  s: number;
  e: number;
  /** Visible from this offset to `to` (inclusive). */
  from: number;
  to: number;
  src?: Source;
};

/** A field of a table: `M.foo = …`, `function M.bar()`, `function M:baz()`, `{ qux = … }`. */
export type Field = {
  name: string;
  method: boolean;
  params?: Param[];
  s: number;
  e: number;
  rhs?: { text: string; at: number };
};

type Assign = { name: string; from: number; src: Source };

export type Analysis = {
  code: string;
  /** The code with comments blanked out (offsets unchanged). */
  masked: string;
  toks: Tok[];
  lineStarts: number[];
  /** Opener <-> closer token indexes (brackets and blocks), -1 if none. */
  match: Int32Array;
  /** For each token, the index of the innermost open bracket/block around it, -1 at top level. */
  top: Int32Array;
  /** `if` tokens that start an if-expression (`x = if a then b else c`). */
  exprIf: Uint8Array;
  /** Openers still unclosed at the end of the file. */
  unclosed: number[];
  problems: Problem[];
  folds: Fold[];
  /** Per line: indent level (null = leave alone, e.g. inside a multi-line string). */
  indents: (number | null)[];
  decls: Decl[];
  assigns: Assign[];
  fields: Map<string, Field[]>;
  /** Identifier uses (token indexes), excluding declarations. */
  refs: number[];
  /** Type names declared with `type X = …`. */
  typeNames: Set<string>;
  /** What the module returns: a table's fields, or null. */
  exports: Field[] | null;
  byName: Map<string, Decl[]>;
};

const KEYWORDS = new Set([
  "and",
  "break",
  "do",
  "else",
  "elseif",
  "end",
  "false",
  "for",
  "function",
  "if",
  "in",
  "local",
  "nil",
  "not",
  "or",
  "repeat",
  "return",
  "then",
  "true",
  "until",
  "while",
]);

const OPS = [
  "...",
  "..=",
  "//=",
  "==",
  "~=",
  "<=",
  ">=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "^=",
  "..",
  "//",
  "::",
  "->",
];
const SINGLE_OPS = new Set("+-*/%^#&|~<>=(){}[];:,.?");

const OPENERS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const NUMBER =
  /0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/y;
const NAME = /[A-Za-z_]\w*/y;
const LONG_OPEN = /\[(=*)\[/y;

// ---------------------------------------------------------------------------------------
// Tokenizer

function tokenize(code: string) {
  const toks: Tok[] = [];
  const problems: Problem[] = [];
  const folds: Fold[] = [];
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
  /** Lines that are inside a multi-line string or comment (not their first line). */
  const interior = new Set<number>();
  /** Comment ranges to blank out. */
  const comments: [number, number][] = [];
  const regions: number[] = [];

  let li = 0;
  const lineOf = (offset: number) => {
    while (li + 1 < lineStarts.length && lineStarts[li + 1] <= offset) li++;
    return li + 1;
  };
  const lineAt = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const markInterior = (s: number, e: number) => {
    const a = lineAt(s);
    const b = lineAt(e);
    for (let l = a + 1; l <= b; l++) interior.add(l);
    return [a, b] as const;
  };

  /** Finds the end of a long bracket `]==]` starting the search at `from`. */
  const longEnd = (from: number, eq: string) => {
    const close = `]${eq}]`;
    const at = code.indexOf(close, from);
    return at < 0 ? -1 : at + close.length;
  };

  const malformed = (s: number, e: number) =>
    problems.push({
      s,
      e,
      message: "Malformed string; did you forget to finish it?",
      severity: "error",
      code: "syntax",
    });

  /** Brace depth inside each open `{expression}` of an interpolated string. */
  const interp: number[] = [];
  /**
   * Scans an interpolated string's text from `from` (just after the opening backtick or an
   * expression's `}`), up to the closing backtick or the next `{`. Returns where to go next.
   */
  const interpolated = (start: number, from: number) => {
    let j = from;
    while (j < n) {
      const d = code[j];
      if (d === "\\") {
        j += 2;
        continue;
      }
      if (d === "`") {
        toks.push({
          k: "str",
          v: code.slice(start, j + 1),
          s: start,
          e: j + 1,
          line: lineOf(start),
        });
        return j + 1;
      }
      if (d === "{") {
        toks.push({
          k: "str",
          v: code.slice(start, j + 1),
          s: start,
          e: j + 1,
          line: lineOf(start),
        });
        interp.push(0);
        return j + 1;
      }
      if (d === "\n") break;
      j++;
    }
    malformed(start, j);
    toks.push({ k: "str", v: code.slice(start, j), s: start, e: j, line: lineOf(start) });
    return j;
  };

  const n = code.length;
  let i = 0;
  while (i < n) {
    const c = code[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }

    // Comments.
    if (c === "-" && code[i + 1] === "-") {
      LONG_OPEN.lastIndex = i + 2;
      const long = LONG_OPEN.exec(code);
      if (long) {
        let end = longEnd(LONG_OPEN.lastIndex, long[1]);
        if (end < 0) {
          problems.push({
            s: i,
            e: i + 4,
            message: "Unfinished long comment",
            severity: "error",
            code: "syntax",
          });
          end = n;
        }
        comments.push([i, end]);
        const [a, b] = markInterior(i, end);
        if (b > a) folds.push({ start: a, end: b, kind: "comment" });
        i = end;
      } else {
        let end = code.indexOf("\n", i);
        if (end < 0) end = n;
        const text = code.slice(i + 2, end).trim();
        if (/^#region\b/.test(text)) regions.push(lineAt(i));
        else if (/^#endregion\b/.test(text)) {
          const start = regions.pop();
          if (start !== undefined) folds.push({ start, end: lineAt(i), kind: "region" });
        }
        comments.push([i, end]);
        i = end;
      }
      continue;
    }

    // Long strings.
    if (c === "[") {
      LONG_OPEN.lastIndex = i;
      const long = LONG_OPEN.exec(code);
      if (long) {
        let end = longEnd(LONG_OPEN.lastIndex, long[1]);
        if (end < 0) {
          problems.push({
            s: i,
            e: LONG_OPEN.lastIndex,
            message: "Unfinished long string",
            severity: "error",
            code: "syntax",
          });
          end = n;
        }
        toks.push({ k: "str", v: code.slice(i, end), s: i, e: end, line: lineOf(i) });
        markInterior(i, end);
        i = end;
        continue;
      }
    }

    // Quoted strings.
    if (c === '"' || c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = code[j];
        if (d === "\\") {
          // `\z` skips the following whitespace, including newlines.
          if (code[j + 1] === "z") {
            j += 2;
            while (j < n && /\s/.test(code[j])) j++;
            continue;
          }
          j += 2;
          continue;
        }
        if (d === c) {
          closed = true;
          j++;
          break;
        }
        if (d === "\n") break;
        j++;
      }
      if (!closed) malformed(i, j);
      toks.push({ k: "str", v: code.slice(i, j), s: i, e: j, line: lineOf(i) });
      markInterior(i, j);
      i = j;
      continue;
    }

    // `Interpolated {strings}`: the text parts are strings, the {expressions} are code.
    if (c === "`") {
      i = interpolated(i, i + 1);
      continue;
    }
    if (c === "}" && interp.length && interp[interp.length - 1] === 0) {
      interp.pop();
      i = interpolated(i, i + 1);
      continue;
    }
    if (interp.length && (c === "{" || c === "}")) interp[interp.length - 1] += c === "{" ? 1 : -1;

    NUMBER.lastIndex = i;
    const num = /[\d.]/.test(c) ? NUMBER.exec(code) : null;
    if (num && num[0] !== ".") {
      toks.push({ k: "num", v: num[0], s: i, e: i + num[0].length, line: lineOf(i) });
      i += num[0].length;
      continue;
    }

    NAME.lastIndex = i;
    const name = NAME.exec(code);
    if (name) {
      const v = name[0];
      toks.push({ k: KEYWORDS.has(v) ? "kw" : "name", v, s: i, e: i + v.length, line: lineOf(i) });
      i += v.length;
      continue;
    }

    const op = OPS.find((o) => code.startsWith(o, i)) ?? (SINGLE_OPS.has(c) ? c : null);
    if (op) {
      toks.push({ k: "op", v: op, s: i, e: i + op.length, line: lineOf(i) });
      i += op.length;
      continue;
    }
    // Anything else (e.g. `@native` attributes, stray characters) is skipped.
    i++;
  }

  // Blank out comments so text slices of expressions are clean.
  let masked = code;
  if (comments.length) {
    const parts: string[] = [];
    let last = 0;
    for (const [s, e] of comments) {
      parts.push(code.slice(last, s), code.slice(s, e).replace(/[^\n]/g, " "));
      last = e;
    }
    parts.push(code.slice(last));
    masked = parts.join("");
  }

  return { toks, problems, folds, lineStarts, interior, masked };
}

// ---------------------------------------------------------------------------------------
// Blocks

type Open = { i: number; kind: string; needDo?: boolean };

/** Tokens that, at the start of a line, continue the previous line's expression. */
const CONTINUE_WITH = new Set([
  ".",
  ":",
  "..",
  "+",
  "-",
  "*",
  "/",
  "//",
  "%",
  "^",
  "==",
  "~=",
  "<",
  ">",
  "<=",
  ">=",
  "::",
  "and",
  "or",
]);

/** Operators that must be followed by an expression. */
const NEEDS_OPERAND = new Set([
  "=",
  "==",
  "~=",
  "<",
  ">",
  "<=",
  ">=",
  "+",
  "*",
  "/",
  "//",
  "%",
  "^",
  "..",
  "+=",
  "-=",
  "*=",
  "/=",
  "//=",
  "%=",
  "^=",
  "..=",
]);

const BLOCKS = new Set(["function", "if", "for", "while", "do", "repeat"]);
const EXPR_BEFORE = new Set([
  "=",
  "==",
  "~=",
  "<",
  ">",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "//",
  "%",
  "^",
  "..",
  "#",
  ",",
  "(",
  "[",
  "{",
  "+=",
  "-=",
  "*=",
  "/=",
  "//=",
  "%=",
  "^=",
  "..=",
  "return",
  "and",
  "or",
  "not",
  "in",
  "until",
]);

const expectedFor = (o: Open) =>
  o.kind in OPENERS
    ? `'${OPENERS[o.kind]}'`
    : o.kind === "repeat"
      ? "'until'"
      : o.needDo
        ? "'do'"
        : "'end'";

function blocks(toks: Tok[], lineCount: number, interior: Set<number>) {
  const N = toks.length;
  const match = new Int32Array(N).fill(-1);
  const top = new Int32Array(N).fill(-1);
  const exprIf = new Uint8Array(N);
  const problems: Problem[] = [];
  const folds: Fold[] = [];
  const stack: Open[] = [];
  const lineDepth: (number | null)[] = new Array(lineCount + 1).fill(null);
  const firstTok: number[] = new Array(lineCount + 1).fill(-1);
  let elseEndedExpr = false;
  /** Lines that continue the previous line's expression (`:Method()` chains, operators). */
  const continued = new Set<number>();

  const problem = (t: Tok, message: string) =>
    problems.push({ s: t.s, e: t.e, message, severity: "error", code: "syntax" });

  const pair = (o: number, c: number) => {
    match[o] = c;
    match[c] = o;
    const a = toks[o].line;
    const b = toks[c].line;
    if (b - 1 > a) folds.push({ start: a, end: b - 1 });
  };

  /** Closes the nearest opener that `accepts`, reporting what was left open on the way. */
  const close = (i: number, accepts: (o: Open) => boolean) => {
    const t = toks[i];
    let k = stack.length - 1;
    while (k >= 0 && !accepts(stack[k])) k--;
    // The if-expressions on top don't need closing.
    while (stack.length && stack[stack.length - 1].kind === "ifexpr" && stack.length - 1 > k) {
      stack.pop();
    }
    if (k < 0) {
      const o = stack[stack.length - 1];
      problem(
        t,
        o
          ? `Expected ${expectedFor(o)} (to close '${toks[o.i].v}' at line ${toks[o.i].line}), got '${t.v}'`
          : `Expected <eof>, got '${t.v}'`,
      );
      return;
    }
    if (k < stack.length - 1) {
      const o = stack[stack.length - 1];
      problem(
        t,
        `Expected ${expectedFor(o)} (to close '${toks[o.i].v}' at line ${toks[o.i].line}), got '${t.v}'`,
      );
    }
    const opener = stack[k];
    stack.length = k;
    pair(opener.i, i);
  };

  const distinctLines = () => {
    let count = 0;
    let last = -1;
    for (const o of stack) {
      if (o.kind === "ifexpr") continue;
      const l = toks[o.i].line;
      if (l !== last) {
        count++;
        last = l;
      }
    }
    return count;
  };

  let lastLine = 0;
  for (let i = 0; i < N; i++) {
    const t = toks[i];
    if (t.line !== lastLine) {
      const p = toks[i - 1];
      if (
        p &&
        ((t.k === "op" && CONTINUE_WITH.has(t.v)) ||
          (t.k === "kw" && (t.v === "and" || t.v === "or")) ||
          (p.k === "op" && !(p.v in CLOSERS) && !(p.v in OPENERS) && p.v !== "," && p.v !== ";") ||
          (p.k === "kw" && /^(and|or|not)$/.test(p.v)))
      ) {
        continued.add(t.line);
      }
      const d = distinctLines();
      for (let l = lastLine + 1; l <= t.line; l++) lineDepth[l] = d;
      lastLine = t.line;
      firstTok[t.line] = i;
    }
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].kind !== "ifexpr") {
        top[i] = stack[k].i;
        break;
      }
    }

    if (t.k === "op") {
      // An operator or `=` with nothing after it: `return x +` then `end`.
      if (NEEDS_OPERAND.has(t.v)) {
        const next = toks[i + 1];
        if (
          !next ||
          (next.k === "kw" && /^(end|then|do|else|elseif|until)$/.test(next.v)) ||
          (next.k === "op" && (next.v in CLOSERS || next.v === "," || next.v === ";"))
        ) {
          problem(
            next ?? t,
            `Expected identifier when parsing expression, got ${next ? `'${next.v}'` : "<eof>"}`,
          );
        }
      }
      if (t.v in OPENERS) stack.push({ i, kind: t.v });
      else if (t.v in CLOSERS) close(i, (o) => o.kind === CLOSERS[t.v]);
      continue;
    }
    if (t.k !== "kw") continue;

    const prev = toks[i - 1];
    const topKind = stack[stack.length - 1]?.kind;
    switch (t.v) {
      case "function":
        stack.push({ i, kind: "function" });
        break;
      case "if": {
        const isExpr =
          (prev && EXPR_BEFORE.has(prev.v) && prev.k !== "str" && prev.k !== "name") ||
          (prev?.v === "then" && topKind === "ifexpr") ||
          (prev?.v === "else" && elseEndedExpr);
        if (isExpr) {
          exprIf[i] = 1;
          stack.push({ i, kind: "ifexpr" });
        } else stack.push({ i, kind: "if" });
        break;
      }
      case "else":
        elseEndedExpr = false;
        if (topKind === "ifexpr") {
          stack.pop();
          elseEndedExpr = true;
        }
        break;
      case "for":
      case "while":
        stack.push({ i, kind: t.v, needDo: true });
        break;
      case "do": {
        const o = stack[stack.length - 1];
        if (o && (o.kind === "for" || o.kind === "while") && o.needDo) o.needDo = false;
        else stack.push({ i, kind: "do" });
        break;
      }
      case "repeat":
        stack.push({ i, kind: "repeat" });
        break;
      case "until":
        close(i, (o) => o.kind === "repeat");
        break;
      case "end":
        close(i, (o) => BLOCKS.has(o.kind) && o.kind !== "repeat");
        break;
    }
    if (t.v !== "else") elseEndedExpr = false;
  }

  const endDepth = distinctLines();
  for (let l = lastLine + 1; l <= lineCount; l++) lineDepth[l] = endDepth;

  const unclosed: number[] = [];
  for (const o of stack) {
    if (o.kind === "ifexpr") continue;
    unclosed.push(o.i);
    problem(
      toks[o.i],
      `Expected ${expectedFor(o)} (to close '${toks[o.i].v}' at line ${toks[o.i].line}), got <eof>`,
    );
  }

  // Indentation: one level per line that opened something still open; a line that starts
  // by closing something goes back one.
  const indents: (number | null)[] = new Array(lineCount + 1).fill(null);
  for (let l = 1; l <= lineCount; l++) {
    if (interior.has(l)) continue;
    const depth = lineDepth[l] ?? 0;
    const f = firstTok[l];
    const first = f >= 0 ? toks[f] : undefined;
    const closes =
      !!first &&
      ((first.k === "kw" && /^(end|until|else|elseif)$/.test(first.v)) ||
        (first.k === "op" && first.v in CLOSERS));
    indents[l] = Math.max(0, depth - (closes ? 1 : 0)) + (continued.has(l) ? 1 : 0);
  }

  return { match, top, exprIf, unclosed, problems, folds, indents };
}

// ---------------------------------------------------------------------------------------
// Declarations

const STOP_KW = new Set([
  "local",
  "return",
  "end",
  "until",
  "elseif",
  "else",
  "then",
  "do",
  "for",
  "while",
  "repeat",
  "break",
  "if",
]);
const CONTINUE_AFTER = new Set(["and", "or", "not", "function"]);

function index(code: string, masked: string, toks: Tok[], b: ReturnType<typeof blocks>) {
  const { match, top, exprIf } = b;
  const N = toks.length;
  const decls: Decl[] = [];
  const assigns: Assign[] = [];
  const fields = new Map<string, Field[]>();
  const refs: number[] = [];
  const typeNames = new Set<string>();
  const declTokens = new Set<number>();
  const connectByName = new Map<string, { expr: string; at: number }>();
  let id = 0;

  const text = (a: number, z: number) => masked.slice(toks[a].s, toks[z].e).trim();
  /** Index of the token starting at `offset` (binary search; tokens are in order). */
  const tokenIndexAt = (offset: number) => {
    let lo = 0;
    let hi = N - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (toks[mid].s === offset) return mid;
      if (toks[mid].s < offset) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  };
  const isOp = (i: number, v: string) => toks[i]?.k === "op" && toks[i].v === v;
  const isKw = (i: number, v: string) => toks[i]?.k === "kw" && toks[i].v === v;
  const scopeEnd = (i: number) => {
    // The innermost block (not bracket) around token i.
    for (let o = top[i]; o >= 0; o = top[o]) {
      if (toks[o].k === "kw") return match[o] >= 0 ? toks[match[o]].s : code.length;
    }
    return Infinity;
  };
  const addField = (table: string, f: Field) => {
    const list = fields.get(table) ?? [];
    const old = list.findIndex((x) => x.name === f.name);
    if (old >= 0) list[old] = f;
    else list.push(f);
    fields.set(table, list);
  };
  const addDecl = (d: Omit<Decl, "id">) => {
    const decl = { ...d, id: id++ };
    decls.push(decl);
    return decl;
  };

  /** Reads a type annotation starting at token j; returns the index after it. */
  const readType = (j: number) => {
    let k = j;
    let angle = 0;
    while (k < N) {
      const t = toks[k];
      if (k > j && t.line > toks[k - 1].line && angle === 0) {
        const p = toks[k - 1];
        if (!(p.k === "op" && /^(\||&|->|\?|<|,)$/.test(p.v))) break;
      }
      if (t.k === "op" && t.v in OPENERS) {
        if (match[k] < 0) return N;
        k = match[k] + 1;
        continue;
      }
      if (t.k === "op" && t.v === "<") angle++;
      else if (t.k === "op" && t.v === ">") {
        if (angle === 0) break;
        angle--;
      } else if (angle === 0) {
        if (t.k === "op" && /^(,|=|\)|\]|\}|;)$/.test(t.v)) break;
        if (t.k === "kw" && !/^(nil|true|false)$/.test(t.v)) break;
        if (k > j && t.k !== "op" && toks[k - 1].k !== "op") break;
      }
      k++;
    }
    return k;
  };

  /** Reads `a, b(c), d` up to the end of the statement. */
  const readExprList = (j: number) => {
    const items: { a: number; z: number }[] = [];
    let start = j;
    let k = j;
    let ifs = 0;
    while (k < N) {
      const t = toks[k];
      if (k > j) {
        const p = toks[k - 1];
        const continues =
          (p.k === "op" && !(p.v in CLOSERS)) ||
          (p.k === "kw" && CONTINUE_AFTER.has(p.v)) ||
          CONTINUE_WITH.has(t.v);
        if (t.line > p.line && !continues) break;
      }
      if (t.k === "op") {
        if (t.v === ",") {
          if (k > start) items.push({ a: start, z: k - 1 });
          start = k + 1;
          k++;
          continue;
        }
        if (t.v in OPENERS) {
          if (match[k] < 0) {
            k = N;
            break;
          }
          k = match[k] + 1;
          continue;
        }
        if (t.v in CLOSERS || t.v === ";" || t.v === "=") break;
      } else if (t.k === "kw") {
        if (t.v === "function") {
          if (match[k] < 0) {
            k = N;
            break;
          }
          k = match[k] + 1;
          continue;
        }
        if (t.v === "if" && exprIf[k]) ifs++;
        else if ((t.v === "then" || t.v === "elseif") && ifs > 0) {
          /* part of an if-expression */
        } else if (t.v === "else" && ifs > 0) ifs--;
        else if (STOP_KW.has(t.v)) break;
      }
      k++;
    }
    if (k > start) items.push({ a: start, z: Math.min(k, N) - 1 });
    return { items, end: k };
  };

  /** Parameters in the `(` … `)` at token p. */
  const readParams = (p: number): Param[] => {
    const out: Param[] = [];
    if (!isOp(p, "(") || match[p] < 0) return out;
    for (let k = p + 1; k < match[p]; k++) {
      const t = toks[k];
      if (top[k] !== p) continue;
      if (t.k === "name" || (t.k === "op" && t.v === "...")) {
        const param: Param = { name: t.v, s: t.s, e: t.e };
        if (isOp(k + 1, ":")) {
          const end = readType(k + 2);
          if (end > k + 2) param.type = text(k + 2, end - 1);
          k = end - 1;
        }
        out.push(param);
      }
    }
    return out;
  };

  /** The start of the chain ending just before token k (a `.` or `:`), or -1. */
  const chainStartBefore = (k: number) => chainStart(toks, match, k);

  /** Declares a function's parameters (for `function` at token f with `(` at p). */
  const declareParams = (
    f: number,
    p: number,
    params: Param[],
    extra?: { self?: string; connect?: { expr: string; at: number } },
  ) => {
    const from = match[p] >= 0 ? toks[match[p]].e : toks[p].e;
    const to = match[f] >= 0 ? toks[match[f]].s : code.length;
    if (extra?.self) {
      addDecl({
        name: "self",
        kind: "param",
        isLocal: true,
        s: toks[f].s,
        e: toks[f].s,
        from,
        to,
        src: { k: "self", table: extra.self, at: toks[f].s },
      });
    }
    params.forEach((param, index) => {
      if (param.name === "...") return;
      const d = addDecl({
        name: param.name,
        kind: "param",
        isLocal: true,
        s: param.s,
        e: param.e,
        from,
        to,
        src: param.type
          ? { k: "type", text: param.type }
          : extra?.connect
            ? { k: "connect", expr: extra.connect.expr, index, at: extra.connect.at }
            : undefined,
      });
      declTokens.add(tokenIndexAt(d.s));
    });
  };

  /** Fields in a table constructor `{ a = 1, b = function() end }` at token o. */
  const constructorFields = (o: number): Field[] => {
    const out: Field[] = [];
    if (!isOp(o, "{") || match[o] < 0) return out;
    for (let k = o + 1; k < match[o]; k++) {
      if (top[k] !== o || toks[k].k !== "name" || !isOp(k + 1, "=")) continue;
      if (!(isOp(k - 1, "{") || isOp(k - 1, ",") || isOp(k - 1, ";"))) continue;
      const { items } = readExprList(k + 2);
      const value = items[0];
      const f: Field = { name: toks[k].v, method: false, s: toks[k].s, e: toks[k].e };
      if (value) {
        f.rhs = { text: text(value.a, value.z), at: toks[k].s };
        if (isKw(value.a, "function")) f.params = readParams(value.a + 1);
      }
      out.push(f);
    }
    return out;
  };

  const visibleLocal = (name: string, at: number) =>
    decls.some((d) => d.name === name && d.isLocal && d.from <= at && at <= d.to);

  for (let i = 0; i < N; i++) {
    const t = toks[i];

    // `type X = …` and `export type X = …`
    if (
      t.k === "name" &&
      t.v === "type" &&
      toks[i + 1]?.k === "name" &&
      (i === 0 || toks[i - 1].line < t.line || toks[i - 1].v === "export" || isOp(i - 1, ";"))
    ) {
      typeNames.add(toks[i + 1].v);
      declTokens.add(i + 1);
      continue;
    }

    if (isKw(i, "local")) {
      if (isKw(i + 1, "function") && toks[i + 2]?.k === "name") {
        const nameTok = toks[i + 2];
        const params = readParams(i + 3);
        declTokens.add(i + 2);
        addDecl({
          name: nameTok.v,
          kind: "function",
          isLocal: true,
          params,
          s: nameTok.s,
          e: nameTok.e,
          from: nameTok.s,
          to: scopeEnd(i),
        });
        declareParams(i + 1, i + 3, params);
        i += 2;
        continue;
      }
      // local a: T, b = x, y
      const names: { k: number; type?: string }[] = [];
      let k = i + 1;
      while (toks[k]?.k === "name") {
        const entry: { k: number; type?: string } = { k };
        k++;
        if (isOp(k, ":")) {
          const end = readType(k + 1);
          if (end > k + 1) entry.type = text(k + 1, end - 1);
          k = end;
        }
        names.push(entry);
        if (isOp(k, ",")) k++;
        else break;
      }
      let values: { a: number; z: number }[] = [];
      let end = k;
      if (isOp(k, "=")) {
        const list = readExprList(k + 1);
        values = list.items;
        end = list.end;
      }
      const from = toks[Math.max(i, end - 1)]?.e ?? code.length;
      const to = scopeEnd(i);
      names.forEach((n, idx) => {
        const nameTok = toks[n.k];
        const v = values[idx];
        declTokens.add(n.k);
        const d = addDecl({
          name: nameTok.v,
          kind: "local",
          isLocal: true,
          s: nameTok.s,
          e: nameTok.e,
          from,
          to,
          src: n.type
            ? { k: "type", text: n.type }
            : v
              ? { k: "rhs", text: text(v.a, v.z), at: t.s }
              : undefined,
        });
        if (v && isKw(v.a, "function")) d.params = readParams(v.a + 1);
        if (v && isOp(v.a, "{") && match[v.a] === v.z) {
          for (const f of constructorFields(v.a)) addField(nameTok.v, f);
        }
      });
      i = k - 1;
      continue;
    }

    if (isKw(i, "function")) {
      // function a.b:c(…)
      if (toks[i + 1]?.k === "name") {
        const parts = [i + 1];
        let k = i + 2;
        let method = false;
        while ((isOp(k, ".") || isOp(k, ":")) && toks[k + 1]?.k === "name") {
          if (isOp(k, ":")) method = true;
          parts.push(k + 1);
          k += 2;
        }
        const params = readParams(k);
        const nameTok = toks[parts[parts.length - 1]];
        if (parts.length === 1) {
          declTokens.add(i + 1);
          if (!visibleLocal(nameTok.v, nameTok.s)) {
            addDecl({
              name: nameTok.v,
              kind: "function",
              isLocal: false,
              params,
              s: nameTok.s,
              e: nameTok.e,
              from: 0,
              to: Infinity,
            });
          }
          declareParams(i, k, params);
        } else {
          const table = toks[parts[0]].v;
          if (parts.length === 2) {
            addField(table, { name: nameTok.v, method, params, s: nameTok.s, e: nameTok.e });
          }
          declareParams(i, k, params, method ? { self: table } : undefined);
        }
        i = k - 1;
        continue;
      }
      // An anonymous function, maybe passed straight to `X:Connect(`.
      if (isOp(i + 1, "(")) {
        let connect: { expr: string; at: number } | undefined;
        if (
          isOp(i - 1, "(") &&
          toks[i - 2]?.k === "name" &&
          /^(Connect|Once|ConnectParallel)$/.test(toks[i - 2].v) &&
          isOp(i - 3, ":")
        ) {
          const start = chainStartBefore(i - 3);
          if (start >= 0) {
            connect = {
              expr: masked.slice(toks[start].s, toks[i - 3].s).trim(),
              at: toks[start].s,
            };
          }
        }
        declareParams(i, i + 1, readParams(i + 1), { connect });
      }
      continue;
    }

    if (isKw(i, "for")) {
      const names: number[] = [];
      let k = i + 1;
      while (toks[k]?.k === "name") {
        names.push(k);
        k++;
        if (isOp(k, ":")) k = readType(k + 1);
        if (isOp(k, ",")) k++;
        else break;
      }
      let doTok = k;
      while (doTok < N && !isKw(doTok, "do")) {
        if (toks[doTok].k === "op" && toks[doTok].v in OPENERS && match[doTok] >= 0) {
          doTok = match[doTok];
        }
        if (isKw(doTok, "end") || isKw(doTok, "local")) break;
        doTok++;
      }
      const from = toks[doTok]?.e ?? code.length;
      const to = match[i] >= 0 ? toks[match[i]].s : code.length;
      const numeric = isOp(k, "=");
      const iterExpr =
        !numeric && isKw(k, "in") && doTok > k + 1 ? text(k + 1, doTok - 1) : undefined;
      names.forEach((nk, index) => {
        declTokens.add(nk);
        addDecl({
          name: toks[nk].v,
          kind: "for",
          isLocal: true,
          s: toks[nk].s,
          e: toks[nk].e,
          from,
          to,
          src: numeric
            ? { k: "number" }
            : iterExpr
              ? { k: "iter", expr: iterExpr, index, at: toks[k].s }
              : undefined,
        });
      });
      i = k;
      continue;
    }

    if (t.k !== "name") continue;
    const prev = toks[i - 1];
    const afterAccess = prev?.k === "op" && (prev.v === "." || prev.v === ":");

    // `X:Connect(handler)`: the handler's parameters get the event's types.
    if (
      isOp(i - 1, "(") &&
      isOp(i + 1, ")") &&
      toks[i - 2]?.k === "name" &&
      /^(Connect|Once|ConnectParallel)$/.test(toks[i - 2].v) &&
      isOp(i - 3, ":")
    ) {
      const start = chainStartBefore(i - 3);
      if (start >= 0) {
        connectByName.set(t.v, {
          expr: masked.slice(toks[start].s, toks[i - 3].s).trim(),
          at: toks[start].s,
        });
      }
    }

    if (afterAccess) continue;

    // Table constructor keys aren't variables.
    const inBraces = top[i] >= 0 && isOp(top[i], "{");
    if (
      inBraces &&
      isOp(i + 1, "=") &&
      (isOp(i - 1, "{") || isOp(i - 1, ",") || isOp(i - 1, ";"))
    ) {
      continue;
    }

    const statementStart =
      !inBraces &&
      (!prev ||
        prev.line < t.line ||
        isOp(i - 1, ";") ||
        (prev.k === "kw" && /^(do|then|else|end|repeat|break)$/.test(prev.v)) ||
        (prev.k === "op" && prev.v in CLOSERS));

    // Assignments: `x = …`, `M.field = …`
    if (statementStart && isOp(i + 1, "=")) {
      const { items, end } = readExprList(i + 2);
      const v = items[0];
      const from = toks[Math.max(i, end - 1)]?.e ?? code.length;
      const src: Source | undefined = v ? { k: "rhs", text: text(v.a, v.z), at: t.s } : undefined;
      if (visibleLocal(t.v, t.s) || decls.some((d) => d.name === t.v && d.kind === "global")) {
        if (src) assigns.push({ name: t.v, from, src });
        refs.push(i);
      } else {
        declTokens.add(i);
        const d = addDecl({
          name: t.v,
          kind: "global",
          isLocal: false,
          s: t.s,
          e: t.e,
          from: 0,
          to: Infinity,
          src,
        });
        if (v && isKw(v.a, "function")) d.params = readParams(v.a + 1);
        if (v && isOp(v.a, "{") && match[v.a] === v.z) {
          for (const f of constructorFields(v.a)) addField(t.v, f);
        }
      }
      continue;
    }
    if (statementStart && isOp(i + 1, ".") && toks[i + 2]?.k === "name" && isOp(i + 3, "=")) {
      const { items } = readExprList(i + 4);
      const v = items[0];
      const f: Field = { name: toks[i + 2].v, method: false, s: toks[i + 2].s, e: toks[i + 2].e };
      if (v) {
        f.rhs = { text: text(v.a, v.z), at: t.s };
        if (isKw(v.a, "function")) f.params = readParams(v.a + 1);
      }
      addField(t.v, f);
    }

    // Names after `:`/`::`/`->` are type annotations, not variables.
    if (prev?.k === "op" && (prev.v === "::" || prev.v === "->")) continue;
    if (!declTokens.has(i)) refs.push(i);
  }

  // Named handlers passed to Connect: type their untyped parameters from the event.
  for (const d of decls) {
    if (d.kind !== "function" || !d.params) continue;
    const c = connectByName.get(d.name);
    if (!c) continue;
    d.params.forEach((p, index) => {
      if (p.type) return;
      const pd = decls.find((x) => x.kind === "param" && x.s === p.s);
      if (pd && !pd.src) pd.src = { k: "connect", expr: c.expr, index, at: c.at };
    });
  }

  // What the module returns: `return M` or `return { … }` at the top level.
  let exports: Field[] | null = null;
  for (let i = N - 1; i >= 0; i--) {
    if (!isKw(i, "return") || top[i] !== -1) continue;
    const v = toks[i + 1];
    if (v?.k === "name") exports = fields.get(v.v) ?? [];
    else if (isOp(i + 1, "{")) exports = constructorFields(i + 1);
    break;
  }

  // Token indexes in refs may include declaration names found later; drop them.
  const finalRefs = refs.filter((r) => !declTokens.has(r));

  const byName = new Map<string, Decl[]>();
  for (const d of decls) {
    const list = byName.get(d.name) ?? [];
    list.push(d);
    byName.set(d.name, list);
  }
  return { decls, assigns, fields, refs: finalRefs, typeNames, exports, byName };
}

/**
 * The first token of the expression chain that ends right before token k (a `.` or `:`),
 * e.g. `script.Parent:WaitForChild("A")` for the `.` in `…("A").B`. -1 if there isn't one.
 */
export function chainStart(toks: Tok[], match: Int32Array, k: number): number {
  let j = k - 1;
  for (let guard = 0; guard < 200 && j >= 0; guard++) {
    const t = toks[j];
    if (t.k === "op" && (t.v === ")" || t.v === "]")) {
      if (match[j] < 0) return -1;
      j = match[j] - 1;
      continue;
    }
    if (t.k === "name") {
      const p = toks[j - 1];
      if (p?.k === "op" && (p.v === "." || p.v === ":")) {
        j -= 2;
        continue;
      }
      return j;
    }
    return -1;
  }
  return -1;
}

// ---------------------------------------------------------------------------------------
// Public API

/** Built-in Luau type names, for type annotations. */
export const PRIMITIVE_TYPES = [
  "any",
  "boolean",
  "buffer",
  "never",
  "nil",
  "number",
  "string",
  "thread",
  "unknown",
  "vector",
];

const cache: Analysis[] = [];

/** Analyzes Luau source. Results for the last few sources are cached. */
export function analyze(code: string): Analysis {
  const hit = cache.find((a) => a.code === code);
  if (hit) return hit;

  const tk = tokenize(code);
  const lineCount = tk.lineStarts.length;
  const b = blocks(tk.toks, lineCount, tk.interior);
  const ix = index(code, tk.masked, tk.toks, b);
  const a: Analysis = {
    code,
    masked: tk.masked,
    toks: tk.toks,
    lineStarts: tk.lineStarts,
    match: b.match,
    top: b.top,
    exprIf: b.exprIf,
    unclosed: b.unclosed,
    problems: [...tk.problems, ...b.problems],
    folds: [...tk.folds, ...b.folds].filter(
      (f, i, all) => all.findIndex((g) => g.start === f.start && g.end === f.end) === i,
    ),
    indents: b.indents,
    ...ix,
  };
  cache.unshift(a);
  if (cache.length > 6) cache.pop();
  return a;
}

/** The declaration `name` refers to at `offset`, if it's a local/parameter/global. */
export function lookup(a: Analysis, name: string, offset: number): Decl | undefined {
  let best: Decl | undefined;
  for (const d of a.byName.get(name) ?? []) {
    if (d.kind === "global") {
      if (!best) best = d;
      continue;
    }
    if (d.from <= offset && offset <= d.to && (!best || !best.isLocal || d.from >= best.from)) {
      best = d;
    }
  }
  return best;
}

/** Where `name`'s current value comes from at `offset` (following reassignments). */
export function sourceOf(a: Analysis, name: string, offset: number) {
  const decl = lookup(a, name, offset);
  let src = decl?.src;
  let best = -1;
  for (const as of a.assigns) {
    if (as.name !== name || as.from > offset || as.from < best) continue;
    if (decl && decl.isLocal && (as.from < decl.from || as.from > decl.to)) continue;
    best = as.from;
    src = as.src;
  }
  return { decl, src };
}

/** Declarations visible at `offset` (innermost first when names repeat). */
export function visibleAt(a: Analysis, offset: number): Decl[] {
  const seen = new Map<string, Decl>();
  for (const d of a.decls) {
    const visible = d.kind === "global" || (d.from <= offset && offset <= d.to);
    if (!visible) continue;
    const old = seen.get(d.name);
    if (!old || (d.isLocal && d.from >= old.from)) seen.set(d.name, d);
  }
  return [...seen.values()];
}

/** Index of the last token starting before `offset` (-1 if none). */
export function tokenBefore(a: Analysis, offset: number) {
  let lo = 0;
  let hi = a.toks.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a.toks[mid].s < offset) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Index of the token covering `offset` (start <= offset <= end), or -1. */
export function tokenAt(a: Analysis, offset: number) {
  const i = tokenBefore(a, offset + 1);
  return i >= 0 && a.toks[i].e >= offset ? i : -1;
}

/** Text of the expression chain ending right before token k (a `.`/`:`/`(`), and where it starts. */
export function chainBefore(a: Analysis, k: number) {
  const start = chainStart(a.toks, a.match, k);
  if (start < 0) return null;
  return { expr: a.masked.slice(a.toks[start].s, a.toks[k].s).trim(), at: a.toks[start].s };
}

export type CallContext = {
  /** The function or method name. */
  name: string;
  /** "." or ":" when called on something, "" for a plain `name(`. */
  sep: string;
  /** What it's called on (`game.Players` in `game.Players:GetPlayers(`). */
  expr?: string;
  at: number;
  /** Which argument the cursor is in (0-based). */
  arg: number;
};

/** The call whose argument list contains `offset`, if any (works across lines). */
export function callAt(a: Analysis, offset: number): CallContext | null {
  const { toks, match } = a;
  let depth = 0;
  let commas = 0;
  const last = tokenBefore(a, offset);
  for (let k = last; k >= 0 && k > last - 4000; k--) {
    const t = toks[k];
    if (t.k === "kw") {
      if (t.v === "end" && depth === 0 && match[k] >= 0) {
        k = match[k];
        continue;
      }
      if (depth === 0 && /^(function|then|do|else|repeat|local)$/.test(t.v)) return null;
      continue;
    }
    if (t.k !== "op") continue;
    if (t.v in CLOSERS) {
      // A closer before the cursor that belongs to a complete group: skip the group.
      if (match[k] >= 0) {
        k = match[k];
        continue;
      }
      depth++;
      continue;
    }
    if (t.v in OPENERS) {
      if (depth > 0) {
        depth--;
        continue;
      }
      const callee = toks[k - 1];
      if (t.v === "(" && callee && (callee.k === "name" || callee.v === ")" || callee.v === "]")) {
        if (callee.k !== "name") return null;
        const sepTok = toks[k - 2];
        if (sepTok?.k === "op" && (sepTok.v === "." || sepTok.v === ":")) {
          const chain = chainBefore(a, k - 2);
          if (!chain) return null;
          return { name: callee.v, sep: sepTok.v, expr: chain.expr, at: chain.at, arg: commas };
        }
        return { name: callee.v, sep: "", at: callee.s, arg: commas };
      }
      // Inside a table or grouping: keep looking outward.
      commas = 0;
      continue;
    }
    if (t.v === "," && depth === 0) commas++;
  }
  return null;
}

/** Fields of a table variable (constructor fields plus `M.x = …` / `function M.x()`). */
export const fieldsOf = (a: Analysis, name: string) => a.fields.get(name) ?? [];

/** Position helpers (1-based lines/columns). */
export function positionOf(a: Analysis, offset: number) {
  let lo = 0;
  let hi = a.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (a.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { lineNumber: lo + 1, column: offset - a.lineStarts[lo] + 1 };
}
