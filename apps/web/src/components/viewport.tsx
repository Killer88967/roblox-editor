"use client";

import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { Bounds, Edges, OrbitControls, TransformControls } from "@react-three/drei";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useEditor } from "@/stores/editor";
import { viewportApi } from "@/lib/viewport-api";
import type { JsOp, NodeInfo, RenderPart, Value } from "@/lib/types";

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

/** id -> part group (holds the CFrame) and mesh (holds the size), for gizmos and framing. */
const groups = new Map<string, THREE.Group>();
const meshes = new Map<string, THREE.Mesh>();

type OrbitLike = { target: THREE.Vector3; update: () => void; enabled: boolean };

/**
 * Which instance a click on a part should select: like Studio, the outermost Model
 * the part is in (below Workspace), unless Alt/Option is held.
 */
function clickTarget(partId: string, nodes: Map<string, NodeInfo>, direct: boolean) {
  if (direct) return partId;
  let target = partId;
  for (let p = nodes.get(partId)?.parent; p; p = nodes.get(p)?.parent) {
    const node = nodes.get(p);
    if (!node || node.class === "Workspace") break;
    if (node.class === "Model") target = p;
  }
  return target;
}

/** Part ids affected by the selection: selected parts plus parts inside selected models. */
function affectedParts(
  selection: string[],
  nodes: Map<string, NodeInfo>,
  parts: Map<string, RenderPart>,
) {
  const out = new Set<string>();
  const stack = [...selection];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    if (parts.has(id)) out.add(id);
    stack.push(...(nodes.get(id)?.children ?? []));
  }
  return out;
}

const PartMesh = memo(function PartMesh({
  part,
  selected,
}: {
  part: RenderPart;
  selected: boolean;
}) {
  const matrix = useMemo(() => new THREE.Matrix4().fromArray(part.matrix), [part.matrix]);
  const color = useMemo(
    () => new THREE.Color().setRGB(...part.color, THREE.SRGBColorSpace),
    [part.color],
  );
  const { geometry, scale } = shapeOf(part);
  const transparent = part.transparency > 0;

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > DRAG_THRESHOLD) return;
    const { nodes, select, multiSelect } = useEditor.getState();
    const ev = e.nativeEvent;
    const id = clickTarget(part.id, nodes, ev.altKey);
    select(
      id,
      ev.metaKey || ev.ctrlKey || multiSelect ? "toggle" : ev.shiftKey ? "add" : "replace",
    );
  };

  return (
    <group
      ref={(g) => {
        if (g) groups.set(part.id, g);
        return () => {
          groups.delete(part.id);
        };
      }}
      matrix={matrix}
      matrixAutoUpdate={false}
    >
      <mesh
        ref={(m) => {
          if (m) meshes.set(part.id, m);
          return () => {
            meshes.delete(part.id);
          };
        }}
        geometry={geometry}
        scale={scale}
        onClick={onClick}
        onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const { nodes, select, focusSelected } = useEditor.getState();
          select(clickTarget(part.id, nodes, e.nativeEvent.altKey));
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
});

/** Bounding box of these parts in world space. */
function boundsOf(ids: Iterable<string>) {
  const box = new THREE.Box3();
  for (const id of ids) {
    const mesh = meshes.get(id);
    if (mesh) box.expandByObject(mesh);
  }
  return box;
}

/** Frames the selection when focusRequest is bumped; tells the store where the camera looks. */
function FocusController({ affected }: { affected: Set<string> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const focusRequest = useEditor((s) => s.focusRequest);
  const affectedRef = useRef(affected);

  useEffect(() => {
    affectedRef.current = affected;
  }, [affected]);

  useEffect(() => {
    if (!controls) return;
    viewportApi.focusPoint = () => controls.target.toArray() as [number, number, number];
  }, [controls]);

  useEffect(() => {
    if (!focusRequest || !controls) return;
    const box = boundsOf(affectedRef.current);
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 70);
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.25;
    // Keep the current viewing angle, just move in on the selection.
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, distance);
    controls.update();
  }, [focusRequest, camera, controls]);

  return null;
}

const COARSE = "(pointer: coarse)";
function useCoarsePointer() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(COARSE);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(COARSE).matches,
    () => false,
  );
}

/** three.js matrix -> Roblox CFrame value (rotation rows + position), dropping any scale. */
function toCFrame(m: THREE.Matrix4): Value {
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  m.decompose(pos, quat, new THREE.Vector3());
  const e = new THREE.Matrix4().makeRotationFromQuaternion(quat).elements;
  const r = (n: number) => (Math.abs(n) < 1e-6 ? 0 : n);
  return {
    type: "CFrame",
    value: {
      position: [pos.x, pos.y, pos.z],
      orientation: [
        [r(e[0]), r(e[4]), r(e[8])],
        [r(e[1]), r(e[5]), r(e[9])],
        [r(e[2]), r(e[6]), r(e[10])],
      ],
    },
  };
}

