"use client";
// 3D digital twin of the RLDC motor test rig (react-three-fiber).
//
// What drives what:
//   • geometry/kinematics  ← twin ground truth (injected fault severities, shaft speed)
//   • shake / whirl        ← MEASURED features (1× and 2× amplitude vs healthy reference,
//                            instantaneous accelerometer samples)
//   • halos / "DETECTED"   ← diagnosis output (lights up only when the DSP engine detects it)
//   • thermal colour       ← simulated winding/housing temperature
// Rotation is shown in slow motion (VISUAL_SLOWMO) because 25 rev/s cannot be
// rendered at 60 fps without stroboscopic aliasing.

import { useMemo, useRef, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, ContactShadows, Environment, Lightformer, Grid, RoundedBox } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import { engine } from "@/lib/engine/twinEngine";
import { MOTOR, bearingOrders } from "@/lib/simulation/motorModel";
import { paintNoise, brushed, laminations, conduit, concrete, grilleAlpha, nameplate, arrowDecal } from "./textures";

export const VISUAL_SLOWMO = 12;
const ORD = bearingOrders();
const TAU = Math.PI * 2;
const AXIS_Y = 1.15;
const KINETIC = new THREE.Color("#2F5D46");
const CRIMSON = new THREE.Color("#A8402F");
const AMBER = new THREE.Color("#C6952B");
const HOT = new THREE.Color("#ff5a1f");
const PAINT = "#33503f"; // deep forest-green industrial enamel
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Cut-away wedge (world angle θ, direction (0, sinθ, cosθ)): faces the default camera.
const CUT_FROM = -0.2;
const CUT_TO = 1.85;
const inCut = (th) => {
  const t = ((th % TAU) + TAU) % TAU;
  const n = t > Math.PI ? t - TAU : t;
  return n > CUT_FROM - 0.05 && n < CUT_TO + 0.05;
};

export const CAMERA_VIEWS = {
  iso: { pos: [6.0, 3.9, 7.2], target: [1.0, 1.2, 0] },
  hero: { pos: [5.0, 3.8, 11.6], target: [-1.9, 1.1, 0.2] },
  side: { pos: [1.0, 1.6, 9.6], target: [1.0, 1.1, 0] },
  drive: { pos: [7.4, 1.9, 1.4], target: [0.8, 1.1, 0] },
  top: { pos: [1.0, 10.5, 0.6], target: [1.0, 0.9, 0] },
  inside: { pos: [1.5, 2.3, 3.0], target: [-0.3, 1.15, 0] },
};

