"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEditor } from "@/stores/editor";
import { assetIdOf, assetUrl } from "@/lib/asset-id";
import { ScaleType, TextXAlignment, TextYAlignment } from "@/lib/gui/enums";
import {
  layoutScreens,
  type Doc,
  type GuiElement,
  type ImageInfo,
  type TextInfo,
} from "@/lib/gui/layout";
import type { Props } from "@/lib/gui/props";
import { parseRichText } from "@/lib/gui/text";
import type { NodeInfo, PropertyInfo, Value } from "@/lib/types";

/** Properties per node object; a node gets a new object whenever it changes. */
const propsCache = new WeakMap<NodeInfo, Props>();

function useDoc(): Doc {
  const nodes = useEditor((s) => s.nodes);
  const editor = useEditor((s) => s.editor);
  return useMemo(
    () => ({
      nodes,
      props: (id: string) => {
        const node = nodes.get(id);
        if (!node || !editor) return {};
        let p = propsCache.get(node);
        if (!p) {
          p = {};
          for (const prop of editor.properties(id) as PropertyInfo[]) p[prop.key] = prop.value;
          propsCache.set(node, p);
        }
        return p;
      },
    }),
    [nodes, editor],
  );
}

/** The overlay's pixel size. */
function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Re-render when web fonts finish loading (text sizes depend on them). */
function useFontsVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    const bump = () => setV((n) => n + 1);
    document.fonts.addEventListener("loadingdone", bump);
    return () => document.fonts.removeEventListener("loadingdone", bump);
  }, []);
  return v;
}

/** Natural size of an image (for 9-slice and sprite cutouts). */
const imageSizes = new Map<string, Promise<[number, number] | null>>();
function useImageSize(url: string | null) {
  const [size, setSize] = useState<{ url: string; size: [number, number] | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let p = imageSizes.get(url);
    if (!p) {
      p = new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.onerror = () => resolve(null);
        img.src = url;
      });
      imageSizes.set(url, p);
    }
    let live = true;
    p.then((s) => live && setSize({ url, size: s }));
    return () => {
      live = false;
    };
  }, [url]);
  return url && size?.url === url ? size.size : null;
}

type Drag = { id: string; kind: "move" | "resize"; x: number; y: number; dx: number; dy: number };

const X_ALIGN = {
  [TextXAlignment.Left]: "flex-start",
  [TextXAlignment.Right]: "flex-end",
} as Record<number, string>;
const Y_ALIGN = {
  [TextYAlignment.Top]: "flex-start",
  [TextYAlignment.Bottom]: "flex-end",
} as Record<number, string>;
const TEXT_ALIGN = { [TextXAlignment.Left]: "left", [TextXAlignment.Right]: "right" } as Record<
  number,
  "left" | "right"
>;