const roundTo = (n: number, step: number) => (step > 0 ? Math.round(n / step) * step : n);

/**
 * Move/rotate/scale gizmo. It drives an invisible proxy object; while dragging, the
 * selected parts follow it directly in three.js, and on release the result is committed
 * as one batch of ops (one undo step).
 */
function TransformGizmo({ affected }: { affected: Set<string> }) {
  const tool = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const parts = useEditor((s) => s.parts);
  const coarse = useCoarsePointer();
  const [proxy] = useState(() => new THREE.Object3D());
  const dragging = useRef(false);
  const start = useRef<{
    proxy: THREE.Matrix4;
    groups: Map<string, THREE.Matrix4>;
    scales: Map<string, THREE.Vector3>;
  } | null>(null);

  const ids = useMemo(() => [...affected], [affected]);
  const single = ids.length === 1 ? ids[0] : null;
  const active = tool !== "select" && ids.length > 0 && !(tool === "scale" && !single);

  // Put the proxy on the selection: on the part itself for one part, else at the center.
  useEffect(() => {
    if (!active || dragging.current) return;
    if (single) {
      const part = parts.get(single);
      if (!part) return;
      new THREE.Matrix4()
        .fromArray(part.matrix)
        .decompose(proxy.position, proxy.quaternion, proxy.scale);
    } else {
      boundsOf(ids).getCenter(proxy.position);
      proxy.quaternion.identity();
    }
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld();
  }, [active, single, ids, parts, proxy]);

  if (!active) return null;

  const onDragStart = () => {
    dragging.current = true;
    proxy.updateMatrixWorld();
    start.current = {
      proxy: proxy.matrixWorld.clone(),
      groups: new Map(
        ids.flatMap((id) => (groups.get(id) ? [[id, groups.get(id)!.matrix.clone()]] : [])),
      ),
      scales: new Map(
        ids.flatMap((id) => (meshes.get(id) ? [[id, meshes.get(id)!.scale.clone()]] : [])),
      ),
    };
  };

  const onChange = () => {
    const s = start.current;
    if (!s) return;
    proxy.updateMatrixWorld();
    if (tool === "scale" && single) {
      const mesh = meshes.get(single);
      const base = s.scales.get(single);
      if (mesh && base) mesh.scale.copy(base).multiply(proxy.scale);
      return;
    }
    const delta = proxy.matrixWorld.clone().multiply(s.proxy.clone().invert());
    for (const [id, m] of s.groups) {
      const g = groups.get(id);
      if (!g) continue;
      g.matrix.copy(delta).multiply(m);
      g.matrixWorldNeedsUpdate = true;
    }
  };

  const onDragEnd = () => {
    const s = start.current;
    dragging.current = false;
    start.current = null;
    if (!s) return;

    const ops: JsOp[] = [];
    if (tool === "scale" && single) {
      const part = parts.get(single);
      if (part) {
        const size = part.size.map((v, i) => {
          const factor = proxy.scale.getComponent(i);
          // Leave axes the handle didn't touch exactly as they were.
          if (Math.abs(factor - 1) < 1e-6) return v;
          const scaled = Math.abs(v * factor);
          return Math.max(0.001, snap.enabled ? roundTo(scaled, snap.move) || snap.move : scaled);
        }) as [number, number, number];
        if (size.some((v, i) => Math.abs(v - part.size[i]) > 1e-6)) {
          ops.push({
            type: "setProperty",
            target: single,
            key: "Size",
            value: { type: "Vector3", value: size },
          });
        }
      }
      proxy.scale.set(1, 1, 1);
    } else {
      for (const [id, before] of s.groups) {
        const g = groups.get(id);
        if (g && !g.matrix.equals(before)) {
          ops.push({ type: "setProperty", target: id, key: "CFrame", value: toCFrame(g.matrix) });
        }
      }
    }

    if (ops.length) useEditor.getState().apply(ops);

    // Put everything back to the committed state (or the original, if nothing changed
    // or the edit failed). React re-applies props only when the data actually changed.
    const latest = useEditor.getState().parts;
    for (const [id, before] of s.groups) {
      const g = groups.get(id);
      const part = latest.get(id);
      if (g) {
        g.matrix.copy(part ? new THREE.Matrix4().fromArray(part.matrix) : before);
        g.matrixWorldNeedsUpdate = true;
      }
    }
    for (const [id, base] of s.scales) {
      const mesh = meshes.get(id);
      const part = latest.get(id);
      if (mesh && part) {
        mesh.scale.copy(shapeVector(part));
      } else if (mesh) {
        mesh.scale.copy(base);
      }
    }
  };

  return (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={tool === "move" ? "translate" : tool === "rotate" ? "rotate" : "scale"}
        space={single ? "local" : "world"}
        size={coarse ? 1.5 : 1}
        translationSnap={snap.enabled ? snap.move : null}
        rotationSnap={snap.enabled ? THREE.MathUtils.degToRad(snap.rotate) : null}
        onMouseDown={onDragStart}
        onObjectChange={onChange}
        onMouseUp={onDragEnd}
      />
    </>
  );
}

