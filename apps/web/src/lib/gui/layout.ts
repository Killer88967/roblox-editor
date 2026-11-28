/**
 * Lays out Roblox 2D GUIs (ScreenGui contents) into pixel boxes, following Roblox's
 * rules: UDim2 Size/Position (scale of the parent + offset), AnchorPoint, SizeConstraint,
 * UIPadding, UIListLayout, UIGridLayout, UIAspectRatioConstraint, UISizeConstraint,
 * AutomaticSize, TextScaled (with UITextSizeConstraint), ScrollingFrame canvases, and the
 * visual modifiers (UICorner, UIStroke, UIGradient, UIScale). Pure: no DOM or React, so
 * the editor and Play mode can share it.
 */
import type { NodeInfo } from "@/lib/types";
import {
  ApplyStrokeMode,
  AspectType,
  AutomaticSize,
  DominantAxis,
  FillDirection,
  GUI_INSET,
  GUI_OBJECTS,
  HorizontalAlignment,
  IMAGE_OBJECTS,
  SizeConstraint,
  SortOrder,
  StartCorner,
  TEXT_OBJECTS,
  TextXAlignment,
  VerticalAlignment,
} from "./enums";
import { cssFont, type CssFont } from "./fonts";
import { bool, color, num, rgba, str, udim, udim2, vec2, type Props, type UDim } from "./props";
import { fitTextSize, richPlain, textBounds } from "./text";

/** What the layout reads: the instance tree and each instance's properties. */
export type Doc = { nodes: Map<string, NodeInfo>; props: (id: string) => Props };

type Size = { w: number; h: number };
type Box = { x: number; y: number; w: number; h: number };

export type TextInfo = {
  content: string;
  rich: boolean;
  color: string;
  /** CSS gradient for the text (UIGradient), drawn with background-clip: text. */
  gradient: string | null;
  size: number;
  font: CssFont;
  xAlign: number;
  yAlign: number;
  wrapped: boolean;
  truncate: boolean;
  lineHeight: number;
  /** Text outline: UIStroke (Contextual) or the legacy TextStroke properties. */
  stroke: { width: number; color: string } | null;
  /** A TextBox showing its PlaceholderText. */
  placeholder: boolean;
};

export type ImageInfo = {
  content: string;
  tint: [number, number, number];
  transparency: number;
  scaleType: number;
  /** Tile size in px (ScaleType.Tile). */
  tile: Size;
  /** Sprite-sheet cutout in image pixels (0 size = whole image). */
  rectOffset: [number, number];
  rectSize: [number, number];
  /** 9-slice center in image pixels (ScaleType.Slice). */
  slice: { min: [number, number]; max: [number, number] } | null;
  sliceScale: number;
};

export type GuiElement = {
  id: string;
  className: string;
  name: string;
  /** Box relative to the parent element (or its canvas), in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  anchor: [number, number];
  rotation: number;
  zIndex: number;
  clips: boolean;
  /** CSS background (color or gradient), or null when fully transparent. */
  background: string | null;
  border: { size: number; color: string; inset: boolean } | null;
  /** Corner radii in px: top-left, top-right, bottom-right, bottom-left. */
  radius: [number, number, number, number] | null;
  /** UIStroke around the box. */
  stroke: { thickness: number; color: string } | null;
  /** 0–1 (CanvasGroup GroupTransparency). */
  opacity: number;
  /** UIScale. */
  scale: number;
  text: TextInfo | null;
  image: ImageInfo | null;
  scroll: { canvas: Size; position: [number, number]; bar: number } | null;
  /** Position comes from Position (not a UIListLayout/UIGridLayout), so it can be dragged. */
  movable: boolean;
  /** UIPadding in px (text sits inside it). */
  padding: { l: number; r: number; t: number; b: number };
  /** Draws nothing itself (invisible container): clicks go through it. */
  empty: boolean;
  children: GuiElement[];
};

export type GuiScreen = {
  id: string;
  name: string;
  displayOrder: number;
  /** Top offset in px (the top bar inset unless IgnoreGuiInset). */
  top: number;
  elements: GuiElement[];
};

const resolve = (u: UDim, parent: number) => parent * u.scale + u.offset;

