"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { useEditor } from "@/stores/editor";
import type { LightingInfo } from "@/lib/types";

const srgb = (c: [number, number, number]) => new THREE.Color().setRGB(...c, THREE.SRGBColorSpace);

/** Direction the sun shines from, from the time of day and latitude (a simple model). */
function sunDirection(clockTime: number, latitude: number) {
  // 6:00 sunrise in the east (+X), noon overhead-ish, 18:00 sunset in the west.
  const angle = ((clockTime - 6) / 12) * Math.PI;
  const tilt = THREE.MathUtils.degToRad(latitude);
  return new THREE.Vector3(
    Math.cos(angle),
    Math.sin(angle) * Math.cos(tilt),
    Math.sin(angle) * Math.sin(tilt) * 0.5 + 0.2,
  ).normalize();
}

/**
 * Lights, sky and fog that follow the place's Lighting service: time of day, Brightness,
 * Ambient/OutdoorAmbient, fog, and Atmosphere haze. An approximation, not Studio's renderer.
 */
export function SceneLighting() {
  const lighting = useEditor((s) => s.lighting);
  const look = useMemo(() => describe(lighting), [lighting]);

  return (
    <>
      <color attach="background" args={[look.horizon]} />
      <GradientSky zenith={look.zenith} horizon={look.horizon} />

      <hemisphereLight args={[look.sky, look.ground, look.hemi]} />
      <ambientLight color={look.ambient} intensity={0.35} />
      <directionalLight
        position={look.sun.clone().multiplyScalar(200).toArray()}
        intensity={look.sunIntensity}
        color={look.day ? "#fff6e5" : "#9db4ff"}
      />

      {/* A soft studio-style environment so metal and glossy materials have something to reflect. */}
      <Environment resolution={64} frames={1}>
        <color attach="background" args={[look.envColor]} />
        <Lightformer intensity={1.2} position={[0, 5, -5]} scale={[10, 4, 1]} />
        <Lightformer intensity={0.6} position={[-5, 2, 3]} scale={[6, 6, 1]} />
        <Lightformer intensity={0.4} position={[5, -2, 3]} scale={[6, 6, 1]} color="#bcd" />
      </Environment>

      {look.fog?.kind === "linear" && (
        <fog attach="fog" args={[look.fog.color, look.fog.start, look.fog.end]} />
      )}
      {look.fog?.kind === "exp" && (
        <fogExp2 attach="fog" args={[look.fog.color, look.fog.density]} />
      )}
    </>
  );
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  varying vec3 vDir;
  void main() {
    float t = pow(max(vDir.y, 0.0), 0.55);
    gl_FragColor = vec4(mix(horizon, zenith, t), 1.0);
    #include <colorspace_fragment>
  }
`;

/** A simple sky dome: horizon color fading up to the zenith color, like Studio's default sky. */
function GradientSky({ zenith, horizon }: { zenith: THREE.Color; horizon: THREE.Color }) {
  const uniforms = useMemo(
    () => ({ zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } }),
    [],
  );
  uniforms.zenith.value.copy(zenith);
  uniforms.horizon.value.copy(horizon);
  return (
    <mesh scale={4000} renderOrder={-1} raycast={() => null}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={SKY_VERTEX}
        fragmentShader={SKY_FRAGMENT}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

type Look = {
  day: boolean;
  sun: THREE.Vector3;
  sunIntensity: number;
  sky: THREE.Color;
  ground: THREE.Color;
  ambient: THREE.Color;
  hemi: number;
  night: string;
  zenith: THREE.Color;
  horizon: THREE.Color;
  /** Base color the environment map reflects (sky-ish by day, dark at night). */
  envColor: string;
  haze: boolean;
  fog?:
    | { kind: "linear"; color: THREE.Color; start: number; end: number }
    | { kind: "exp"; color: THREE.Color; density: number };
};

/** Sky gradient colors for the sun's height: blue by day, warm near sunrise/sunset, dark at night. */
function skyColors(day: boolean, sunY: number, haze?: [number, number, number]) {
  if (!day) return { zenith: new THREE.Color("#050814"), horizon: new THREE.Color("#141c33") };
  const zenith = new THREE.Color("#3a86d4");
  const horizon = new THREE.Color("#b8d8f0");
  // Golden hour: warm the horizon and deepen the zenith as the sun gets low.
  const low = THREE.MathUtils.clamp(1 - sunY / 0.35, 0, 1);
  horizon.lerp(new THREE.Color("#f2a46b"), low * 0.8);
  zenith.lerp(new THREE.Color("#3b4f86"), low * 0.6);
  if (haze) horizon.lerp(srgb(haze), 0.3);
  return { zenith, horizon };
}

function describe(l: LightingInfo | null): Look {
  const clockTime = l?.clockTime ?? 14;
  const sunDir = sunDirection(clockTime, l?.geographicLatitude ?? 41.7);
  const day = sunDir.y > -0.05;
  // Moonlight comes from the opposite side at night.
  const sun = day ? sunDir : sunDir.clone().negate();
  const elevation = Math.max(0, sun.y);
  const brightness = l?.brightness ?? 2;

  const outdoor = srgb(l?.outdoorAmbient ?? [0.5, 0.5, 0.5]);
  const ambient = srgb(l?.ambient ?? [0.27, 0.27, 0.27]);
  const skyTint = new THREE.Color(day ? "#9cc9f0" : "#1b2440").lerp(outdoor, 0.35);

  let fog: Look["fog"];
  if (l?.atmosphere && l.atmosphere.density > 0) {
    // Roblox ignores the Fog properties when an Atmosphere exists.
    fog = {
      kind: "exp",
      color: srgb(l.atmosphere.color),
      density: l.atmosphere.density * 0.0025 * (1 + l.atmosphere.haze * 0.2),
    };
  } else if (l && l.fogEnd < 10000) {
    fog = { kind: "linear", color: srgb(l.fogColor), start: l.fogStart, end: l.fogEnd };
  }

  return {
    day,
    sun,
    sunIntensity: day ? brightness * (0.25 + 0.6 * Math.sqrt(elevation)) : 0.15,
    sky: skyTint,
    ground: ambient,
    ambient,
    hemi: day ? 1.1 : 0.4,
    night: "#0b1020",
    ...skyColors(day, sunDir.y, l?.atmosphere?.color),
    envColor: day ? "#7d8fa3" : "#151a28",
    haze: !!l?.atmosphere && l.atmosphere.haze > 0,
    fog,
  };
}