function Text({ text, pad }: { text: TextInfo; pad: GuiElement["padding"] }) {
  if (!text.content) return null;
  const style: CSSProperties = {
    fontFamily: text.font.family,
    fontWeight: text.font.weight,
    fontStyle: text.font.italic ? "italic" : "normal",
    fontSize: text.size,
    lineHeight: text.lineHeight,
    color: text.gradient ? "transparent" : text.color,
    whiteSpace: text.truncate ? "nowrap" : text.wrapped ? "pre-wrap" : "pre",
    overflowWrap: text.wrapped ? "break-word" : undefined,
    textAlign: TEXT_ALIGN[text.xAlign] ?? "center",
    width: text.wrapped || text.truncate ? "100%" : undefined,
    overflow: text.truncate ? "hidden" : undefined,
    textOverflow: text.truncate ? "ellipsis" : undefined,
    WebkitTextStroke: text.stroke ? `${text.stroke.width * 2}px ${text.stroke.color}` : undefined,
    paintOrder: text.stroke ? "stroke fill" : undefined,
    background: text.gradient ?? undefined,
    WebkitBackgroundClip: text.gradient ? "text" : undefined,
    backgroundClip: text.gradient ? "text" : undefined,
  };
  let body: ReactNode = text.content;
  if (text.rich) {
    body = parseRichText(text.content).map((s, i) =>
      s.br ? (
        <br key={i} />
      ) : (
        <span
          key={i}
          style={{
            fontWeight: s.bold ? 700 : s.weight,
            fontStyle: s.italic ? "italic" : undefined,
            textDecoration:
              [s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") ||
              undefined,
            color: s.color,
            fontSize: s.size,
            textTransform: s.uppercase ? "uppercase" : undefined,
            fontVariant: s.smallcaps ? "small-caps" : undefined,
          }}
        >
          {s.text}
        </span>
      ),
    );
  }
  return (
    <div
      className="pointer-events-none absolute flex"
      style={{
        left: pad.l,
        top: pad.t,
        right: pad.r,
        bottom: pad.b,
        alignItems: Y_ALIGN[text.yAlign] ?? "center",
        justifyContent: X_ALIGN[text.xAlign] ?? "center",
        overflow: text.wrapped ? "hidden" : "visible",
      }}
    >
      <span style={style}>{body}</span>
    </div>
  );
}

function ImageView({ image, w, h }: { image: ImageInfo; w: number; h: number }) {
  const assetsEnabled = useEditor((s) => s.assetsEnabled);
  const shareToken = useEditor((s) => s.cloud?.shareToken ?? null);
  const id = assetIdOf(image.content);
  const url = assetsEnabled && id ? assetUrl(id, shareToken) : null;
  const natural = useImageSize(url && (image.slice || image.rectSize[0] > 0) ? url : null);
  if (!image.content) return null;
  if (!url) {
    // No image loading (signed out / accounts off): show where the image is.
    return (
      <div
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
        style={{
          background:
            "repeating-conic-gradient(rgba(255,255,255,.12) 0 25%, rgba(0,0,0,.12) 0 50%) 0 0 / 12px 12px",
          opacity: 1 - image.transparency,
        }}
        title={image.content}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(255,255,255,.7)"
          strokeWidth="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </div>
    );
  }

  const layer: CSSProperties = { backgroundImage: `url("${url}")`, backgroundRepeat: "no-repeat" };
  if (image.rectSize[0] > 0 && image.rectSize[1] > 0 && natural) {
    // Sprite sheet: scale the sheet so the cutout fills the box.
    const sx = w / image.rectSize[0];
    const sy = h / image.rectSize[1];
    layer.backgroundSize = `${natural[0] * sx}px ${natural[1] * sy}px`;
    layer.backgroundPosition = `${-image.rectOffset[0] * sx}px ${-image.rectOffset[1] * sy}px`;
  } else if (image.scaleType === ScaleType.Fit) {
    layer.backgroundSize = "contain";
    layer.backgroundPosition = "center";
  } else if (image.scaleType === ScaleType.Crop) {
    layer.backgroundSize = "cover";
    layer.backgroundPosition = "center";
  } else if (image.scaleType === ScaleType.Tile) {
    layer.backgroundSize = `${image.tile.w}px ${image.tile.h}px`;
    layer.backgroundRepeat = "repeat";
  } else {
    layer.backgroundSize = "100% 100%";
  }

  const white = image.tint.every((c) => c >= 0.999);
  const tint = `rgb(${image.tint.map((c) => Math.round(c * 255)).join(",")})`;
  let style: CSSProperties = white
    ? layer
    : {
        // ImageColor3 multiplies the image; the mask keeps its transparency.
        ...layer,
        backgroundColor: tint,
        backgroundBlendMode: "multiply",
        maskImage: layer.backgroundImage,
        maskSize: layer.backgroundSize,
        maskPosition: layer.backgroundPosition,
        maskRepeat: layer.backgroundRepeat,
        WebkitMaskImage: layer.backgroundImage,
        WebkitMaskSize: layer.backgroundSize as string,
        WebkitMaskPosition: layer.backgroundPosition as string,
        WebkitMaskRepeat: layer.backgroundRepeat as string,
      };

  if (image.scaleType === ScaleType.Slice && image.slice && natural) {
    // 9-slice: the corners keep their size (times SliceScale), the edges and middle stretch.
    const [iw, ih] = natural;
    const { min, max } = image.slice;
    const slices = [min[1], iw - max[0], ih - max[1], min[0]].map((n) => Math.max(0, n));
    const widths = slices.map((n) => n * image.sliceScale);
    style = {
      borderStyle: "solid",
      borderColor: "transparent",
      borderWidth: widths.map((n) => `${n}px`).join(" "),
      borderImage: `url("${url}") ${slices.join(" ")} fill / ${widths.map((n) => `${n}px`).join(" ")} stretch`,
    };
  }

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ ...style, opacity: 1 - image.transparency }}
    />
  );
}

type Ctx = {
  selected: Set<string>;
  drag: Drag | null;
  editable: boolean;
  startDrag: (e: React.PointerEvent, el: GuiElement, kind: Drag["kind"]) => void;
};