// ─── materials ───────────────────────────────────────────────────────────────
function useMaterials() {
  return useMemo(() => {
    const phys = (o) => new THREE.MeshPhysicalMaterial(o);
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const peel = paintNoise([4, 4]);
    const brush = brushed([2, 1]);
    const lam = laminations([3, 1]);
    return {
      // clear-coated industrial enamel over cast iron
      frame: phys({ color: PAINT, metalness: 0.3, roughness: 0.48, roughnessMap: peel, bumpMap: peel, bumpScale: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.32, side: THREE.DoubleSide }),
      frameInner: std({ color: "#24282a", metalness: 0.35, roughness: 0.8, bumpMap: peel, bumpScale: 1.2, side: THREE.DoubleSide }),
      castRaw: std({ color: "#55585e", metalness: 0.6, roughness: 0.55, bumpMap: peel, bumpScale: 1.4 }),
      dark: std({ color: "#202124", metalness: 0.5, roughness: 0.55 }),
      base: phys({ color: "#3b3b38", metalness: 0.45, roughness: 0.5, roughnessMap: peel, bumpMap: peel, bumpScale: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.5 }),
      baseChannel: std({ color: "#302f2c", metalness: 0.5, roughness: 0.6, bumpMap: peel, bumpScale: 0.6 }),
      machined: phys({ color: "#c9ced6", metalness: 1, roughness: 0.28, roughnessMap: brush, anisotropy: 0.7 }),
      steel: phys({ color: "#c4c9d0", metalness: 1, roughness: 0.26, roughnessMap: brush, anisotropy: 0.5 }),
      lamin: std({ color: "#5a5f69", metalness: 0.9, roughness: 0.35, bumpMap: lam, bumpScale: 1.5 }),
      copper: phys({ color: "#b8682c", metalness: 0.95, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, emissive: "#000000" }),
      copperField: phys({ color: "#a65a26", metalness: 0.9, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2, emissive: "#000000" }),
      faultCoil: phys({ color: "#b8682c", metalness: 0.95, roughness: 0.3, clearcoat: 1, emissive: "#000000", toneMapped: false }),
      mica: std({ color: "#3a2a20", metalness: 0.2, roughness: 0.7 }),
      carbon: std({ color: "#141416", metalness: 0.1, roughness: 0.95 }),
      bolt: std({ color: "#9aa1aa", metalness: 1, roughness: 0.25, emissive: "#000000", toneMapped: false }),
      boltLoose: std({ color: "#9aa1aa", metalness: 1, roughness: 0.25, emissive: "#000000", toneMapped: false }),
      race: phys({ color: "#d5dae1", metalness: 1, roughness: 0.12, emissive: "#000000", toneMapped: false }),
      ball: phys({ color: "#eef1f4", metalness: 1, roughness: 0.06 }),
      spider: std({ color: "#0f7a58", metalness: 0, roughness: 0.75, emissive: "#000000" }),
      fan: std({ color: "#1f2125", metalness: 0.1, roughness: 0.6 }),
      cowl: phys({ color: PAINT, metalness: 0.35, roughness: 0.45, roughnessMap: peel, clearcoat: 0.5, clearcoatRoughness: 0.35, alphaMap: grilleAlpha(), alphaTest: 0.5, side: THREE.DoubleSide }),
      cowlShell: phys({ color: PAINT, metalness: 0.35, roughness: 0.45, roughnessMap: peel, clearcoat: 0.5, clearcoatRoughness: 0.35, side: THREE.DoubleSide }),
      disc: phys({ color: "#7d838c", metalness: 0.9, roughness: 0.5, roughnessMap: brush }),
      caliper: phys({ color: "#7a1f2e", metalness: 0.3, roughness: 0.4, clearcoat: 0.8, emissive: "#000000", toneMapped: false }),
      sensor: phys({ color: "#cfd4db", metalness: 1, roughness: 0.2 }),
      sensorLed: new THREE.MeshBasicMaterial({ color: "#2F5D46", toneMapped: false }),
      ct: phys({ color: "#2a2c31", metalness: 0.2, roughness: 0.5, clearcoat: 0.6 }),
      ctBand: new THREE.MeshBasicMaterial({ color: "#A8402F", toneMapped: false }),
      cable: std({ color: "#131315", metalness: 0.2, roughness: 0.55, bumpMap: conduit([60, 1]), bumpScale: 2 }),
      rubber: std({ color: "#141416", metalness: 0, roughness: 0.9 }),
      plate: std({ map: nameplate(), metalness: 0.75, roughness: 0.35 }),
      decal: new THREE.MeshStandardMaterial({ map: arrowDecal(), transparent: true, metalness: 0.2, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      vector: new THREE.MeshBasicMaterial({ color: "#B26A35", toneMapped: false, transparent: true, opacity: 0.95 }),
      laserRef: new THREE.MeshBasicMaterial({ color: "#2F5D46", toneMapped: false, transparent: true, opacity: 0.9 }),
      laserLoad: new THREE.MeshBasicMaterial({ color: "#A8402F", toneMapped: false, transparent: true, opacity: 0.9 }),
      haloDE: new THREE.MeshBasicMaterial({ color: "#2F5D46", toneMapped: false, transparent: true, opacity: 0.5, depthWrite: false }),
      shock: new THREE.MeshBasicMaterial({ color: "#A8402F", toneMapped: false, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      spark: new THREE.MeshBasicMaterial({ color: "#ffd2a8", toneMapped: false, transparent: true, opacity: 0 }),
      blurFan: new THREE.MeshStandardMaterial({ color: "#1f2125", transparent: true, opacity: 0, roughness: 0.6, depthWrite: false, side: THREE.DoubleSide }),
      blurDisc: new THREE.MeshStandardMaterial({ color: "#5e636b", metalness: 0.8, roughness: 0.45, transparent: true, opacity: 0, depthWrite: false }),
      floorRing: new THREE.MeshBasicMaterial({ color: "#2F5D46", toneMapped: false, transparent: true, opacity: 0.25, depthWrite: false }),
    };
  }, []);
}

// ─── geometry helpers ───────────────────────────────────────────────────────
// Axis-aligned (X) cylinder; supports the cut-away wedge.
function XCyl({ r, r2, len, x = 0, seg = 48, mat, open = false, cut = false, ...rest }) {
  const thetaStart = cut ? CUT_TO : 0;
  const thetaLength = cut ? TAU - (CUT_TO - CUT_FROM) : TAU;
  return (
    <mesh position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={mat} castShadow receiveShadow {...rest}>
      <cylinderGeometry args={[r2 ?? r, r, len, seg, 1, open, thetaStart, thetaLength]} />
    </mesh>
  );
}

// Lathe (revolved profile) along X. `dir` = +1 grows toward +X, −1 toward −X.
function XLathe({ points, x = 0, dir = 1, seg = 64, mat, cut = false }) {
  const geo = useMemo(() => {
    const pts = points.map(([r, a]) => new THREE.Vector2(r, a));
    // dir=+1 → rotation z = −π/2 flips the angular sense, so the wedge is mirrored.
    const phiStart = cut ? (dir > 0 ? -CUT_FROM : CUT_TO) : 0;
    const phiLength = cut ? TAU - (CUT_TO - CUT_FROM) : TAU;
    const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
    g.computeVertexNormals();
    return g;
  }, [points, dir, seg, cut]);
  return <mesh geometry={geo} position={[x, 0, 0]} rotation={[0, 0, dir > 0 ? -Math.PI / 2 : Math.PI / 2]} material={mat} castShadow receiveShadow />;
}

function HexBolt({ position, rotation, r = 0.04, h = 0.035, mat, washer = true, washerMat }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh material={mat} castShadow position={[0, h / 2, 0]}>
        <cylinderGeometry args={[r, r, h, 6]} />
      </mesh>
      <mesh material={mat} position={[0, h + 0.004, 0]}>
        <cylinderGeometry args={[r * 0.8, r * 0.95, 0.008, 6]} />
      </mesh>
      {washer && (
        <mesh material={washerMat ?? mat} position={[0, 0.004, 0]}>
          <cylinderGeometry args={[r * 1.45, r * 1.45, 0.008, 20]} />
        </mesh>
      )}
    </group>
  );
}

// radial placement helper: returns props placing a child on a circle of radius r at angle th (YZ plane)
const radial = (th, r, x = 0) => ({ position: [x, Math.sin(th) * r, Math.cos(th) * r], rotation: [Math.PI / 2 - th, 0, 0] });

// ─── stator frame ───────────────────────────────────────────────────────────
const SHIELD_PROFILE = [
  [0.905, 0],
  [0.93, 0.02],
  [0.93, 0.07],
  [0.88, 0.09],
  [0.78, 0.14],
  [0.6, 0.19],
  [0.44, 0.22],
  [0.36, 0.23],
  [0.35, 0.33],
  [0.32, 0.35],
  [0.16, 0.35],
];

function Housing({ m, cut, xray }) {
  const fins = useMemo(() => {
    const out = [];
    const n = 34;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * TAU;
      const n0 = th > Math.PI ? th - TAU : th;
      if (Math.abs(n0 + Math.PI / 2) < 0.62) continue; // feet / underside
      if (Math.abs(n0 - Math.PI / 2) < 0.3) continue; // terminal box pad
      if (Math.abs(n0 + 0.62) < 0.3) continue; // nameplate pad
      if (cut && inCut(th)) continue;
      out.push(th);
    }
    return out;
  }, [cut]);
  const shieldBolts = useMemo(() => [...Array(8)].map((_, i) => (i / 8) * TAU + TAU / 16).filter((th) => !(cut && inCut(th))), [cut]);
  if (xray)
    return (
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.93, 0.93, 2.7, 48, 1, true]} />
        <meshBasicMaterial color="#2F5D46" wireframe transparent opacity={0.1} toneMapped={false} />
      </mesh>
    );
  return (
    <group>
      {/* main frame shell (outer paint + inner raw casting) */}
      <XCyl r={0.86} len={1.96} mat={m.frame} open cut={cut} seg={72} />
      <XCyl r={0.8} len={1.96} mat={m.frameInner} open cut={cut} seg={72} />
      {/* end flanges */}
      {[-0.95, 0.95].map((x) => (
        <XCyl key={x} r={0.92} len={0.07} x={x} mat={m.frame} cut={cut} seg={72} />
      ))}
      {/* cooling fins */}
      {fins.map((th) => (
        <mesh key={th} {...radial(th, 0.925)} material={m.frame} castShadow receiveShadow>
          <boxGeometry args={[1.82, 0.13, 0.026]} />
        </mesh>
      ))}
      {/* cast end shields with bearing bosses + rim bolts */}
      <XLathe points={SHIELD_PROFILE} x={0.985} dir={1} mat={m.frame} cut={cut} />
      <XLathe points={SHIELD_PROFILE} x={-0.985} dir={-1} mat={m.frame} cut={cut} />
      {[1, -1].map((sgn) =>
        shieldBolts.map((th) => (
          <HexBolt key={`${sgn}${th}`} position={[sgn * 1.055, Math.sin(th) * 0.82, Math.cos(th) * 0.82]} rotation={[0, 0, -sgn * Math.PI / 2]} r={0.032} h={0.03} mat={m.bolt} />
        ))
      )}
      {/* bearing caps */}
      {[1, -1].map((sgn) => (
        <XCyl key={sgn} r={0.2} len={0.04} x={sgn * 1.355} mat={m.castRaw} seg={32} />
      ))}

      {/* terminal box on a cast pad */}
      <group position={[0.15, 0.86, 0]}>
        <RoundedBox args={[0.5, 0.08, 0.44]} radius={0.02} smoothness={3} position={[0, 0.02, 0]} material={m.frame} castShadow />
        <RoundedBox args={[0.6, 0.26, 0.52]} radius={0.035} smoothness={4} position={[0, 0.18, 0]} material={m.frame} castShadow />
        <RoundedBox args={[0.64, 0.045, 0.56]} radius={0.018} smoothness={3} position={[0, 0.325, 0]} material={m.frame} castShadow />
        {[[-0.26, -0.23], [0.26, -0.23], [-0.26, 0.23], [0.26, 0.23]].map(([x, z]) => (
          <HexBolt key={`${x}${z}`} position={[x, 0.345, z]} r={0.018} h={0.014} mat={m.bolt} washer={false} />
        ))}
        {/* cable gland */}
        <group position={[0, 0.17, -0.27]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh material={m.machined} position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.07, 0.07, 0.05, 6]} />
          </mesh>
          <mesh material={m.rubber} position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.055, 0.065, 0.06, 20]} />
          </mesh>
        </group>
      </group>

      {/* lifting eye */}
      <group position={[-0.5, 0.88, 0]}>
        <mesh material={m.frame} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 0.08, 20]} />
        </mesh>
        <mesh material={m.machined} position={[0, 0.16, 0]} castShadow>
          <torusGeometry args={[0.1, 0.028, 12, 28]} />
        </mesh>
      </group>

      {/* nameplate pad + engraved plate (front-lower side, outside the cut wedge) */}
      <group rotation={[Math.PI / 2 + 0.62, 0, 0]}>
        <mesh position={[0, 0.875, 0]} material={m.frame} castShadow>
          <boxGeometry args={[0.72, 0.03, 0.42]} />
        </mesh>
        <mesh position={[0, 0.893, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.plate}>
          <planeGeometry args={[0.62, 0.34]} />
        </mesh>
      </group>
    </group>
  );
}

