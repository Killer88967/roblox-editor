type V3 = [number, number, number];
type UDim = { scale: number; offset: number };

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
  | { type: "UDim"; value: UDim }
  | { type: "UDim2"; value: { x: UDim; y: UDim } }
  /** Asset URI like "rbxassetid://123" ("" = none). */
  | { type: "Content" | "ContentId"; value: string }
  | { type: "Unsupported"; value: { ty: string; text: string } };

export type NodeInfo = {
  id: string;
  class: string;
  name: string;
  parent?: string;
  children: string[];
};

export type PropertyInfo = {
  key: string;
  value: Value;
  /** Enum item name, e.g. "Plastic" for Material 256. */
  enumItem?: string;
  /** Studio hides this (deprecated, internal, or not scriptable). */
  hidden: boolean;
};

export type JsOp =
  | {
      type: "create";
      parent: string;
      class: string;
      name: string;
      /** Overrides on top of the class defaults. */
      properties?: Record<string, Value>;
      /** From WasmEditor.newId(), so later ops in the same batch can target it. */
      id?: string;
    }
  | { type: "paste"; parent: string; model: Uint8Array }
  | { type: "delete"; target: string }
  | { type: "setName"; target: string; name: string }
  | { type: "setProperty"; target: string; key: string; value?: Value }
  | { type: "reparent"; target: string; parent: string };

export type SubtreeRender = { ids: string[]; parts: RenderPart[] };

export type MeshInfo = {
  /** SpecialMesh MeshType name: "Brick", "Sphere", "Cylinder", "Wedge", "Head", "FileMesh", ... */
  kind: string;
  scale: V3;
  offset: V3;
};

export type DecalInfo = {
  face: "Right" | "Top" | "Back" | "Left" | "Bottom" | "Front";
  color: V3;
  transparency: number;
  /** The image as a content URI (e.g. "rbxassetid://123"); "" if none. */
  texture: string;
  /** Texture only: studs per tile (U, V). Null for a Decal, which stretches over the face. */
  tile: [number, number] | null;
  /** Texture only: tile offset in studs (U, V). */
  offset: [number, number];
};

export type LightingInfo = {
  id?: string;
  ambient: V3;
  outdoorAmbient: V3;
  brightness: number;
  /** Hours, 0-24. */
  clockTime: number;
  geographicLatitude: number;
  fogColor: V3;
  fogStart: number;
  fogEnd: number;
  atmosphere?: { density: number; haze: number; color: V3 };
  hasSky: boolean;
};

export type RenderPart = {
  id: string;
  shape: "block" | "ball" | "cylinder" | "wedge" | "cornerWedge" | "placeholder";
  size: V3;
  matrix: number[];
  color: V3;
  transparency: number;
  material: number;
  /** Material enum name, e.g. "Neon". */
  materialName?: string;
  reflectance: number;
  mesh?: MeshInfo;
  decals: DecalInfo[];
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
    case "UDim":
      return `${round(v.value.scale)}, ${v.value.offset}`;
    case "UDim2": {
      const { x, y } = v.value;
      return `{${round(x.scale)}, ${x.offset}}, {${round(y.scale)}, ${y.offset}}`;
    }
    case "Content":
    case "ContentId":
      return v.value;
    case "Unsupported":
      return v.value.text;
    default:
      return String(v.value);
  }
}

export function swatch(v: Value): string | null {
  if (v.type === "Color3") return `rgb(${v.value.map((n) => Math.round(n * 255)).join(",")})`;
  if (v.type === "Color3uint8") return `rgb(${v.value.join(",")})`;
  return null;
}
