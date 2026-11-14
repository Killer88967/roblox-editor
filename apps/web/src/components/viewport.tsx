"use client";

import { Canvas } from "@react-three/fiber";
import { Bounds, Edges, OrbitControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { useEditor } from "@/stores/editor";
import type { RenderPart } from "@/lib/types";

type V3 = [number, number, number];

function makeWedge() {
  const A = [-0.5, -0.5, -0.5],
    B = [0.5, -0.5, -0.5];
  const C = [-0.5, -0.5, 0.5],
    D = [0.5, -0.5, 0.5];
  const E = [-0.5, 0.5, 0.5],
    F = [0.5, 0.5, 0.5];
  // bottom, back, slope, left, right (wound so normals face outward)
  const tris = [A, B, D, A, D, C, C, D, F, C, F, E, A, E, F, A, F, B, A, C, E, B, F, D];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

// Shared unit geometries, scaled per part.
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(0.5, 24, 16);
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).rotateZ(Math.PI / 2); // Roblox cylinders run along X
const wedge = makeWedge();

function shapeOf(part: RenderPart): { geometry: THREE.BufferGeometry; scale: V3 } {
  const [x, y, z] = part.size;
  switch (part.shape) {
    case "ball": {
      const d = Math.min(x, y, z);
      return { geometry: sphere, scale: [d, d, d] };
    }
    case "cylinder": {
      const d = Math.min(y, z);
      return { geometry: cylinder, scale: [x, d, d] };
    }
    case "wedge":
    case "cornerWedge":
      return { geometry: wedge, scale: [x, y, z] };
    default:
      return { geometry: box, scale: [x, y, z] };
  }
}

function PartMesh({ part }: { part: RenderPart }) {
  const selected = useEditor((s) => s.selectedId === part.id);
  const select = useEditor((s) => s.select);

  const matrix = useMemo(() => new THREE.Matrix4().fromArray(part.matrix), [part.matrix]);
  const color = useMemo(
    () => new THREE.Color().setRGB(...part.color, THREE.SRGBColorSpace),
    [part.color],
  );
  const { geometry, scale } = shapeOf(part);
  const transparent = part.transparency > 0;

  return (
    <group matrix={matrix} matrixAutoUpdate={false}>
      <mesh
        geometry={geometry}
        scale={scale}
        onClick={(e) => {
          e.stopPropagation();
          select(part.id);
        }}
      >
        <meshStandardMaterial
          color={color}
          roughness={0.8}
          wireframe={part.shape === "placeholder"}
          transparent={transparent}
          opacity={1 - part.transparency}
          depthWrite={!transparent}
        />
        {selected && <Edges color="#3b82f6" />}
      </mesh>
    </group>
  );
}

export function Viewport() {
  const parts = useEditor((s) => s.parts);
  const rootId = useEditor((s) => s.rootId);
  const select = useEditor((s) => s.select);

  return (
    <Canvas
      className="touch-none"
      camera={{ position: [40, 30, 40], fov: 70, near: 0.1, far: 10000 }}
      onPointerMissed={() => select(null)}
    >
      <color attach="background" args={["#1b1f27"]} />
      <hemisphereLight args={["#ffffff", "#3a3a3a", 1.2]} />
      <directionalLight position={[50, 100, 30]} intensity={1.5} />
      <Bounds key={rootId ?? "none"} fit clip margin={1.2}>
        {parts.map((p) => (
          <PartMesh key={p.id} part={p} />
        ))}
      </Bounds>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