function Feet({ m }) {
  return (
    <group>
      {[0.72, -0.72].map((z) => (
        <group key={z}>
          {/* foot rail */}
          <RoundedBox args={[1.86, 0.08, 0.34]} radius={0.015} smoothness={3} position={[0, -AXIS_Y + 0.3, z]} material={m.frame} castShadow receiveShadow />
          {/* web joining the frame */}
          <mesh position={[0, -0.64, z * 0.82]} material={m.frame} castShadow>
            <boxGeometry args={[1.7, 0.42, 0.07]} />
          </mesh>
          {/* gusset ribs */}
          {[-0.6, 0, 0.6].map((x) => (
            <mesh key={x} position={[x, -0.68, z * 0.9]} material={m.frame} castShadow>
              <boxGeometry args={[0.05, 0.34, 0.16]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function FieldPoles({ m, cut }) {
  // 4 salient field poles with copper field coils (DC machine stator).
  const poles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].filter((th) => !(cut && inCut(th)));
  return (
    <group>
      {poles.map((th) => (
        <group key={th} rotation={[Math.PI / 2 - th, 0, 0]}>
          <mesh position={[0, 0.69, 0]} material={m.lamin} castShadow>
            <boxGeometry args={[1.5, 0.2, 0.28]} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} material={m.lamin}>
            <cylinderGeometry args={[0.6, 0.6, 1.5, 24, 1, true, -0.55, 1.1]} />
          </mesh>
          <mesh position={[0, 0.66, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[4.2, 1.05, 1]} material={m.copperField}>
            <torusGeometry args={[0.2, 0.06, 10, 24]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── rotating assembly ─────────────────────────────────────────────────────
function Armature({ m, refs }) {
  const N = MOTOR.commutatorSegments;
  return (
    <group ref={refs.rotor}>
      <XCyl r={0.5} len={1.42} mat={m.lamin} seg={48} />
      {[...Array(N)].map((_, i) => {
        const th = (i / N) * TAU;
        return (
          <mesh key={i} ref={i === 3 ? refs.faultCoil : undefined} {...radial(th, 0.5)} material={i === 3 ? m.faultCoil : m.copper}>
            <boxGeometry args={[1.5, 0.055, 0.07]} />
          </mesh>
        );
      })}
      {/* slot wedges */}
      {[...Array(N)].map((_, i) => (
        <mesh key={`w${i}`} {...radial(((i + 0.5) / N) * TAU, 0.497)} material={m.dark}>
          <boxGeometry args={[1.44, 0.01, 0.04]} />
        </mesh>
      ))}
      {/* end windings (overhang) */}
      {[-0.79, 0.79].map((x) => (
        <mesh key={x} position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={m.copper}>
          <torusGeometry args={[0.37, 0.095, 14, 48]} />
        </mesh>
      ))}
      {/* commutator */}
      <group position={[-1.0, 0, 0]}>
        <XCyl r={0.21} len={0.3} mat={m.mica} seg={36} />
        {[...Array(N * 2)].map((_, i) => {
          const th = ((i + 0.5) / (N * 2)) * TAU;
          const fault = Math.floor(i / 2) === 3;
          return (
            <mesh key={i} {...radial(th, 0.212)} material={fault ? m.faultCoil : m.copper}>
              <boxGeometry args={[0.28, 0.018, 0.048]} />
            </mesh>
          );
        })}
        {/* riser connections */}
        <XCyl r={0.3} r2={0.22} len={0.08} x={0.18} mat={m.copper} seg={36} />
      </group>
      {/* balancing ring + unbalance mass (crimson) */}
      <XCyl r={0.44} len={0.05} x={0.74} mat={m.machined} seg={48} />
      <group ref={refs.unbalance} position={[0.76, 0.45, 0]}>
        <mesh material={m.vector}>
          <boxGeometry args={[0.08, 0.06, 0.12]} />
        </mesh>
      </group>
    </group>
  );
}

function Shaft({ m, refs }) {
  return (
    <group ref={refs.shaft}>
      <XCyl r={0.125} len={2.9} x={-0.15} mat={m.steel} seg={32} />
      {/* drive-end extension with shoulder, keyway + key, chamfered tip */}
      <XCyl r={0.11} len={0.85} x={1.72} mat={m.steel} seg={32} />
      <XCyl r={0.11} r2={0.095} len={0.03} x={2.16} mat={m.steel} seg={32} />
      <mesh position={[1.8, 0.108, 0]} material={m.machined}>
        <boxGeometry args={[0.42, 0.03, 0.05]} />
      </mesh>
      {/* NDE stub */}
      <XCyl r={0.1} len={0.3} x={-1.72} mat={m.steel} seg={24} />
    </group>
  );
}

function Fan({ m, refs }) {
  return (
    <group position={[-1.56, 0, 0]}>
      <mesh rotation={[0, Math.PI / 2, 0]} position={[-0.02, 0, 0]} material={m.blurFan}>
        <ringGeometry args={[0.18, 0.79, 64]} />
      </mesh>
      <group ref={refs.fan}>
        <XCyl r={0.16} len={0.14} mat={m.fan} seg={32} />
        <XCyl r={0.5} len={0.025} x={0.05} mat={m.fan} seg={48} />
        <group ref={refs.fanBlades}>
        {[...Array(11)].map((_, i) => (
          <group key={i} rotation={[(i / 11) * TAU, 0, 0]}>
            <mesh position={[0, 0.48, 0]} rotation={[0.3, 0, 0]} material={m.fan} castShadow>
              <boxGeometry args={[0.13, 0.62, 0.02]} />
            </mesh>
          </group>
        ))}
        </group>
      </group>
      {/* sheet-metal cowl: shell + perforated grille */}
      <XCyl r={0.9} len={0.52} x={-0.05} mat={m.cowlShell} open seg={64} />
      <XCyl r={0.92} len={0.04} x={0.2} mat={m.cowlShell} seg={64} />
      <XLathe points={[[0.9, 0], [0.87, 0.04], [0.8, 0.06]]} x={-0.31} dir={-1} mat={m.cowlShell} />
      <mesh position={[-0.37, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={m.cowl}>
        <circleGeometry args={[0.8, 64]} />
      </mesh>
      {/* rotation-direction arrow decal */}
      <mesh position={[0, 0.905, 0]} rotation={[-Math.PI / 2, 0, 0]} material={m.decal}>
        <planeGeometry args={[0.36, 0.18]} />
      </mesh>
    </group>
  );
}

function Bearing({ x, m, refs, which }) {
  const n = MOTOR.bearing.balls;
  return (
    <group position={[x, 0, 0]}>
      <XCyl r={0.27} len={0.11} mat={m.race} open seg={48} />
      <XCyl r={0.235} len={0.115} mat={m.race} open seg={48} />
      <XCyl r={0.16} len={0.11} mat={m.steel} open seg={36} />
      <XCyl r={0.185} len={0.115} mat={m.steel} open seg={36} />
      <group ref={which === "de" ? refs.cageDE : refs.cageNDE}>
        {[...Array(n)].map((_, i) => {
          const th = (i / n) * TAU;
          return (
            <mesh key={i} position={[0, Math.sin(th) * 0.21, Math.cos(th) * 0.21]} material={m.ball}>
              <sphereGeometry args={[0.042, 20, 14]} />
            </mesh>
          );
        })}
        <mesh rotation={[0, Math.PI / 2, 0]} material={m.copper}>
          <torusGeometry args={[0.21, 0.008, 6, 48]} />
        </mesh>
      </group>
      {which === "de" && (
        <mesh ref={refs.spall} position={[0, -0.236, 0]} material={m.vector} visible={false}>
          <boxGeometry args={[0.06, 0.01, 0.07]} />
        </mesh>
      )}
    </group>
  );
}

function Brushes({ m, refs }) {
  return (
    <group position={[-1.0, 0, 0]}>
      {/* brush rocker ring */}
      <mesh rotation={[0, Math.PI / 2, 0]} material={m.dark}>
        <torusGeometry args={[0.46, 0.025, 8, 48]} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s} position={[0, s * 0.31, 0]}>
          <mesh material={m.carbon}>
            <boxGeometry args={[0.1, 0.16, 0.12]} />
          </mesh>
          <mesh position={[0, s * 0.11, 0]} material={m.machined}>
            <boxGeometry args={[0.14, 0.09, 0.16]} />
          </mesh>
          <mesh position={[0, s * 0.13, 0]} material={m.copper}>
            <boxGeometry args={[0.02, 0.06, 0.2]} />
          </mesh>
          <mesh ref={s > 0 ? refs.sparkA : refs.sparkB} position={[0, -s * 0.09, 0]} material={m.spark}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ─── base frame, load and services ─────────────────────────────────────────
function BaseBolts({ m, refs }) {
  const pos = [
    [-0.75, 0.72],
    [0.75, 0.72],
    [-0.75, -0.72],
    [0.75, -0.72],
  ];
  return pos.map(([x, z], i) => (
    <group key={i} position={[x, 0.34, z]} ref={i === 0 ? refs.looseBolt : undefined}>
      <HexBolt position={[0, 0, 0]} r={0.055} h={0.05} mat={i === 0 ? m.boltLoose : m.bolt} washerMat={m.machined} />
      <mesh position={[0, 0.09, 0]} material={m.machined}>
        <cylinderGeometry args={[0.028, 0.028, 0.08, 12]} />
      </mesh>
    </group>
  ));
}

function Skid({ m }) {
  return (
    <group>
      {/* welded C-channel frame */}
      {[-1.08, 1.08].map((z) => (
        <group key={z} position={[1.2, 0, z]}>
          <mesh position={[0, 0.09, 0]} material={m.baseChannel} castShadow receiveShadow>
            <boxGeometry args={[6.8, 0.18, 0.025]} />
          </mesh>
          <mesh position={[0, 0.0125, -Math.sign(z) * 0.07]} material={m.baseChannel} receiveShadow>
            <boxGeometry args={[6.8, 0.025, 0.16]} />
          </mesh>
        </group>
      ))}
      {[-2.1, -0.4, 1.2, 2.8, 4.5].map((x) => (
        <mesh key={x} position={[x, 0.09, 0]} material={m.baseChannel} castShadow>
          <boxGeometry args={[0.1, 0.16, 2.1]} />
        </mesh>
      ))}
      {/* top plate */}
      <RoundedBox args={[6.86, 0.06, 2.26]} radius={0.015} smoothness={3} position={[1.2, 0.21, 0]} material={m.base} castShadow receiveShadow />
      {/* machined mounting pads under the motor feet */}
      {[0.72, -0.72].map((z) => (
        <mesh key={z} position={[0, 0.25, z]} material={m.machined} receiveShadow>
          <boxGeometry args={[1.95, 0.02, 0.4]} />
        </mesh>
      ))}
      {/* anchor plates + anchor bolts at the corners */}
      {[[-2.05, 1.0], [-2.05, -1.0], [4.45, 1.0], [4.45, -1.0]].map(([x, z]) => (
        <group key={`${x}${z}`}>
          <HexBolt position={[x, 0.24, z * 0.92]} r={0.045} h={0.04} mat={m.bolt} washerMat={m.machined} />
        </group>
      ))}
      {/* load pedestals (box-section columns) */}
      {[2.75, 3.85].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <RoundedBox args={[0.34, 0.5, 0.62]} radius={0.02} smoothness={3} position={[0, 0.49, 0]} material={m.base} castShadow receiveShadow />
          <mesh position={[0, 0.755, 0]} material={m.machined}>
            <boxGeometry args={[0.38, 0.03, 0.66]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PillowBlock({ x, m }) {
  return (
    <group position={[x, 0, 0]}>
      <RoundedBox args={[0.24, 0.12, 0.6]} radius={0.02} smoothness={3} position={[0, -0.32, 0]} material={m.castRaw} castShadow />
      <mesh rotation={[0, 0, Math.PI / 2]} material={m.castRaw} castShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.22, 32]} />
      </mesh>
      <mesh position={[0, -0.16, 0]} material={m.castRaw}>
        <boxGeometry args={[0.2, 0.22, 0.26]} />
      </mesh>
      <XCyl r={0.13} len={0.24} mat={m.machined} seg={28} />
      {[0.22, -0.22].map((z) => (
        <HexBolt key={z} position={[0, -0.26, z]} r={0.03} h={0.03} mat={m.bolt} />
      ))}
      {/* grease nipple */}
      <mesh position={[0, 0.23, 0]} material={m.machined}>
        <cylinderGeometry args={[0.015, 0.02, 0.06, 8]} />
      </mesh>
    </group>
  );
}

function Load({ m, refs }) {
  // Driven side: coupling hub + shaft on pillow blocks + drilled brake disc with caliper.
  return (
    <group ref={refs.load} position={[2.28, 0, 0]}>
      {/* load-side jaw hub (jaws interleave with the motor hub's) */}
      <XCyl r={0.25} len={0.2} x={0.14} mat={m.machined} seg={40} />
      {[0, 1, 2].map((i) => {
        const th = ((i + 0.5) / 3) * TAU;
        return (
          <mesh key={i} {...radial(th, 0.16, 0.0)} material={m.machined}>
            <boxGeometry args={[0.12, 0.16, 0.14]} />
          </mesh>
        );
      })}
      <XCyl r={0.1} len={2.5} x={1.35} mat={m.steel} seg={24} />
      <PillowBlock x={0.47} m={m} />
      <PillowBlock x={1.57} m={m} />
      <group ref={refs.flywheel} position={[2.05, 0, 0]}>
        <XCyl r={0.82} len={0.07} mat={m.disc} seg={72} />
        {/* motion-blur overlay for the drilled ring */}
        {[1, -1].map((sg) => (
          <mesh key={sg} position={[sg * 0.04, 0, 0]} rotation={[0, sg * Math.PI / 2, 0]} material={m.blurDisc}>
            <ringGeometry args={[0.6, 0.79, 72]} />
          </mesh>
        ))}
        <XCyl r={0.5} len={0.16} mat={m.castRaw} seg={48} />
        <XCyl r={0.2} len={0.3} mat={m.machined} seg={32} />
        {/* drilled cross-holes */}
        {[...Array(24)].map((_, i) => {
          const th = (i / 24) * TAU;
          const r = i % 2 ? 0.66 : 0.73;
          return (
            <mesh key={i} position={[0, Math.sin(th) * r, Math.cos(th) * r]} rotation={[0, 0, Math.PI / 2]} material={m.dark}>
              <cylinderGeometry args={[0.022, 0.022, 0.075, 10]} />
            </mesh>
          );
        })}
        {[...Array(6)].map((_, i) => (
          <HexBolt key={`b${i}`} {...radial((i / 6) * TAU, 0.34, 0.08)} rotation={[0, 0, -Math.PI / 2]} position={[0.08, Math.sin((i / 6) * TAU) * 0.34, Math.cos((i / 6) * TAU) * 0.34]} r={0.03} h={0.025} mat={m.bolt} washer={false} />
        ))}
        <mesh position={[0.045, 0.78, 0]} material={m.vector}>
          <boxGeometry args={[0.01, 0.06, 0.04]} />
        </mesh>
      </group>
      {/* brake caliper (glows with load / overload) + bracket */}
      <group position={[2.05, -0.5, 0.56]} rotation={[-0.73, 0, 0]}>
        <RoundedBox args={[0.34, 0.3, 0.22]} radius={0.05} smoothness={4} material={m.caliper} castShadow />
        <mesh position={[0, -0.2, 0]} material={m.castRaw}>
          <boxGeometry args={[0.12, 0.16, 0.1]} />
        </mesh>
      </group>
    </group>
  );
}

function Cable({ m }) {
  const geo = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.15, AXIS_Y + 1.03, -0.36),
      new THREE.Vector3(0.15, AXIS_Y + 1.0, -0.75),
      new THREE.Vector3(0.0, 1.3, -1.4),
      new THREE.Vector3(-0.7, 0.35, -1.75),
      new THREE.Vector3(-1.5, 0.06, -2.0),
      new THREE.Vector3(-3.2, 0.05, -2.4),
    ]);
    return new THREE.TubeGeometry(curve, 120, 0.045, 14, false);
  }, []);
  const accCable = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.24, AXIS_Y + 0.5, -0.12),
      new THREE.Vector3(1.3, AXIS_Y + 0.62, -0.35),
      new THREE.Vector3(1.4, 0.8, -1.0),
      new THREE.Vector3(1.5, 0.3, -1.2),
      new THREE.Vector3(1.6, 0.25, -1.15),
    ]);
    return new THREE.TubeGeometry(curve, 60, 0.012, 8, false);
  }, []);
  return (
    <group>
      <mesh geometry={geo} material={m.cable} castShadow />
      <mesh geometry={accCable} material={m.rubber} castShadow />
      {/* split-core CT current sensor clamped on the supply cable */}
      <group position={[0.12, AXIS_Y + 0.98, -0.78]} rotation={[-0.25, 0, 0]}>
        <mesh material={m.ct}>
          <torusGeometry args={[0.1, 0.04, 14, 36]} />
        </mesh>
        <mesh material={m.ctBand} position={[0, 0, 0.0]}>
          <torusGeometry args={[0.1, 0.042, 6, 36, 0.6]} />
        </mesh>
      </group>
    </group>
  );
}

function Accelerometer({ m }) {
  return (
    <group position={[1.24, 0.36, -0.12]}>
      <mesh material={m.machined} position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.045, 0.05, 0.03, 20]} />
      </mesh>
      <mesh material={m.sensor} position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.1, 6]} />
      </mesh>
      <mesh material={m.sensorLed} position={[0, 0.095, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.01, 12]} />
      </mesh>
      <mesh material={m.machined} position={[0, 0.06, -0.06]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.018, 0.018, 0.05, 12]} />
      </mesh>
    </group>
  );
}

function RotationVector({ refs, m }) {
  // Crimson rotational vector arc + unbalance-force phasor at the drive end.
  const arc = useMemo(() => new THREE.TorusGeometry(0.62, 0.012, 6, 64, Math.PI * 1.45), []);
  return (
    <group position={[1.5, 0, 0]}>
      <group ref={refs.vectorArc} rotation={[0, Math.PI / 2, 0]}>
        <mesh geometry={arc} material={m.vector} />
        <mesh position={[0.62, 0, 0]} rotation={[0, 0, Math.PI]} material={m.vector}>
          <coneGeometry args={[0.04, 0.12, 12]} />
        </mesh>
      </group>
      <group ref={refs.phasor}>
        <mesh position={[0, 0.5, 0]} material={m.vector}>
          <boxGeometry args={[0.016, 1, 0.016]} />
        </mesh>
        <mesh position={[0, 1.04, 0]} material={m.vector}>
          <coneGeometry args={[0.045, 0.1, 12]} />
        </mesh>
      </group>
    </group>
  );
}

function Floor() {
  const tex = useMemo(() => concrete([8, 8]), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.2, -0.001, 0]} receiveShadow>
      <planeGeometry args={[60, 60]} />
      {/* matte polished concrete (a mirror reflector would re-render the whole scene every frame) */}
      <meshStandardMaterial map={tex} color="#e2dac8" roughness={0.82} metalness={0.05} />
    </mesh>
  );
}

export const LABEL_ITEMS = [
  { id: "stator", text: "STATOR · FIELD POLES", pos: [-0.2, AXIS_Y + 1.25, -0.3] },
  { id: "armature", text: "ARMATURE", pos: [0.3, AXIS_Y + 0.05, 0.75] },
  { id: "commutator", text: "COMMUTATOR + BRUSHES", pos: [-1.0, AXIS_Y - 0.66, 0.55] },
  { id: "bearingDE", text: "BEARING · DE", pos: [1.25, AXIS_Y + 0.66, 0.35] },
  { id: "coupling", text: "COUPLING", pos: [2.3, AXIS_Y + 0.5, 0.2] },
  { id: "load", text: "LOAD · DYNO", pos: [4.35, AXIS_Y + 1.05, 0] },
  { id: "mount", text: "MOUNTING", pos: [-0.75, 0.55, 1.0] },
  { id: "sensor", text: "ACC-1", pos: [1.24, AXIS_Y + 0.6, -0.3] },
  { id: "signal", text: "ACC-1 · LIVE WAVEFORM · 250 ms", pos: [3.1, 3.92, -1.0] },
];

/** Projects label anchors to screen space each frame and moves plain DOM nodes (no extra React roots). */
function LabelProjector({ els }) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    LABEL_ITEMS.forEach((it, i) => {
      const el = els.current[i];
      if (!el) return;
      v.set(...it.pos).project(camera);
      const hidden = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
      el.style.opacity = hidden ? "0" : "1";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    });
  });
  return null;
}

