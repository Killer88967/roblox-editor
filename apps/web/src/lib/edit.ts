import type { Value } from "./types";

type Vec3 = [number, number, number];

/** Every number in a string, e.g. "{0.5, 10}, {0, -4}" -> [0.5, 10, 0, -4]. */
const nums = (s: string) =>
  s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Value types the panel can edit with a text field. */
export const TEXT_EDITABLE = new Set<Value["type"]>([
  "String",
  "Int32",
  "Int64",
  "Float32",
  "Float64",
  "Vector2",
  "Vector3",
  "Color3",
  "Color3uint8",
  "CFrame",
  "UDim",
  "UDim2",
]);

/**
 * Parses what the user typed into a new value of the same type as `prev`.
 * Returns null if it doesn't parse.
 */
export function parseValue(prev: Value, text: string): Value | null {
  const n = nums(text);
  switch (prev.type) {
    case "String":
      return { type: "String", value: text };
    case "Int32":
    case "Int64":
      return n.length === 1
        ? { type: prev.type, value: Math.trunc(n[0]) }
        : null;
    case "Float32":
    case "Float64":
      return n.length === 1 ? { type: prev.type, value: n[0] } : null;
    case "Vector2":
      return n.length === 2 ? { type: "Vector2", value: [n[0], n[1]] } : null;
    case "Vector3":
      return n.length === 3
        ? { type: "Vector3", value: [n[0], n[1], n[2]] }
        : null;
    case "Color3": // typed as 0-255 like Studio, stored as 0-1
      return n.length === 3
        ? {
            type: "Color3",
            value: [n[0], n[1], n[2]].map(
              (c) => clamp(c, 0, 255) / 255,
            ) as Vec3,
          }
        : null;
    case "Color3uint8":
      return n.length === 3
        ? {
            type: "Color3uint8",
            value: [n[0], n[1], n[2]].map((c) =>
              Math.round(clamp(c, 0, 255)),
            ) as Vec3,
          }
        : null;
    case "CFrame": // edits position only, keeps rotation
      return n.length === 3
        ? {
            type: "CFrame",
            value: { ...prev.value, position: [n[0], n[1], n[2]] },
          }
        : null;
    case "UDim":
      return n.length === 2
        ? { type: "UDim", value: { scale: n[0], offset: Math.trunc(n[1]) } }
        : null;
    case "UDim2":
      return n.length === 4
        ? {
            type: "UDim2",
            value: {
              x: { scale: n[0], offset: Math.trunc(n[1]) },
              y: { scale: n[2], offset: Math.trunc(n[3]) },
            },
          }
        : null;
    default:
      return null;
  }
}

const hex2 = (n: number) =>
  Math.round(clamp(n, 0, 255))
    .toString(16)
    .padStart(2, "0");

/** Color value -> "#rrggbb" for <input type="color">. */
export function toHex(v: Value): string | null {
  if (v.type === "Color3")
    return "#" + v.value.map((c) => hex2(c * 255)).join("");
  if (v.type === "Color3uint8") return "#" + v.value.map(hex2).join("");
  return null;
}

/** "#rrggbb" -> a value of the same color type as `prev`. */
export function fromHex(prev: Value, hex: string): Value | null {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Vec3;
  if (prev.type === "Color3")
    return { type: "Color3", value: rgb.map((c) => c / 255) as Vec3 };
  if (prev.type === "Color3uint8") return { type: "Color3uint8", value: rgb };
  return null;
}
