type V3 = [number, number, number];

export type Value =
  | { type: "Bool"; value: boolean }
  | { type: "String"; value: string }
  | { type: "Int32" | "Int64" | "Float32" | "Float64"; value: number }
  | { type: "Vector2"; value: [number, number] }
  | { type: "Vector3" | "Color3"; value: V3 }
  | { type: "Color3uint8"; value: V3 }
  | { type: "CFrame"; value: { position: V3; orientation: [V3, V3, V3] } }
  | { type: "BrickColor" | "Enum"; value: number }
  | { type: "Ref"; value?: string }
  | { type: "Unsupported"; value: string };

export type NodeInfo = {
  id: string;
  class: string;
  name: string;
  parent?: string;
  children: string[];
};

export type PropertyInfo = { key: string; value: Value };

export type JsOp =
  | { type: "create"; parent: string; class: string; name: string }
  | { type: "delete"; target: string }
  | { type: "setName"; target: string; name: string }
  | { type: "setProperty"; target: string; key: string; value?: Value }
  | { type: "reparent"; target: string; parent: string };

export type RenderPart = {
  id: string;
  shape: "block" | "ball" | "cylinder" | "wedge" | "cornerWedge" | "placeholder";
  size: V3;
  matrix: number[];
  color: V3;
  transparency: number;
  material: number;
};

const round = (n: number) => +n.toFixed(3);

export function formatValue(v: Value): string {
  switch (v.type) {
    case "Vector2":
    case "Vector3":
      return v.value.map(round).join(", ");
    case "Color3":
      return v.value.map((n) => Math.round(n * 255)).join(", ");
    case "Color3uint8":
      return v.value.join(", ");
    case "CFrame":
      return v.value.position.map(round).join(", ");
    case "Ref":
      return v.value ?? "nil";
    case "Unsupported":
      return `<${v.value}>`;
    default:
      return String(v.value);
  }
}
