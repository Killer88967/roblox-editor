/**
 * Rough three.js stand-ins for Roblox materials. Roblox uses textures and normal maps
 * for these; without the assets we approximate each one with roughness/metalness
 * (and glow for Neon), which is enough to tell them apart at a glance.
 */
export type MaterialLook = {
  roughness: number;
  metalness: number;
  /** Neon: the part glows in its own color. */
  emissive?: boolean;
  /** ForceField: a see-through shimmer. */
  forceField?: boolean;
};

const LOOKS: Record<string, MaterialLook> = {
  Plastic: { roughness: 0.75, metalness: 0 },
  SmoothPlastic: { roughness: 0.45, metalness: 0 },
  Neon: { roughness: 1, metalness: 0, emissive: true },
  Glass: { roughness: 0.05, metalness: 0.1 },
  ForceField: { roughness: 1, metalness: 0, forceField: true },

  Metal: { roughness: 0.35, metalness: 0.9 },
  DiamondPlate: { roughness: 0.4, metalness: 0.9 },
  CorrodedMetal: { roughness: 0.75, metalness: 0.7 },
  Foil: { roughness: 0.2, metalness: 1 },

  Wood: { roughness: 0.8, metalness: 0 },
  WoodPlanks: { roughness: 0.8, metalness: 0 },
  Marble: { roughness: 0.3, metalness: 0 },
  Granite: { roughness: 0.6, metalness: 0 },
  Slate: { roughness: 0.85, metalness: 0 },
  Concrete: { roughness: 0.9, metalness: 0 },
  Brick: { roughness: 0.9, metalness: 0 },
  Pebble: { roughness: 0.85, metalness: 0 },
  Cobblestone: { roughness: 0.9, metalness: 0 },
  Rock: { roughness: 0.9, metalness: 0 },
  Sandstone: { roughness: 0.85, metalness: 0 },
  Basalt: { roughness: 0.85, metalness: 0 },
  CrackedLava: { roughness: 0.7, metalness: 0 },
  Limestone: { roughness: 0.8, metalness: 0 },
  Pavement: { roughness: 0.9, metalness: 0 },
  Asphalt: { roughness: 0.9, metalness: 0 },
  Salt: { roughness: 0.7, metalness: 0 },

  Grass: { roughness: 0.95, metalness: 0 },
  LeafyGrass: { roughness: 0.95, metalness: 0 },
  Sand: { roughness: 1, metalness: 0 },
  Ground: { roughness: 0.95, metalness: 0 },
  Mud: { roughness: 0.95, metalness: 0 },
  Snow: { roughness: 0.9, metalness: 0 },
  Ice: { roughness: 0.15, metalness: 0 },
  Glacier: { roughness: 0.2, metalness: 0 },

  Fabric: { roughness: 1, metalness: 0 },
  Carpet: { roughness: 1, metalness: 0 },
  Cardboard: { roughness: 0.95, metalness: 0 },
  Leather: { roughness: 0.6, metalness: 0 },
  Rubber: { roughness: 0.85, metalness: 0 },
  Plaster: { roughness: 0.9, metalness: 0 },
  CeramicTiles: { roughness: 0.3, metalness: 0 },
  ClayRoofTiles: { roughness: 0.7, metalness: 0 },
  RoofShingles: { roughness: 0.9, metalness: 0 },
};

/** The look for a part, including its Reflectance (0-1). */
export function materialLook(name: string | undefined, reflectance: number): MaterialLook {
  const base = (name && LOOKS[name]) || LOOKS.Plastic;
  if (reflectance <= 0) return base;
  const r = Math.min(1, reflectance);
  return {
    ...base,
    roughness: base.roughness * (1 - r * 0.8),
    metalness: Math.max(base.metalness, r),
  };
}
