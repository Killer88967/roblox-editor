import type { Value } from "@/lib/types";

/** A GUI instance's properties by name. */
export type Props = Record<string, Value | undefined>;

export type UDim = { scale: number; offset: number };
export type UDim2 = { x: UDim; y: UDim };

const ZERO_UDIM: UDim = { scale: 0, offset: 0 };

export const num = (p: Props, key: string, fallback = 0): number => {
  const v = p[key];
  return v && typeof v.value === "number" ? v.value : fallback;
};
export const bool = (p: Props, key: string, fallback = false): boolean => {
  const v = p[key];
  return v?.type === "Bool" ? v.value : fallback;
};
export const str = (p: Props, key: string, fallback = ""): string => {
  const v = p[key];
  return v?.type === "String" || v?.type === "Content" || v?.type === "ContentId"
    ? v.value
    : fallback;
};
export const color = (p: Props, key: string, fallback: [number, number, number] = [1, 1, 1]) => {
  const v = p[key];
  if (v?.type === "Color3") return v.value;
  if (v?.type === "Color3uint8") return v.value.map((n) => n / 255) as [number, number, number];
  return fallback;
};
export const vec2 = (p: Props, key: string, fallback: [number, number] = [0, 0]) => {
  const v = p[key];
  return v?.type === "Vector2" ? v.value : fallback;
};
export const udim = (p: Props, key: string, fallback = ZERO_UDIM): UDim => {
  const v = p[key];
  return v?.type === "UDim" ? v.value : fallback;
};
export const udim2 = (p: Props, key: string, fallback?: UDim2): UDim2 => {
  const v = p[key];
  return v?.type === "UDim2" ? v.value : (fallback ?? { x: ZERO_UDIM, y: ZERO_UDIM });
};

/** CSS rgba() for a 0–1 color and a Roblox transparency (0 = opaque). */
export const rgba = ([r, g, b]: readonly number[], transparency = 0) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${+(1 - transparency).toFixed(3)})`;
