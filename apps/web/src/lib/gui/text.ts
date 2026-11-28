import { canvasFont, type CssFont } from "./fonts";

let ctx: CanvasRenderingContext2D | null | undefined;
function context() {
  if (ctx === undefined) {
    ctx =
      typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  return ctx;
}

/** Width of one line of text in px (a rough estimate when there's no canvas). */
export function textWidth(text: string, font: CssFont, size: number) {
  const c = context();
  if (!c) return text.length * size * 0.5;
  c.font = canvasFont(font, size);
  return c.measureText(text).width;
}

/** Splits text into lines the way wrapping would, given a max width (Infinity = no wrap). */
export function wrapLines(text: string, font: CssFont, size: number, maxWidth: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!Number.isFinite(maxWidth)) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (line && textWidth(next.trimEnd(), font, size) > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Size of a block of text in px. */
export function textBounds(
  text: string,
  font: CssFont,
  size: number,
  lineHeight: number,
  maxWidth = Infinity,
) {
  const lines = wrapLines(text, font, size, maxWidth);
  const width = Math.max(0, ...lines.map((l) => textWidth(l, font, size)));
  return { width, height: lines.length * size * lineHeight };
}

/**
 * TextScaled: the largest whole text size (Roblox caps it at 100) that fits the box,
 * wrapping lines like Roblox does.
 */
export function fitTextSize(
  text: string,
  font: CssFont,
  box: { w: number; h: number },
  lineHeight: number,
  min = 1,
  max = 100,
) {
  if (!text) return Math.max(min, Math.min(max, box.h));
  let lo = Math.max(1, min);
  let hi = Math.max(lo, max);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const b = textBounds(text, font, mid, lineHeight, box.w);
    if (b.width <= box.w + 0.5 && b.height <= box.h + 0.5) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---- Rich text ----

export type RichSpan = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  size?: number;
  face?: string;
  weight?: number;
  uppercase?: boolean;
  smallcaps?: boolean;
  /** A line break (from <br/>). */
  br?: boolean;
};

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const decode = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ENTITIES[e]);

const WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  heavy: 900,
};

/** A Roblox rich text color attribute (#RRGGBB or rgb(r,g,b)) as CSS, or undefined. */
function richColor(value: string) {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return m ? `rgb(${m[1]}, ${m[2]}, ${m[3]})` : undefined;
}

const attrs = (s: string) => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/(\w+)\s*=\s*("([^"]*)"|'([^']*)')/g))
    out[m[1].toLowerCase()] = m[3] ?? m[4];
  return out;
};

/**
 * Parses Roblox rich text (<b>, <i>, <u>, <s>, <font color/size/face/weight>, <br/>,
 * <uc>, <sc>, <stroke> and comments) into styled spans. Unknown tags keep their text.
 * The result is rendered as React elements, never as HTML.
 */
export function parseRichText(input: string): RichSpan[] {
  const spans: RichSpan[] = [];
  const stack: { tag: string; style: Omit<RichSpan, "text"> }[] = [];
  const style = () => Object.assign({}, ...stack.map((s) => s.style)) as Omit<RichSpan, "text">;
  const re = /<!--[\s\S]*?-->|<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let last = 0;
  for (const m of input.matchAll(re)) {
    if (m.index > last) spans.push({ ...style(), text: decode(input.slice(last, m.index)) });
    last = m.index + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const [, closing, rawTag, rest, selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (tag === "br") {
      spans.push({ text: "", br: true });
      continue;
    }
    if (closing) {
      const i = stack.map((s) => s.tag).lastIndexOf(tag);
      if (i >= 0) stack.splice(i);
      continue;
    }
    if (selfClosing) continue;
    const a = attrs(rest);
    const s: Omit<RichSpan, "text"> = {};
    switch (tag) {
      case "b":
        s.bold = true;
        break;
      case "i":
        s.italic = true;
        break;
      case "u":
        s.underline = true;
        break;
      case "s":
        s.strike = true;
        break;
      case "uc":
      case "uppercase":
        s.uppercase = true;
        break;
      case "sc":
      case "smallcaps":
        s.smallcaps = true;
        break;
      case "font":
        if (a.color) s.color = richColor(a.color);
        if (a.size && Number.isFinite(+a.size)) s.size = +a.size;
        if (a.face) s.face = a.face;
        if (a.family) s.face = a.family.match(/families\/([^/]+?)\.json/)?.[1] ?? s.face;
        if (a.weight) s.weight = WEIGHTS[a.weight.toLowerCase()] ?? (+a.weight || undefined);
        break;
      default:
        // <stroke>, <mark> and anything unknown: keep the text, ignore the styling.
        break;
    }
    stack.push({ tag, style: s });
  }
  if (last < input.length) spans.push({ ...style(), text: decode(input.slice(last)) });
  return spans;
}

/** Rich text with the tags removed (for measuring). */
export const richPlain = (input: string) =>
  parseRichText(input)
    .map((s) => (s.br ? "\n" : s.uppercase ? s.text.toUpperCase() : s.text))
    .join("");