/** Children of `id`, by class name for modifiers and in order for GUI objects. */
function kids(doc: Doc, id: string) {
  const node = doc.nodes.get(id);
  const modifiers = new Map<string, string>();
  const objects: string[] = [];
  for (const c of node?.children ?? []) {
    const child = doc.nodes.get(c);
    if (!child) continue;
    if (GUI_OBJECTS.has(child.class)) objects.push(c);
    else if (child.class.startsWith("UI") && !modifiers.has(child.class)) {
      // The first enabled one of each kind wins, like Roblox.
      if (bool(doc.props(c), "Enabled", true)) modifiers.set(child.class, c);
    }
  }
  return { objects, modifiers };
}

/** Evaluates a sequence at time t (keypoints sorted by time). */
function sample<T extends { time: number }>(
  keys: T[],
  t: number,
  lerp: (a: T, b: T, f: number) => number[],
) {
  if (keys.length === 0) return null;
  if (t <= keys[0].time) return lerp(keys[0], keys[0], 0);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].time) {
      const a = keys[i - 1];
      const b = keys[i];
      return lerp(a, b, (t - a.time) / Math.max(1e-6, b.time - a.time));
    }
  }
  const last = keys[keys.length - 1];
  return lerp(last, last, 0);
}

/** A UIGradient as a CSS linear-gradient over a base color, or null. */
function gradientCss(
  doc: Doc,
  id: string | undefined,
  base: readonly number[],
  baseTransparency: number,
) {
  if (!id) return null;
  const p = doc.props(id);
  const cs = p.Color?.type === "ColorSequence" ? p.Color.value : [];
  const ts = p.Transparency?.type === "NumberSequence" ? p.Transparency.value : [];
  const times = [...new Set([0, 1, ...cs.map((k) => k.time), ...ts.map((k) => k.time)])].sort(
    (a, b) => a - b,
  );
  const stops = times.map((t) => {
    const c = sample(cs, t, (a, b, f) => a.color.map((v, i) => v + (b.color[i] - v) * f)) ?? [
      1, 1, 1,
    ];
    const tr = sample(ts, t, (a, b, f) => [a.value + (b.value - a.value) * f])?.[0] ?? 0;
    const mixed = c.map((v, i) => v * base[i]);
    const alpha = 1 - (1 - baseTransparency) * (1 - tr);
    return `${rgba(mixed, alpha)} ${(t * 100).toFixed(1)}%`;
  });
  // Roblox's Rotation 0 runs left to right (CSS 90deg), increasing clockwise.
  return `linear-gradient(${90 + num(p, "Rotation")}deg, ${stops.join(", ")})`;
}

/** Applies UIAspectRatioConstraint / UISizeConstraint to a size. */
function constrain(doc: Doc, size: Size, mods: Map<string, string>) {
  let { w, h } = size;
  const aspect = mods.get("UIAspectRatioConstraint");
  if (aspect) {
    const p = doc.props(aspect);
    const ratio = Math.max(1e-4, num(p, "AspectRatio", 1));
    const type = num(p, "AspectType", AspectType.FitWithinMaxSize);
    const axis = num(p, "DominantAxis", DominantAxis.Width);
    if (type === AspectType.ScaleWithParentSize) {
      if (axis === DominantAxis.Width) h = w / ratio;
      else w = h * ratio;
    } else if (w / Math.max(h, 1e-4) > ratio) w = h * ratio;
    else h = w / ratio;
  }
  const sizeC = mods.get("UISizeConstraint");
  if (sizeC) {
    const p = doc.props(sizeC);
    const [minW, minH] = vec2(p, "MinSize", [0, 0]);
    const [maxW, maxH] = vec2(p, "MaxSize", [Infinity, Infinity]);
    w = Math.min(Math.max(w, minW), maxW || Infinity);
    h = Math.min(Math.max(h, minH), maxH || Infinity);
  }
  return { w: Math.max(0, w), h: Math.max(0, h) };
}