// ─── the animated rig ──────────────────────────────────────────────────────
function MotorRig({ view }) {
  const m = useMaterials();
  const refs = {
    rotor: useRef(),
    fan: useRef(),
    shaft: useRef(),
    cageDE: useRef(),
    cageNDE: useRef(),
    spall: useRef(),
    unbalance: useRef(),
    faultCoil: useRef(),
    sparkA: useRef(),
    sparkB: useRef(),
    looseBolt: useRef(),
    load: useRef(),
    flywheel: useRef(),
    body: useRef(),
    vectorArc: useRef(),
    phasor: useRef(),
    laserLoad: useRef(),
    shock: useRef(),
    haloDE: useRef(),
    floorRing: useRef(),
    heat: useRef(),
    hubs: useRef(),
    fanBlades: useRef(),
  };
  const st = useRef({ theta: 0, rpmVis: 0, whirl: 0, shakeY: 0, shakeZ: 0, temp: 25, shockT: 1, lastImpact: 0 });
  const heatParticles = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const n = 90;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 2;
      p[i * 3 + 1] = Math.random() * 1.6;
      p[i * 3 + 2] = (Math.random() - 0.5) * 1.4;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  const paintColor = useMemo(() => new THREE.Color(PAINT), []);
  const thermalTmp = useMemo(() => new THREE.Color(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    const L = engine.latest;
    const f = engine.faults;
    const ext = !!engine.external;
    const running = engine.running;
    // Visual speed eases toward the live shaft speed (updated every generation block),
    // so acceleration/droop look continuous rather than stepping at the analysis rate.
    s.rpmVis = lerp(s.rpmVis ?? 0, running ? engine.liveRpm : 0, 1 - Math.exp(-dt * 6));
    const rpm = s.rpmVis;
    const omega = (rpm / 60) * TAU;
    s.theta = (s.theta + (omega / VISUAL_SLOWMO) * dt) % (TAU * 1000);
    const th = s.theta;

    for (const k of ["rotor", "fan", "shaft", "flywheel", "hubs"]) if (refs[k].current) refs[k].current.rotation.x = th;
    const cage = th * ORD.ftf;
    if (refs.cageDE.current) refs.cageDE.current.rotation.x = cage;
    if (refs.cageNDE.current) refs.cageNDE.current.rotation.x = cage;
    if (refs.vectorArc.current) refs.vectorArc.current.rotation.z = -th;

    // ── measured vibration → whirl/shake ─────────────────────────────────
    const feat = L?.features;
    const base = engine.baseline;
    const a1x = feat && base ? Math.max(0, feat.a1 - 1.3 * base.a1) : 0;
    const a2x = feat && base ? Math.max(0, feat.a2 - 1.5 * base.a2) : 0;
    const a05 = feat && base ? Math.max(0, feat.a05 - 2 * base.a05) : 0;
    const whirl = Math.min(0.055, 0.11 * a1x);
    const axial = Math.min(0.04, 0.12 * a2x);
    const inst = running ? engine.instantSample("vib") : 0;
    const lowRms = (feat?.rms ?? 0) * 0.5;
    // Impulsive jolts only when the signal is actually impulsive (bearing impacts / rattle).
    const resid = feat?.kurtosis > 4 ? Math.max(-0.6, Math.min(0.6, inst)) : 0;
    const kShake = 1 - Math.exp(-dt * 14);
    s.whirl = lerp(s.whirl ?? 0, whirl, 1 - Math.exp(-dt * 3));
    s.shakeY = lerp(s.shakeY, Math.cos(th) * s.whirl + resid * 0.03 * Math.sign(inst) * Math.min(1, Math.abs(inst) / (lowRms + 1e-3) / 3), kShake);
    s.shakeZ = lerp(s.shakeZ, Math.sin(th) * s.whirl, kShake);
    // Motion-blur discs fade in with speed so blades/holes read as spinning, not strobing.
    const blur = clamp01((rpm - 300) / 1800);
    m.blurFan.opacity = blur * 0.75;
    m.blurDisc.opacity = blur * 0.55;
    if (refs.fanBlades.current) refs.fanBlades.current.visible = blur < 0.85;

    const body = refs.body.current;
    if (body) {
      body.position.set(Math.sin(2 * th) * axial * 0.5, AXIS_Y + s.shakeY, s.shakeZ);
      const loose = ext ? 0 : f.looseness;
      const rock = loose * 0.035 * Math.max(0, Math.sin(th / 2)) + Math.min(0.03, a05 * 0.25) * Math.abs(Math.sin(th / 2));
      body.rotation.x = -rock;
      body.rotation.z = rock * 0.4;
    }
    if (refs.looseBolt.current) {
      const loose = ext ? 0 : f.looseness;
      refs.looseBolt.current.position.y = 0.34 + loose * 0.09 * Math.abs(Math.sin(th / 2));
      refs.looseBolt.current.rotation.y = loose * th * 0.15;
      m.boltLoose.emissive.copy(CRIMSON).multiplyScalar(loose * 1.6 * (0.6 + 0.4 * Math.abs(Math.sin(th / 2))));
    }

    // ── imbalance: heavy-spot mass + force phasor (F ∝ m·e·ω²) ───────────
    const imb = ext ? 0 : f.imbalance;
    if (refs.unbalance.current) {
      refs.unbalance.current.visible = imb > 0.01;
      refs.unbalance.current.scale.setScalar(0.6 + imb * 1.8);
    }
    if (refs.phasor.current) {
      const force = imb * (rpm / 1500) ** 2;
      refs.phasor.current.visible = imb > 0.01;
      refs.phasor.current.scale.set(1, Math.min(1.3, 0.25 + force * 1.1), 1);
      refs.phasor.current.rotation.x = th;
    }

    // ── misalignment: load assembly offset + angle, laser alignment lines ──
    const mis = ext ? 0 : f.misalignment;
    if (refs.load.current) {
      refs.load.current.position.y = -mis * 0.09;
      refs.load.current.rotation.z = -mis * 0.065;
      refs.load.current.position.z = mis * 0.04;
    }
    if (refs.laserLoad.current) {
      refs.laserLoad.current.visible = mis > 0.01;
      refs.laserLoad.current.position.y = -mis * 0.09;
      refs.laserLoad.current.rotation.z = -mis * 0.065;
    }
    m.spider.emissive.copy(CRIMSON).multiplyScalar(mis * 0.8 * (0.6 + 0.4 * Math.abs(Math.sin(2 * th))));

    // ── bearing: spall + impacts at BPFO (in slow-motion time) ─────────────
    const brg = ext ? 0 : f.bearing;
    if (refs.spall.current) refs.spall.current.visible = brg > 0.01;
    const impactPhase = (th * ORD.bpfo) / TAU;
    if (brg > 0.01 && Math.floor(impactPhase) !== s.lastImpact) {
      s.lastImpact = Math.floor(impactPhase);
      s.shockT = 0;
    }
    s.shockT = Math.min(1, s.shockT + dt * 3.2);
    const flash = brg > 0.01 ? (1 - s.shockT) ** 2 * (0.4 + brg) : 0;
    m.race.emissive.copy(CRIMSON).multiplyScalar(flash * 2.2);
    if (refs.shock.current) {
      const sc = 0.4 + s.shockT * (0.9 + brg);
      refs.shock.current.scale.set(sc, sc, sc);
      m.shock.opacity = brg > 0.01 ? (1 - s.shockT) * 0.55 * Math.min(1, brg * 2 + 0.2) : 0;
    }

    // ── diagnosis-driven halos (only when DETECTED) ───────────────────────
    const d = L?.diagnosis;
    const detected = new Set(d && d.label !== "healthy" ? [d.primary, ...(d.active ?? [])] : []);
    m.haloDE.color.lerp(detected.has("bearing") ? CRIMSON : KINETIC, 0.08);
    m.haloDE.opacity = detected.has("bearing") ? 0.5 + 0.4 * Math.sin(performance.now() / 160) : 0.28;
    const hs = L?.health?.score ?? 100;
    m.floorRing.color.lerp(hs >= 80 ? KINETIC : hs >= 40 ? AMBER : CRIMSON, 0.05);
    m.floorRing.opacity = 0.18 + (hs < 60 ? 0.15 * (1 + Math.sin(performance.now() / 300)) : 0);

    // ── electrical: faulty armature coil + brush sparking ─────────────────
    const ele = ext ? 0 : f.electrical;
    const atBrush = Math.abs(Math.sin(th - Math.PI * 0.5 + (3 / 12) * TAU));
    m.faultCoil.emissive.copy(CRIMSON).multiplyScalar(ele * (0.6 + 1.6 * atBrush ** 6));
    const spark = ele > 0.02 ? ele * (Math.random() < 0.35 + ele * 0.5 ? 1 : 0.1) * (0.4 + atBrush ** 4) : 0;
    m.spark.opacity = Math.min(1, spark * 1.4);
    if (refs.sparkA.current) refs.sparkA.current.scale.setScalar(0.4 + spark * 1.4 * Math.random());
    if (refs.sparkB.current) refs.sparkB.current.scale.setScalar(0.4 + spark * 1.4 * Math.random());

    // ── thermal state ────────────────────────────────────────────────────
    const T = L?.temperature ?? engine.params.ambientTemp;
    s.temp = lerp(s.temp, T, 0.05);
    const heat = clamp01((s.temp - 45) / 75);
    m.frame.emissive.copy(HOT).lerp(CRIMSON, heat).multiplyScalar(heat * 0.55 * (view.thermal ? 1.6 : 1));
    m.copperField.emissive.copy(HOT).multiplyScalar(clamp01((L?.current ?? 0) / MOTOR.ratedCurrent - 0.4) * 0.35 + heat * 0.4);
    if (view.thermal) m.frame.color.copy(thermalTmp.set("#1f3b5a").lerp(KINETIC, clamp01((s.temp - 25) / 30)).lerp(CRIMSON, heat));
    else m.frame.color.copy(paintColor);
    m.cowlShell.color.copy(m.frame.color);
    m.cowl.color.copy(m.frame.color);
    if (refs.heat.current) {
      refs.heat.current.visible = s.temp > 70;
      const pos = heatParticles.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) + dt * (0.35 + heat * 0.6);
        if (y > 1.8) y = 0;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      refs.heat.current.material.opacity = 0.25 + heat * 0.5;
    }

    // ── load / overload: brake caliper heat ───────────────────────────────
    const loadPu = L?.op ? L.op.loadTorque / MOTOR.ratedTorque : engine.params.load / 100;
    m.caliper.emissive.copy(HOT).lerp(CRIMSON, clamp01(loadPu - 1)).multiplyScalar(clamp01(loadPu - 0.3) * 1.4);
  });

  return (
    <group>
      <Skid m={m} />
      <BaseBolts m={m} refs={refs} />
      <mesh ref={refs.floorRing} rotation={[-Math.PI / 2, 0, 0]} position={[1.2, 0.004, 0]} material={m.floorRing}>
        <ringGeometry args={[3.9, 3.96, 128]} />
      </mesh>

      {/* Motor body (moves with measured vibration) */}
      <group ref={refs.body} position={[0, AXIS_Y, 0]}>
        <Housing m={m} cut={view.cutaway} xray={view.xray} />
        {!view.xray && <Feet m={m} />}
        <FieldPoles m={m} cut={view.cutaway} />
        <Armature m={m} refs={refs} />
        <Brushes m={m} refs={refs} />
        <Fan m={m} refs={refs} />
        <Bearing x={1.24} which="de" m={m} refs={refs} />
        <Bearing x={-1.24} which="nde" m={m} refs={refs} />
        <Shaft m={m} refs={refs} />
        {/* motor-side jaw hub + elastomer spider (rotate with the shaft) */}
        <group ref={refs.hubs}>
          <XCyl r={0.25} len={0.2} x={2.0} mat={m.machined} seg={40} />
          {[0, 1, 2].map((i) => (
            <mesh key={i} {...radial((i / 3) * TAU, 0.16, 2.15)} material={m.machined}>
              <boxGeometry args={[0.12, 0.16, 0.14]} />
            </mesh>
          ))}
          <XCyl r={0.23} len={0.08} x={2.2} mat={m.spider} seg={6} />
          <mesh position={[2.0, 0.25, 0]} material={m.dark}>
            <cylinderGeometry args={[0.02, 0.02, 0.03, 6]} />
          </mesh>
        </group>
        <Accelerometer m={m} />
        {/* bearing condition halo + impact shockwave */}
        <mesh ref={refs.haloDE} position={[1.4, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={m.haloDE}>
          <torusGeometry args={[0.4, 0.012, 8, 64]} />
        </mesh>
        <mesh ref={refs.shock} position={[1.41, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={m.shock}>
          <ringGeometry args={[0.36, 0.4, 48]} />
        </mesh>
        <RotationVector refs={refs} m={m} />
        <points ref={refs.heat} geometry={heatParticles} position={[0, 0.85, 0]}>
          <pointsMaterial color="#ff7a45" size={0.035} transparent opacity={0.4} depthWrite={false} toneMapped={false} />
        </points>
      </group>

      {/* Driven load (moves with misalignment) */}
      <group position={[0, AXIS_Y, 0]}>
        <Load m={m} refs={refs} />
        <mesh position={[3.6, 0, 0.0]} rotation={[0, 0, Math.PI / 2]} material={m.laserRef}>
          <cylinderGeometry args={[0.006, 0.006, 3.2, 6]} />
        </mesh>
        <group ref={refs.laserLoad} position={[2.28, 0, 0]}>
          <mesh position={[1.32, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={m.laserLoad}>
            <cylinderGeometry args={[0.006, 0.006, 3.2, 6]} />
          </mesh>
        </group>
      </group>
      <Cable m={m} />
    </group>
  );
}

/**
 * Live accelerometer waveform rendered in 3D above the rig — the last 0.25 s
 * of real samples from the engine ring buffer, auto-ranged like a scope.
 */
function SignalRibbon({ show }) {
  const N = 420;
  const { line, frame } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#2F5D46", toneMapped: false }));
    const fg = new THREE.BufferGeometry().setFromPoints(
      [[-1.7, 2.55], [4.5, 2.55], [4.5, 3.75], [-1.7, 3.75], [-1.7, 2.55], [-1.7, 3.15], [4.5, 3.15]].map(([x, y]) => new THREE.Vector3(x, y, -1.0))
    );
    const fr = new THREE.Line(fg, new THREE.LineBasicMaterial({ color: "#D3CAB6", transparent: true, opacity: 0.8 }));
    return { line: l, frame: fr };
  }, []);
  const scale = useRef(0.1);
  useFrame(() => {
    if (!show) return;
    const len = Math.round(0.25 * engine.dsp.fs);
    const seg = engine.tail(len, "vib");
    if (!seg || seg.length < len) return;
    let peak = 0;
    for (let i = 0; i < seg.length; i++) peak = Math.max(peak, Math.abs(seg[i]));
    scale.current = Math.max(peak, scale.current * 0.985, 0.04);
    const pos = line.geometry.attributes.position;
    const per = len / N;
    for (let i = 0; i < N; i++) {
      const a = Math.floor(i * per);
      const b = Math.max(a + 1, Math.floor((i + 1) * per));
      let v = seg[a];
      for (let k = a; k < b; k++) if (Math.abs(seg[k]) > Math.abs(v)) v = seg[k];
      pos.setXYZ(i, -1.7 + (6.2 * i) / (N - 1), 3.15 + (v / scale.current) * 0.55, -1.0);
    }
    pos.needsUpdate = true;
  });
  return (
    <group visible={show}>
      <primitive object={frame} />
      <primitive object={line} />
    </group>
  );
}

function CameraRig({ viewKey, controls }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    camera.fov = aspect < 0.8 ? 62 : aspect < 1.25 ? 48 : 38;
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  const target = useRef(null);
  useEffect(() => {
    const v = CAMERA_VIEWS[viewKey?.key ?? viewKey] ?? CAMERA_VIEWS.iso;
    target.current = { pos: new THREE.Vector3(...v.pos), tgt: new THREE.Vector3(...v.target), t: 0 };
  }, [viewKey]);
  useFrame((_, dt) => {
    const c = controls.current;
    const tr = target.current;
    if (!tr || !c) return;
    tr.t += dt;
    if (tr.t > 2.5) {
      target.current = null;
      return;
    }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5); // frame-rate independent easing
    camera.position.lerp(tr.pos, k);
    c.target.lerp(tr.tgt, k);
    c.update();
  });
  return null;
}

export default function MotorScene({ view, viewKey = { key: "iso", n: 0 }, autoRotate = false, interactive = true, effects = true, selected, onSelect, labels = true }) {
  const controls = useRef();
  const labelEls = useRef([]);
  const start = CAMERA_VIEWS[viewKey?.key] ?? CAMERA_VIEWS.iso;
  return (
    <div className="relative h-full w-full">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: start.pos, fov: 38, near: 0.1, far: 80 }}
        gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.95 }}
      >
        <color attach="background" args={["#F3EFE6"]} />
        <fog attach="fog" args={["#F3EFE6", 22, 46]} />
        <ambientLight intensity={0.35} />
        <hemisphereLight args={["#fffaf0", "#cbbf9f", 0.55]} />
        {/* key light (soft shadows) */}
        <directionalLight
          position={[5, 9, 6]}
          intensity={2.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0002}
          shadow-normalBias={0.02}
          shadow-radius={4}
          shadow-camera-left={-7}
          shadow-camera-right={7}
          shadow-camera-top={7}
          shadow-camera-bottom={-7}
        />
        {/* cool rim + warm accent */}
        <directionalLight position={[-7, 4, -6]} intensity={0.9} color="#fff4dc" />
        <directionalLight position={[-6, 2, 5]} intensity={0.35} color="#f3e6c8" />
        <spotLight position={[1, 6, 1]} angle={0.7} penumbra={1} intensity={7} distance={14} color="#ffffff" />
        
        <Environment resolution={256} frames={1}>
          <Lightformer form="rect" intensity={3} position={[0, 7, 0]} rotation-x={Math.PI / 2} scale={[12, 5, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#e7edf5" position={[-7, 2.5, 2]} rotation-y={Math.PI / 2} scale={[8, 1.4, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#e7edf5" position={[7, 2.5, -2]} rotation-y={-Math.PI / 2} scale={[8, 1.4, 1]} />
          <Lightformer form="rect" intensity={0.9} color="#cfd8e6" position={[0, 2, -8]} scale={[12, 2, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#f5ead2" position={[0, 1.5, 9]} scale={[14, 3, 1]} />
        </Environment>

        <MotorRig view={view} />
        <SignalRibbon show={view.signal !== false} />
        <LabelProjector els={labelEls} />

        <Floor />
        <Grid position={[1.2, 0.002, 0]} args={[30, 30]} cellSize={0.5} cellThickness={0.5} cellColor="#d9cfb9" sectionSize={2.5} sectionThickness={0.9} sectionColor="#c4b896" fadeDistance={20} fadeStrength={1.6} infiniteGrid />
        <ContactShadows position={[1.2, 0.003, 0]} opacity={0.45} color="#3d3a28" scale={13} blur={2.2} far={2.5} resolution={512} />

        <OrbitControls
          ref={controls}
          makeDefault
          enabled={interactive}
          enablePan={interactive}
          enableZoom={interactive}
          target={start.target}
          minDistance={2}
          maxDistance={16}
          maxPolarAngle={Math.PI / 2.05}
          autoRotate={autoRotate}
          autoRotateSpeed={0.6}
          enableDamping
        />
        <CameraRig viewKey={viewKey} controls={controls} />
        {effects && (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <N8AO aoRadius={0.45} intensity={2.2} distanceFalloff={0.6} quality="performance" halfRes />
            <SMAA />
            <Bloom intensity={0.35} luminanceThreshold={0.97} luminanceSmoothing={0.2} mipmapBlur />
            <Vignette offset={0.3} darkness={0.28} />
          </EffectComposer>
        )}
      </Canvas>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ display: labels ? "block" : "none" }}>
        {LABEL_ITEMS.map((it, i) => (it.id === "signal" && view.signal === false ? null : (
          <button
            key={it.id}
            ref={(el) => (labelEls.current[i] = el)}
            onClick={() => onSelect?.(it.id === selected ? null : it.id)}
            style={{ opacity: 0 }}
            className={`pointer-events-auto absolute left-0 top-0 whitespace-nowrap rounded-[2px] border px-1.5 py-[1px] font-mono text-[9.5px] tracking-[0.12em] backdrop-blur-sm transition-[color,background-color,border-color,opacity] ${
              selected === it.id ? "border-kinetic bg-kinetic/20 text-ink" : "border-line-2/80 bg-canvas/70 text-muted hover:border-kinetic/60 hover:text-ink"
            }`}
          >
            {it.text}
          </button>
        )))}
      </div>
    </div>
  );
}