function Element({ el, ctx }: { el: GuiElement; ctx: Ctx }) {
  const selected = ctx.selected.has(el.id);
  const d = ctx.drag?.id === el.id ? ctx.drag : null;
  const x = el.x + (d?.kind === "move" ? d.dx : 0);
  const y = el.y + (d?.kind === "move" ? d.dy : 0);
  const w = Math.max(0, el.w + (d?.kind === "resize" ? d.dx : 0));
  const h = Math.max(0, el.h + (d?.kind === "resize" ? d.dy : 0));

  const shadows: string[] = [];
  if (el.border)
    shadows.push(`${el.border.inset ? "inset " : ""}0 0 0 ${el.border.size}px ${el.border.color}`);
  if (el.stroke) shadows.push(`0 0 0 ${el.stroke.thickness}px ${el.stroke.color}`);

  const style: CSSProperties = {
    left: x,
    top: y,
    width: w,
    height: h,
    zIndex: el.zIndex,
    background: el.background ?? undefined,
    borderRadius: el.radius ? el.radius.map((r) => `${r}px`).join(" ") : undefined,
    boxShadow: shadows.length ? shadows.join(", ") : undefined,
    overflow: el.clips ? "hidden" : undefined,
    opacity: el.opacity < 1 ? el.opacity : undefined,
    transform:
      el.rotation || el.scale !== 1
        ? `${el.rotation ? `rotate(${el.rotation}deg)` : ""} ${el.scale !== 1 ? `scale(${el.scale})` : ""}`
        : undefined,
    transformOrigin:
      el.scale !== 1 && !el.rotation ? `${el.anchor[0] * 100}% ${el.anchor[1] * 100}%` : undefined,
    pointerEvents: el.empty ? "none" : "auto",
    touchAction: "none",
  };

  const children = el.children.map((c) => <Element key={c.id} el={c} ctx={ctx} />);
  return (
    <div
      className="absolute"
      style={style}
      data-gui-id={el.id}
      onPointerDown={(e) => {
        e.stopPropagation();
        ctx.startDrag(e, el, "move");
      }}
    >
      {el.image && <ImageView image={el.image} w={w} h={h} />}
      {el.scroll ? (
        <div
          className="absolute inset-0 overflow-auto"
          style={{ scrollbarWidth: el.scroll.bar > 0 ? "thin" : "none" }}
          ref={(node) => {
            if (node && node.dataset.init !== "1") {
              node.dataset.init = "1";
              node.scrollTo(el.scroll!.position[0], el.scroll!.position[1]);
            }
          }}
        >
          <div
            className="relative"
            style={{ width: el.scroll.canvas.w, height: el.scroll.canvas.h }}
          >
            {children}
          </div>
        </div>
      ) : (
        children
      )}
      {el.text && <Text text={el.text} pad={el.padding} />}
      {el.className === "ViewportFrame" && (
        <span className="pointer-events-none absolute left-1 top-1 text-[10px] text-white/50">
          ViewportFrame
        </span>
      )}
      {selected && (
        <>
          <div
            className="pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-blue-400"
            style={{ zIndex: 1e6 }}
          />
          {ctx.editable && (
            <div
              className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-sm border border-white bg-blue-500"
              style={{ zIndex: 1e6, touchAction: "none", pointerEvents: "auto" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                ctx.startDrag(e, el, "resize");
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * StarterGui's ScreenGuis drawn over the 3D view, like Studio. Tap a GUI object to select
 * it, drag to move it (changes Position's offset), and drag the corner handle to resize
 * (Size's offset). Invisible containers let clicks through to the 3D view.
 */
export function GuiOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const fonts = useFontsVersion();
  const doc = useDoc();
  const show = useEditor((s) => s.showGui);
  const rootId = useEditor((s) => s.rootId);
  const selection = useEditor((s) => s.selection);
  const readOnly = useEditor((s) => !!s.cloud?.readOnly);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The latest drag, updated straight away (state lags a render behind).
  const dragRef = useRef<Drag | null>(null);

  const starterGui = useMemo(() => {
    for (const c of doc.nodes.get(rootId ?? "")?.children ?? []) {
      if (doc.nodes.get(c)?.class === "StarterGui") return c;
    }
    return undefined;
  }, [doc, rootId]);

  const screens = useMemo(
    () => (show && size.w > 0 ? layoutScreens(doc, starterGui, size) : []),
    // `fonts` re-measures text once web fonts arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, starterGui, size, show, fonts],
  );
  const selected = useMemo(() => new Set(selection), [selection]);

  // Drag to move/resize: preview locally, commit one property change on release.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = { ...d, dx: e.clientX - d.x, dy: e.clientY - d.y };
      setDrag(dragRef.current);
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || (Math.abs(d.dx) <= 2 && Math.abs(d.dy) <= 2)) return;
      const key = d.kind === "move" ? "Position" : "Size";
      const current = doc.props(d.id)[key];
      if (current?.type !== "UDim2") return;
      const { x, y } = current.value;
      const value: Value = {
        type: "UDim2",
        value: {
          x: { scale: x.scale, offset: Math.round(x.offset + d.dx) },
          y: { scale: y.scale, offset: Math.round(y.offset + d.dy) },
        },
      };
      useEditor.getState().apply([{ type: "setProperty", target: d.id, key, value }]);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [drag, doc]);

  const ctx: Ctx = {
    selected,
    drag,
    editable: !readOnly,
    startDrag(e, el, kind) {
      const st = useEditor.getState();
      const additive = e.shiftKey || e.metaKey || e.ctrlKey || st.multiSelect;
      if (kind === "move") st.select(el.id, additive ? "toggle" : "replace");
      if (readOnly || additive || (kind === "move" && !el.movable)) return;
      dragRef.current = { id: el.id, kind, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      setDrag(dragRef.current);
    },
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {screens.map((s) => (
        <div
          key={s.id}
          className="absolute inset-x-0 bottom-0"
          style={{ top: s.top, zIndex: s.displayOrder + 1 }}
          data-gui-screen={s.name}
        >
          {s.elements.map((el) => (
            <Element key={el.id} el={el} ctx={ctx} />
          ))}
        </div>
      ))}
    </div>
  );
}