function textInfo(doc: Doc, id: string, p: Props, size: Size, mods: Map<string, string>): TextInfo {
  const className = doc.nodes.get(id)?.class ?? "";
  const rich = bool(p, "RichText");
  let content = str(p, "Text");
  let textColor = color(p, "TextColor3", [0, 0, 0]);
  let placeholder = false;
  if (className === "TextBox" && !content) {
    content = str(p, "PlaceholderText");
    textColor = color(p, "PlaceholderColor3", [0.7, 0.7, 0.7]);
    placeholder = true;
  }
  const face = p.FontFace?.type === "Font" ? p.FontFace.value : null;
  const font = cssFont(
    face?.family ?? "rbxasset://fonts/families/SourceSansPro.json",
    face?.weight ?? 400,
    face?.italic ?? false,
  );
  const lineHeight = num(p, "LineHeight", 1) || 1;
  const transparency = num(p, "TextTransparency");
  let textSize = num(p, "TextSize", 14);
  const scaled = bool(p, "TextScaled");
  if (scaled) {
    const limit = mods.get("UITextSizeConstraint");
    const lp = limit ? doc.props(limit) : {};
    textSize = fitTextSize(
      rich ? richPlain(content) : content,
      font,
      size,
      lineHeight,
      limit ? num(lp, "MinTextSize", 1) : 1,
      limit ? num(lp, "MaxTextSize", 100) : 100,
    );
  }
  const strokeMod = mods.get("UIStroke");
  const sp = strokeMod ? doc.props(strokeMod) : null;
  let stroke: TextInfo["stroke"] = null;
  if (sp && num(sp, "ApplyStrokeMode") === ApplyStrokeMode.Contextual) {
    stroke = {
      width: num(sp, "Thickness", 1),
      color: rgba(color(sp, "Color", [0, 0, 0]), num(sp, "Transparency")),
    };
  } else if (num(p, "TextStrokeTransparency", 1) < 1) {
    stroke = {
      width: 1,
      color: rgba(color(p, "TextStrokeColor3", [0, 0, 0]), num(p, "TextStrokeTransparency")),
    };
  }
  return {
    content,
    rich,
    color: rgba(textColor, transparency),
    gradient: gradientCss(doc, mods.get("UIGradient"), textColor, transparency),
    size: textSize,
    font,
    xAlign: num(p, "TextXAlignment", TextXAlignment.Center),
    yAlign: num(p, "TextYAlignment", 1),
    wrapped: bool(p, "TextWrapped") || scaled,
    truncate: num(p, "TextTruncate") !== 0,
    lineHeight,
    stroke,
    placeholder,
  };
}

function imageInfo(p: Props, size: Size): ImageInfo {
  const content = str(p, "ImageContent") || str(p, "Image");
  const tile = udim2(p, "TileSize", { x: { scale: 1, offset: 0 }, y: { scale: 1, offset: 0 } });
  const slice = p.SliceCenter?.type === "Rect" ? p.SliceCenter.value : null;
  return {
    content,
    tint: color(p, "ImageColor3", [1, 1, 1]),
    transparency: num(p, "ImageTransparency"),
    scaleType: num(p, "ScaleType"),
    tile: { w: resolve(tile.x, size.w), h: resolve(tile.y, size.h) },
    rectOffset: vec2(p, "ImageRectOffset"),
    rectSize: vec2(p, "ImageRectSize"),
    slice: slice && (slice.max[0] > slice.min[0] || slice.max[1] > slice.min[1]) ? slice : null,
    sliceScale: num(p, "SliceScale", 1),
  };
}

