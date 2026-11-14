"use client";

import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Edges, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useEditor } from "@/stores/editor";
import type { RenderPart } from "@/lib/types";

type V3 = [number, number, number];

/** Pointer travel (px) above which a press counts as a camera drag, not a click. */
const DRAG_THRESHOLD = 5;

type Vec = number[];
type Tri = [Vec, Vec, Vec];

/** Builds a flat-shaded convex mesh from triangles, flipping any that face inward. */
function solid(tris: Tri[]) {
  const center = new THREE.Vector3();
  for (const tri of tris) for (const v of tri) center.add(new THREE.Vector3(...v));
  center.divideScalar(tris.length * 3);

  const out: number[] = [];
  for (const tri of tris) {
    const [a, b, c] = tri.map((v) => new THREE.Vector3(...v));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const outward = new THREE.Vector3().addVectors(a, b).add(c).divideScalar(3).sub(center);
    const ordered = normal.dot(outward) >= 0 ? [a, b, c] : [a, c, b];
    for (const v of ordered) out.push(v.x, v.y, v.z);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

// Unit-cube corners: L/R = -x/+x, B/T = -y/+y, F/K = front (-z) / back (+z)
const LBF = [-0.5, -0.5, -0.5];
const RBF = [0.5, -0.5, -0.5];
const LBK = [-0.5, -0.5, 0.5];
const RBK = [0.5, -0.5, 0.5];
const LTK = [-0.5, 0.5, 0.5];
const RTK = [0.5, 0.5, 0.5];
const RTF = [0.5, 0.5, -0.5];
const BOTTOM: Tri[] = [
  [LBF, RBF, RBK],
  [LBF, RBK, LBK],
];

// Wedge: tall at the back, slope facing front.
const wedge = solid([
  ...BOTTOM,
  [LBK, RBK, RTK], // back
  [LBK, RTK, LTK],
  [LBF, LTK, RTK], // slope
  [LBF, RTK, RBF],
  [LBF, LBK, LTK], // left
  [RBF, RTK, RBK], // right
]);

// Corner wedge: square base, peak above the right-front corner.
const cornerWedge = solid([
  ...BOTTOM,
  [LBF, RBF, RTF], // front
  [RBF, RBK, RTF], // right
  [RBK, LBK, RTF], // back slope
  [LBK, LBF, RTF], // left slope
]);

// Shared unit geometries, scaled per part.
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(0.5, 24, 16);
const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).rotateZ(Math.PI / 2); // Roblox cylinders run along X

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
      return { geometry: wedge, scale: [x, y, z] };
    case "cornerWedge":
      return { geometry: cornerWedge, scale: [x, y, z] };
    default:
      return { geometry: box, scale: [x, y, z] };
  }
}

/** id -> mesh, so the camera can frame a selected part. */
const meshes = new Map<string, THREE.Object3D>();

function PartMesh({ part }: { part: RenderPart }) {
  const selected = useEditor((s) => s.selectedId === part.id);
  const select = useEditor((s) => s.select);
  const focusSelected = useEditor((s) => s.focusSelected);

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
        ref={(m) => {
          if (m) meshes.set(part.id, m);
          return () => {
            meshes.delete(part.id);
          };
        }}
        geometry={geometry}
        scale={scale}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (e.delta <= DRAG_THRESHOLD) select(part.id);
        }}
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          select(part.id);
          focusSelected();
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
        {selected && <Edges color="#f5a524" />}
      </mesh>
    </group>
  );
}

/** Frames the selected part whenever the store's focusRequest is bumped. */
function FocusController() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update: () => void;
  } | null;
  const focusRequest = useEditor((s) => s.focusRequest);

  useEffect(() => {
    if (!focusRequest || !controls) return;
    const { selectedId } = useEditor.getState();
    const mesh = selectedId ? meshes.get(selectedId) : undefined;
    if (!mesh) return;

    const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 70);
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.25;
    // Keep the current viewing angle, just move in on the part.
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    controls.update();
  }, [focusRequest, camera, controls]);

  return null;
}

export function Viewport() {
  const parts = useEditor((s) => s.parts);
  const rootId = useEditor((s) => s.rootId);
  const select = useEditor((s) => s.select);
  const down = useRef<{ x: number; y: number } | null>(null);

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY };
      }}
    >
      <Canvas
        className="touch-none"
        camera={{ position: [40, 30, 40], fov: 70, near: 0.1, far: 10000 }}
        onPointerMissed={(e) => {
          // Ignore the click that ends an orbit/pan drag.
          const start = down.current;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD)
            return;
          select(null);
        }}
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
        <FocusController />
      </Canvas>
    </div>
  );
}
