"use client";
import { useEffect, useRef } from "react";

/**
 * requestAnimationFrame canvas loop with DPR scaling and resize handling.
 * `draw(ctx, w, h)` only runs when `version()` changes (or on resize/pointer
 * activity), so idle charts cost nothing.
 */
export function useCanvas(draw, version) {
  const ref = useRef(null);
  const drawRef = useRef(draw);
  const versionRef = useRef(version);
  drawRef.current = draw;
  versionRef.current = version;
  const dirty = useRef(true);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      dirty.current = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    let raf;
    let last;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = versionRef.current ? versionRef.current() : Math.random();
      if (v === last && !dirty.current) return;
      last = v;
      dirty.current = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const invalidate = () => (dirty.current = true);
  return [ref, invalidate];
}

export const C = {
  bg: "#FBF9F4",
  grid: "rgba(38,37,34,0.06)",
  gridStrong: "rgba(38,37,34,0.12)",
  axis: "#8E887E",
  text: "#64605A",
  ink: "#262522",
  green: "#2F5D46",
  crimson: "#A8402F",
  amber: "#C6952B",
  slate: "#E6DFD0",
};

export function niceStep(range, target = 5) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export function drawGrid(ctx, x0, y0, w, h, nx, ny) {
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= nx; i++) {
    const x = Math.round(x0 + (w * i) / nx) + 0.5;
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 + h);
  }
  for (let j = 0; j <= ny; j++) {
    const y = Math.round(y0 + (h * j) / ny) + 0.5;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
  }
  ctx.stroke();
}

let MONO = null;
/** Resolved monospace font-family (canvas cannot read CSS variables). */
export function monoFont(size = 10) {
  if (!MONO && typeof document !== "undefined") {
    MONO = getComputedStyle(document.documentElement).getPropertyValue("--font-jet").trim() || "ui-monospace, monospace";
  }
  return `${size}px ${MONO ?? "monospace"}`;
}

export function label(ctx, text, x, y, { color = C.text, align = "left", base = "alphabetic", size = 10 } = {}) {
  ctx.font = monoFont(size);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.fillText(text, x, y);
}

/** Trace with an optional glow underlay. */
export function trace(ctx, xs, ys, color, { width = 1.4, glow = false } = {}) {
  if (glow) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 0;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let i = 0; i < xs.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, xs[i], ys[i]);
  ctx.stroke();
  if (glow) ctx.restore();
}