/** Builds one GUI object (and its subtree) inside its parent's content box. */
function element(doc: Doc, id: string, inner: Box, movable: boolean): GuiElement {
  const node = doc.nodes.get(id)!;
  const p = doc.props(id);
  const { objects, modifiers: mods } = kids(doc, id);

  // Size: scale of the parent's content box (per SizeConstraint) plus offset.
  const sz = udim2(p, "Size");
  const sc = num(p, "SizeConstraint", SizeConstraint.RelativeXY);
  const refW = sc === SizeConstraint.RelativeYY ? inner.h : inner.w;
  const refH = sc === SizeConstraint.RelativeXX ? inner.w : inner.h;
  let size = constrain(doc, { w: resolve(sz.x, refW), h: resolve(sz.y, refH) }, mods);

  const text = TEXT_OBJECTS.has(node.class) ? textInfo(doc, id, p, size, mods) : null;

  // AutomaticSize grows the box to fit its text (children are handled after layout).
  const auto = num(p, "AutomaticSize", AutomaticSize.None);
  const padding = mods.get("UIPadding");
  const pad = (s: Size) => {
    if (!padding) return { l: 0, r: 0, t: 0, b: 0 };
    const pp = doc.props(padding);
    return {
      l: resolve(udim(pp, "PaddingLeft"), s.w),
      r: resolve(udim(pp, "PaddingRight"), s.w),
      t: resolve(udim(pp, "PaddingTop"), s.h),
      b: resolve(udim(pp, "PaddingBottom"), s.h),
    };
  };
  if (auto !== AutomaticSize.None && text && !bool(p, "TextScaled")) {
    const pd = pad(size);
    const growX = auto === AutomaticSize.X || auto === AutomaticSize.XY;
    const tb = textBounds(
      text.rich ? richPlain(text.content) : text.content,
      text.font,
      text.size,
      text.lineHeight,
      growX || !text.wrapped ? Infinity : size.w - pd.l - pd.r,
    );
    if (growX) size = { ...size, w: Math.max(size.w, tb.width + pd.l + pd.r) };
    if (auto === AutomaticSize.Y || auto === AutomaticSize.XY) {
      size = { ...size, h: Math.max(size.h, tb.height + pd.t + pd.b) };
    }
  }

  const anchor = vec2(p, "AnchorPoint");
  const pos = udim2(p, "Position");
  const place = (s: Size) => ({
    x: inner.x + resolve(pos.x, inner.w) - anchor[0] * s.w,
    y: inner.y + resolve(pos.y, inner.h) - anchor[1] * s.h,
  });

  // Children: inside the canvas for a ScrollingFrame, otherwise inside this box.
  const isScroll = node.class === "ScrollingFrame";
  let canvas: Size = size;
  if (isScroll) {
    const cs = udim2(p, "CanvasSize", { x: { scale: 0, offset: 0 }, y: { scale: 2, offset: 0 } });
    // The canvas is never smaller than the frame itself.
    canvas = {
      w: Math.max(size.w, resolve(cs.x, size.w)),
      h: Math.max(size.h, resolve(cs.y, size.h)),
    };
  }
  let children = layoutChildren(doc, id, objects, mods, canvas, pad(canvas));

  // AutomaticSize / AutomaticCanvasSize from the children's extents.
  const extent = () => {
    const pd = pad(canvas);
    return {
      w: Math.max(0, ...children.map((c) => c.x + c.w)) + pd.r,
      h: Math.max(0, ...children.map((c) => c.y + c.h)) + pd.b,
    };
  };
  if (isScroll) {
    const autoCanvas = num(p, "AutomaticCanvasSize");
    if (autoCanvas !== 0 && children.length) {
      const e = extent();
      canvas = {
        w: autoCanvas === 1 || autoCanvas === 3 ? Math.max(canvas.w, e.w) : canvas.w,
        h: autoCanvas === 2 || autoCanvas === 3 ? Math.max(canvas.h, e.h) : canvas.h,
      };
    }
  } else if (auto !== AutomaticSize.None && !text && children.length) {
    const e = extent();
    const next = {
      w: auto === AutomaticSize.X || auto === AutomaticSize.XY ? Math.max(size.w, e.w) : size.w,
      h: auto === AutomaticSize.Y || auto === AutomaticSize.XY ? Math.max(size.h, e.h) : size.h,
    };
    if (next.w !== size.w || next.h !== size.h) {
      size = next;
      canvas = next;
      children = layoutChildren(doc, id, objects, mods, canvas, pad(canvas));
    }
  }

  const { x, y } = place(size);

  // Background (color or UIGradient over it) and border.
  const bgTransparency = num(p, "BackgroundTransparency");
  const bgColor = color(p, "BackgroundColor3", [1, 1, 1]);
  const showBg = bgTransparency < 1;
  const gradient = mods.get("UIGradient");
  const background = showBg
    ? ((gradient && !text ? gradientCss(doc, gradient, bgColor, bgTransparency) : null) ??
      rgba(bgColor, bgTransparency))
    : null;
  const borderSize = num(p, "BorderSizePixel");
  const border =
    showBg && borderSize > 0
      ? {
          size: borderSize,
          color: rgba(color(p, "BorderColor3", [0, 0, 0]), bgTransparency),
          inset: num(p, "BorderMode") === 2,
        }
      : null;

  // UICorner: scale is relative to the smaller side.
  let radius: GuiElement["radius"] = null;
  const corner = mods.get("UICorner");
  if (corner) {
    const cp = doc.props(corner);
    const short = Math.min(size.w, size.h);
    const r = (key: string) =>
      Math.min(
        short / 2,
        Math.max(
          0,
          resolve(udim(cp, key, udim(cp, "CornerRadius", { scale: 0, offset: 8 })), short),
        ),
      );
    radius = cp.TopLeftRadius
      ? [r("TopLeftRadius"), r("TopRightRadius"), r("BottomRightRadius"), r("BottomLeftRadius")]
      : [r("CornerRadius"), r("CornerRadius"), r("CornerRadius"), r("CornerRadius")];
  }

  // UIStroke on the border (text strokes are part of TextInfo).
  let stroke: GuiElement["stroke"] = null;
  const strokeMod = mods.get("UIStroke");
  if (strokeMod) {
    const sp = doc.props(strokeMod);
    if (!text || num(sp, "ApplyStrokeMode") === ApplyStrokeMode.Border) {
      stroke = {
        thickness: num(sp, "Thickness", 1),
        color: rgba(color(sp, "Color", [0, 0, 0]), num(sp, "Transparency")),
      };
    }
  }

  const image = IMAGE_OBJECTS.has(node.class) ? imageInfo(p, size) : null;
  const scaleMod = mods.get("UIScale");

  return {
    id,
    className: node.class,
    name: node.name,
    x,
    y,
    w: size.w,
    h: size.h,
    anchor,
    rotation: num(p, "Rotation"),
    zIndex: num(p, "ZIndex", 1),
    clips: bool(p, "ClipsDescendants") || isScroll,
    background,
    border,
    radius,
    stroke,
    opacity: node.class === "CanvasGroup" ? 1 - num(p, "GroupTransparency") : 1,
    scale: scaleMod ? num(doc.props(scaleMod), "Scale", 1) : 1,
    text,
    image,
    scroll: isScroll
      ? { canvas, position: vec2(p, "CanvasPosition"), bar: num(p, "ScrollBarThickness", 12) }
      : null,
    movable,
    padding: pad(size),
    empty:
      !background && !border && !stroke && !(text && text.content) && !(image && image.content),
    children,
  };
}