function shapeVector(part: RenderPart) {
  return new THREE.Vector3(...shapeOf(part).scale);
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Drag a selection box: Shift+drag on desktop, or any drag while the Box toggle is on.
 * Selects every part whose center lands inside the box.
 */
function BoxSelect({ onRect }: { onRect: (rect: Rect | null) => void }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;

  useEffect(() => {
    const el = gl.domElement;
    let origin: { x: number; y: number; additive: boolean } | null = null;

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const down = (e: PointerEvent) => {
      const { tool, boxSelect } = useEditor.getState();
      if (tool !== "select" || !(e.shiftKey || boxSelect) || e.button !== 0) return;
      origin = { ...local(e), additive: e.shiftKey };
      if (controls) controls.enabled = false;
      el.setPointerCapture(e.pointerId);
    };

    const move = (e: PointerEvent) => {
      if (!origin) return;
      const p = local(e);
      onRect({
        x: Math.min(origin.x, p.x),
        y: Math.min(origin.y, p.y),
        w: Math.abs(p.x - origin.x),
        h: Math.abs(p.y - origin.y),
      });
    };

    const up = (e: PointerEvent) => {
      if (!origin) return;
      const o = origin;
      origin = null;
      onRect(null);
      if (controls) controls.enabled = true;
      const p = local(e);
      // A short press is a click, handled by the part/miss handlers instead.
      if (Math.hypot(p.x - o.x, p.y - o.y) <= DRAG_THRESHOLD) return;

      const [x0, x1] = [Math.min(o.x, p.x), Math.max(o.x, p.x)];
      const [y0, y1] = [Math.min(o.y, p.y), Math.max(o.y, p.y)];
      const { width, height } = el.getBoundingClientRect();
      const { nodes } = useEditor.getState();
      const hits = new Set<string>();
      const v = new THREE.Vector3();
      for (const [id, g] of groups) {
        v.setFromMatrixPosition(g.matrixWorld).project(camera);
        if (v.z > 1) continue; // behind the camera
        const sx = ((v.x + 1) / 2) * width;
        const sy = ((1 - v.y) / 2) * height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hits.add(clickTarget(id, nodes, false));
      }
      useEditor.getState().selectMany([...hits], o.additive || useEditor.getState().multiSelect);
    };

    // Capture phase, so this runs before OrbitControls sees the press.
    el.addEventListener("pointerdown", down, { capture: true });
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down, { capture: true });
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [camera, gl, controls, onRect]);

  return null;
}

export function Viewport() {
  const parts = useEditor((s) => s.parts);
  const nodes = useEditor((s) => s.nodes);
  const selection = useEditor((s) => s.selection);
  const rootId = useEditor((s) => s.rootId);
  const down = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const affected = useMemo(() => affectedParts(selection, nodes, parts), [selection, nodes, parts]);
  const list = useMemo(() => [...parts.values()], [parts]);

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
          // Ignore the click that ends an orbit/pan/box drag, or a modifier click.
          const start = down.current;
          if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD)
            return;
          if (e.shiftKey || e.metaKey || e.ctrlKey) return;
          useEditor.getState().select(null);
        }}
      >
        <color attach="background" args={["#1b1f27"]} />
        <hemisphereLight args={["#ffffff", "#3a3a3a", 1.2]} />
        <directionalLight position={[50, 100, 30]} intensity={1.5} />
        <Bounds key={rootId ?? "none"} fit clip margin={1.2}>
          {list.map((p) => (
            <PartMesh key={p.id} part={p} selected={affected.has(p.id)} />
          ))}
        </Bounds>
        <OrbitControls makeDefault />
        <FocusController affected={affected} />
        <TransformGizmo affected={affected} />
        <BoxSelect onRect={setRect} />
      </Canvas>
      {rect && (
        <div
          className="pointer-events-none absolute border border-blue-400 bg-blue-400/15"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
        />
      )}
    </div>
  );
}
