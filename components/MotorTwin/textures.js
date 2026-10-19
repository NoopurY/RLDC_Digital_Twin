"use client";
// Procedural textures generated on a 2D canvas at runtime — no image assets.
// Cached as module singletons so every mounted twin shares the same GPU textures.

import * as THREE from "three";

const cache = new Map();

function make(key, w, h, draw, { repeat = [1, 1], color = false, aniso = 8 } = {}) {
  const k = `${key}:${repeat.join("x")}`;
  if (cache.has(k)) return cache.get(k);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = aniso;
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  cache.set(k, t);
  return t;
}

// Small deterministic PRNG so textures look identical on every load.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Orange-peel / cast-iron paint: blotchy multi-scale noise (bump + roughness). */
export function paintNoise(repeat = [3, 3]) {
  return make(
    "paint",
    256,
    256,
    (ctx, w, h) => {
      const r = rng(7);
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const g = 100 + r() * 70;
        ctx.fillStyle = `rgba(${g},${g},${g},${0.08 + r() * 0.12})`;
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 1 + r() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      const img = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (r() - 0.5) * 28;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, img.data[i] + n));
      }
      ctx.putImageData(img, 0, 0);
    },
    { repeat }
  );
}

/** Brushed / turned metal: fine streaks along one direction. */
export function brushed(repeat = [1, 1]) {
  return make(
    "brushed",
    512,
    64,
    (ctx, w, h) => {
      const r = rng(11);
      ctx.fillStyle = "#7a7a7a";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const y = r() * h;
        const g = 90 + r() * 90;
        ctx.strokeStyle = `rgba(${g},${g},${g},${0.25 + r() * 0.35})`;
        ctx.lineWidth = 0.5 + r();
        ctx.beginPath();
        const x = r() * w;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 40 + r() * 260, y + (r() - 0.5) * 0.6);
        ctx.stroke();
      }
    },
    { repeat }
  );
}

/** Laminated electrical-steel stack: thin rings across the axis. */
export function laminations(repeat = [1, 1]) {
  return make(
    "lamin",
    512,
    16,
    (ctx, w, h) => {
      for (let x = 0; x < w; x += 4) {
        ctx.fillStyle = x % 8 === 0 ? "#9a9a9a" : "#5c5c5c";
        ctx.fillRect(x, 0, 3, h);
      }
    },
    { repeat }
  );
}

/** Spiral ribbing for flexible conduit. */
export function conduit(repeat = [40, 1]) {
  return make(
    "conduit",
    64,
    16,
    (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "#202020");
      g.addColorStop(0.5, "#e0e0e0");
      g.addColorStop(1, "#202020");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    { repeat }
  );
}

/** Polished concrete floor (albedo). */
export function concrete(repeat = [6, 6]) {
  return make(
    "concrete",
    512,
    512,
    (ctx, w, h) => {
      const r = rng(23);
      ctx.fillStyle = "#e4dccb";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const g = 200 + r() * 40;
        ctx.fillStyle = `rgba(${g},${g - 6},${g - 22},${0.35 + r() * 0.4})`;
        ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
      }
      for (let i = 0; i < 60; i++) {
        const g = 170 + r() * 40;
        ctx.fillStyle = `rgba(${g},${g - 8},${g - 30},0.08)`;
        ctx.beginPath();
        ctx.arc(r() * w, r() * h, 20 + r() * 70, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    { repeat, color: true }
  );
}

/** Fan-cowl grille: concentric slots + radial spokes as an alpha mask (white = solid). */
export function grilleAlpha() {
  return make(
    "grille",
    512,
    512,
    (ctx, w, h) => {
      const c = w / 2;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#000";
      for (let rr = 40; rr < 236; rr += 22) {
        ctx.beginPath();
        ctx.arc(c, c, rr + 12, 0, Math.PI * 2);
        ctx.arc(c, c, rr, 0, Math.PI * 2, true);
        ctx.fill();
      }
      ctx.fillStyle = "#fff";
      for (let i = 0; i < 12; i++) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate((i / 12) * Math.PI * 2);
        ctx.fillRect(-5, 30, 10, 220);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(c, c, 34, 0, Math.PI * 2);
      ctx.fill();
    },
    { aniso: 4 }
  );
}

/** Engraved aluminium nameplate. */
export function nameplate() {
  return make(
    "nameplate",
    1024,
    560,
    (ctx, w, h) => {
      const r = rng(5);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#c9ced6");
      g.addColorStop(0.5, "#aab0b9");
      g.addColorStop(1, "#c3c8cf");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 1400; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${r() * 0.12})`;
        const y = r() * h;
        ctx.beginPath();
        ctx.moveTo(r() * w, y);
        ctx.lineTo(r() * w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "#2a2d33";
      ctx.lineWidth = 6;
      ctx.strokeRect(22, 22, w - 44, h - 44);
      ctx.fillStyle = "#A8402F";
      ctx.fillRect(22, 22, w - 44, 92);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 58px monospace";
      ctx.fillText("RLDC MOTOR", 54, 90);
      ctx.font = "bold 30px monospace";
      ctx.textAlign = "right";
      ctx.fillText("DIGITAL TWIN LAB", w - 54, 82);
      ctx.textAlign = "left";
      ctx.fillStyle = "#1e2024";
      const rows = [
        ["TYPE", "RL-DC 230/1.4", "No.", "TW-0001"],
        ["U", "230 V DC", "I", "8.8 A"],
        ["P", "1.4 kW", "n", "1500 min⁻¹"],
        ["IP", "55", "INS.CL", "F"],
        ["DUTY", "S1", "BRG DE", "6206-2Z"],
      ];
      ctx.font = "34px monospace";
      rows.forEach((row, i) => {
        const y = 175 + i * 72;
        ctx.globalAlpha = 0.6;
        ctx.fillText(row[0], 54, y);
        ctx.fillText(row[2], 540, y);
        ctx.globalAlpha = 1;
        ctx.font = "bold 36px monospace";
        ctx.fillText(row[1], 200, y);
        ctx.fillText(row[3], 720, y);
        ctx.font = "34px monospace";
        ctx.fillStyle = "rgba(30,32,36,0.25)";
        ctx.fillRect(54, y + 18, w - 108, 2);
        ctx.fillStyle = "#1e2024";
      });
      [[44, 44], [w - 44, 44], [44, h - 44], [w - 44, h - 44]].forEach(([x, y]) => {
        const rg = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 14);
        rg.addColorStop(0, "#f2f4f7");
        rg.addColorStop(1, "#5c616a");
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.fill();
      });
    },
    { color: true }
  );
}

/** Rotation-direction arrow decal (crimson). */
export function arrowDecal() {
  return make(
    "arrow",
    256,
    128,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#A8402F";
      ctx.beginPath();
      ctx.moveTo(20, 46);
      ctx.lineTo(170, 46);
      ctx.lineTo(170, 18);
      ctx.lineTo(236, 64);
      ctx.lineTo(170, 110);
      ctx.lineTo(170, 82);
      ctx.lineTo(20, 82);
      ctx.closePath();
      ctx.fill();
    },
    { color: true }
  );
}