/** Sorts layout children like Roblox (by LayoutOrder or Name). */
function sortForLayout(doc: Doc, ids: string[], order: number) {
  const named = (id: string) => doc.nodes.get(id)?.name ?? "";
  if (order === SortOrder.Name) return [...ids].sort((a, b) => named(a).localeCompare(named(b)));
  if (order === SortOrder.LayoutOrder) {
    return ids
      .map((id, i) => ({ id, i, o: num(doc.props(id), "LayoutOrder") }))
      .sort((a, b) => a.o - b.o || a.i - b.i)
      .map((e) => e.id);
  }
  return ids;
}

/** Lays out the visible GUI objects inside a parent box (applying its layout modifier). */
function layoutChildren(
  doc: Doc,
  parentId: string,
  objects: string[],
  mods: Map<string, string>,
  box: Size,
  pd: { l: number; r: number; t: number; b: number },
): GuiElement[] {
  const inner: Box = {
    x: pd.l,
    y: pd.t,
    w: Math.max(0, box.w - pd.l - pd.r),
    h: Math.max(0, box.h - pd.t - pd.b),
  };
  const visible = objects.filter((id) => bool(doc.props(id), "Visible", true));
  const list = mods.get("UIListLayout");
  const grid = mods.get("UIGridLayout");
  const layout = list ?? grid;
  if (!layout) return visible.map((id) => element(doc, id, inner, true));

  const lp = doc.props(layout);
  const ordered = sortForLayout(doc, visible, num(lp, "SortOrder", SortOrder.LayoutOrder));
  const hAlign = num(lp, "HorizontalAlignment", HorizontalAlignment.Left);
  const vAlign = num(lp, "VerticalAlignment", VerticalAlignment.Top);
  const vertical =
    num(lp, "FillDirection", list ? FillDirection.Vertical : FillDirection.Horizontal) ===
    FillDirection.Vertical;
  const alignOffset = (free: number, align: number, start: number, end: number) =>
    align === start ? 0 : align === end ? free : free / 2;

  if (list) {
    const els = ordered.map((id) => element(doc, id, inner, false));
    const padding = resolve(udim(lp, "Padding"), vertical ? inner.h : inner.w);
    const total =
      els.reduce((sum, e) => sum + (vertical ? e.h : e.w), 0) +
      padding * Math.max(0, els.length - 1);
    let cursor = vertical
      ? inner.y +
        alignOffset(inner.h - total, vAlign, VerticalAlignment.Top, VerticalAlignment.Bottom)
      : inner.x +
        alignOffset(inner.w - total, hAlign, HorizontalAlignment.Left, HorizontalAlignment.Right);
    for (const e of els) {
      if (vertical) {
        e.y = cursor;
        e.x =
          inner.x +
          alignOffset(inner.w - e.w, hAlign, HorizontalAlignment.Left, HorizontalAlignment.Right);
        cursor += e.h + padding;
      } else {
        e.x = cursor;
        e.y =
          inner.y +
          alignOffset(inner.h - e.h, vAlign, VerticalAlignment.Top, VerticalAlignment.Bottom);
        cursor += e.w + padding;
      }
    }
    return els;
  }

  // UIGridLayout: every child takes the cell size.
  const cell = udim2(lp, "CellSize", {
    x: { scale: 0, offset: 100 },
    y: { scale: 0, offset: 100 },
  });
  const gap = udim2(lp, "CellPadding", { x: { scale: 0, offset: 5 }, y: { scale: 0, offset: 5 } });
  const cw = resolve(cell.x, inner.w);
  const ch = resolve(cell.y, inner.h);
  const gx = resolve(gap.x, inner.w);
  const gy = resolve(gap.y, inner.h);
  const maxCells = num(lp, "FillDirectionMaxCells");
  const fit = vertical
    ? Math.floor((inner.h + gy) / (ch + gy))
    : Math.floor((inner.w + gx) / (cw + gx));
  const perLine = Math.max(1, maxCells > 0 ? Math.min(maxCells, Math.max(1, fit)) : fit);
  const lines = Math.ceil(ordered.length / perLine);
  const cols = vertical ? lines : Math.min(perLine, ordered.length);
  const rows = vertical ? Math.min(perLine, ordered.length) : lines;
  const blockW = cols * cw + Math.max(0, cols - 1) * gx;
  const blockH = rows * ch + Math.max(0, rows - 1) * gy;
  const ox =
    inner.x +
    alignOffset(inner.w - blockW, hAlign, HorizontalAlignment.Left, HorizontalAlignment.Right);
  const oy =
    inner.y +
    alignOffset(inner.h - blockH, vAlign, VerticalAlignment.Top, VerticalAlignment.Bottom);
  const corner = num(lp, "StartCorner", StartCorner.TopLeft);
  const fromRight = corner === StartCorner.TopRight || corner === StartCorner.BottomRight;
  const fromBottom = corner === StartCorner.BottomLeft || corner === StartCorner.BottomRight;
  return ordered.map((id, i) => {
    const line = Math.floor(i / perLine);
    const along = i % perLine;
    let col = vertical ? line : along;
    let row = vertical ? along : line;
    if (fromRight) col = cols - 1 - col;
    if (fromBottom) row = rows - 1 - row;
    const e = element(doc, id, { x: 0, y: 0, w: cw, h: ch }, false);
    // The cell decides the size; Position is ignored.
    e.w = cw;
    e.h = ch;
    e.x = ox + col * (cw + gx);
    e.y = oy + row * (ch + gy);
    return e;
  });
}

/** Lays out every enabled ScreenGui under `containerId` (StarterGui or a PlayerGui). */
export function layoutScreens(
  doc: Doc,
  containerId: string | undefined,
  screen: Size,
): GuiScreen[] {
  if (!containerId) return [];
  const out: GuiScreen[] = [];
  const walk = (id: string) => {
    for (const c of doc.nodes.get(id)?.children ?? []) {
      const n = doc.nodes.get(c);
      if (!n) continue;
      if (n.class === "ScreenGui") {
        const p = doc.props(c);
        if (!bool(p, "Enabled", true)) continue;
        const top = bool(p, "IgnoreGuiInset") ? 0 : GUI_INSET;
        const size = { w: screen.w, h: Math.max(0, screen.h - top) };
        const { objects, modifiers } = kids(doc, c);
        out.push({
          id: c,
          name: n.name,
          displayOrder: num(p, "DisplayOrder"),
          top,
          elements: layoutChildren(doc, c, objects, modifiers, size, { l: 0, r: 0, t: 0, b: 0 }),
        });
      } else if (n.class === "Folder") walk(c);
    }
  };
  walk(containerId);
  return out.sort((a, b) => a.displayOrder - b.displayOrder);
}

export type AbsoluteRect = { x: number; y: number; w: number; h: number; rotation: number };

/** Every GUI object's rect in screen pixels (below the top bar), for AbsolutePosition etc. */
export function absoluteRects(screens: GuiScreen[]) {
  const out = new Map<string, AbsoluteRect>();
  const walk = (els: GuiElement[], ox: number, oy: number, rotation: number) => {
    for (const el of els) {
      const x = ox + el.x;
      const y = oy + el.y;
      const rot = rotation + (el.rotation || 0);
      out.set(el.id, { x, y, w: el.w, h: el.h, rotation: rot });
      walk(el.children, x, y, rot);
    }
  };
  for (const s of screens) walk(s.elements, 0, s.top - GUI_INSET, 0);
  return out;
}
