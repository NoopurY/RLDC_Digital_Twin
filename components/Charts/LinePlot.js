"use client";
import { useRef } from "react";
import { useCanvas, C, label, niceStep } from "./useCanvas";

/** Tick label with as many decimals as the tick step needs. */
const tick = (v, step) => {
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return dec > 4 ? v.toExponential(1) : v.toFixed(dec);
};
const fmt = (v) => (Math.abs(v) >= 100 || v === 0 ? v.toFixed(0) : v.toPrecision(3));

/**
 * Generic x–y plot for the DSP Analysis and Compare modules.
 *
 *   series:  [{ y, x0 = 0, dx = 1, color, width, dash, kind: "line" | "stem", label }]
 *   markers: [{ x, label, color, dash }]   vertical reference lines
 *   hlines:  [{ y, label, color }]          horizontal reference lines
 *
 * Axis limits default to the data; `symmetric` centres the y-axis on zero.
 * Hovering shows the nearest sample of every series.
 */
export default function LinePlot({ series, markers = [], hlines = [], xMin, xMax, yMin, yMax, symmetric, xUnit = "", yUnit = "", height = 200, version }) {
  const hover = useRef(null);
  const PL = 46;
  const PR = 8;
  const PT = 8;
  const PB = 20;

  const [ref, invalidate] = useCanvas(
    (ctx, w, h) => {
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);

      const xr = (s) => [s.x0 ?? 0, (s.x0 ?? 0) + (s.dx ?? 1) * (s.y.length - 1)];
      const x0 = xMin ?? Math.min(...series.map((s) => xr(s)[0]));
      const x1 = xMax ?? Math.max(...series.map((s) => xr(s)[1]));
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of series) {
        for (let i = 0; i < s.y.length; i++) {
          const x = (s.x0 ?? 0) + (s.dx ?? 1) * i;
          if (x < x0 || x > x1 || !Number.isFinite(s.y[i])) continue;
          lo = Math.min(lo, s.y[i]);
          hi = Math.max(hi, s.y[i]);
        }
      }
      if (!Number.isFinite(lo)) return;
      if (symmetric) {
        const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
        lo = -m;
        hi = m;
      }
      lo = yMin ?? lo;
      hi = yMax ?? hi;
      if (yMax == null && !symmetric) hi += (hi - lo) * 0.08 || 1;
      if (hi <= lo) hi = lo + 1;
      const X = (x) => PL + ((x - x0) / (x1 - x0 || 1)) * pw;
      const Y = (y) => PT + ph - ((Math.min(hi, Math.max(lo, y)) - lo) / (hi - lo)) * ph;

      // grid + ticks
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const sx = niceStep(x1 - x0, 8);
      for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
        ctx.moveTo(Math.round(X(x)) + 0.5, PT);
        ctx.lineTo(Math.round(X(x)) + 0.5, PT + ph);
        label(ctx, tick(x, sx), X(x), h - 6, { align: "center", color: C.axis, size: 9 });
      }
      const sy = niceStep(hi - lo, 4);
      for (let y = Math.ceil(lo / sy) * sy; y <= hi + 1e-12; y += sy) {
        ctx.moveTo(PL, Math.round(Y(y)) + 0.5);
        ctx.lineTo(PL + pw, Math.round(Y(y)) + 0.5);
        label(ctx, tick(Math.abs(y) < sy * 1e-6 ? 0 : y, sy), PL - 4, Y(y) + 3, { align: "right", color: C.axis, size: 9 });
      }
      ctx.stroke();
      if (lo < 0 && hi > 0) {
        ctx.strokeStyle = C.gridStrong;
        ctx.beginPath();
        ctx.moveTo(PL, Math.round(Y(0)) + 0.5);
        ctx.lineTo(PL + pw, Math.round(Y(0)) + 0.5);
        ctx.stroke();
      }
      if (yUnit) label(ctx, yUnit, 4, PT + 9, { color: C.axis, size: 9 });
      if (xUnit) label(ctx, xUnit, PL + pw - 4, PT + ph - 5, { align: "right", color: C.axis, size: 9 });

      ctx.save();
      ctx.beginPath();
      ctx.rect(PL, PT, pw, ph);
      ctx.clip();
      for (const m of hlines) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = m.color ?? C.axis;
        ctx.beginPath();
        ctx.moveTo(PL, Y(m.y));
        ctx.lineTo(PL + pw, Y(m.y));
        ctx.stroke();
        ctx.setLineDash([]);
        if (m.label) label(ctx, m.label, PL + 4, Y(m.y) - 3, { color: m.color ?? C.axis, size: 9 });
      }
      markers.forEach((m, i) => {
        if (m.x < x0 || m.x > x1) return;
        ctx.setLineDash(m.dash ?? [3, 4]);
        ctx.strokeStyle = m.color ?? "#B26A35";
        ctx.beginPath();
        ctx.moveTo(X(m.x) + 0.5, PT);
        ctx.lineTo(X(m.x) + 0.5, PT + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        if (m.label) label(ctx, m.label, X(m.x) + 3, PT + 11 + (i % 2) * 11, { color: m.color ?? "#B26A35", size: 9 });
      });

      for (const s of series) {
        const dx = s.dx ?? 1;
        const sx0 = s.x0 ?? 0;
        const i0 = Math.max(0, Math.floor((x0 - sx0) / dx));
        const i1 = Math.min(s.y.length - 1, Math.ceil((x1 - sx0) / dx));
        ctx.strokeStyle = s.color ?? C.ink;
        ctx.lineWidth = s.width ?? 1.3;
        ctx.setLineDash(s.dash ?? []);
        ctx.lineJoin = "round";
        ctx.beginPath();
        if (s.kind === "stem") {
          const base = Y(Math.max(lo, Math.min(hi, 0)));
          for (let i = i0; i <= i1; i++) {
            const x = X(sx0 + dx * i);
            ctx.moveTo(x, base);
            ctx.lineTo(x, Y(s.y[i]));
          }
          ctx.stroke();
          ctx.fillStyle = s.color ?? C.ink;
          for (let i = i0; i <= i1; i++) {
            ctx.beginPath();
            ctx.arc(X(sx0 + dx * i), Y(s.y[i]), 1.8, 0, 2 * Math.PI);
            ctx.fill();
          }
        } else {
          // Decimate to ~2 points per pixel (min/max) so long signals stay fast and honest.
          const per = Math.max(1, Math.floor((i1 - i0) / (pw * 2)));
          let first = true;
          for (let i = i0; i <= i1; i += per) {
            if (per === 1) {
              const px = X(sx0 + dx * i);
              const py = Y(s.y[i]);
              first ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
              first = false;
              continue;
            }
            let mn = Infinity;
            let mx = -Infinity;
            for (let j = i; j < Math.min(i + per, i1 + 1); j++) {
              mn = Math.min(mn, s.y[j]);
              mx = Math.max(mx, s.y[j]);
            }
            const px = X(sx0 + dx * i);
            first ? ctx.moveTo(px, Y(mx)) : ctx.lineTo(px, Y(mx));
            ctx.lineTo(px, Y(mn));
            first = false;
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      ctx.restore();

      // hover readout
      const hx = hover.current;
      if (hx != null && hx >= PL && hx <= PL + pw) {
        const xv = x0 + ((hx - PL) / pw) * (x1 - x0);
        ctx.strokeStyle = "rgba(38,37,34,0.45)";
        ctx.beginPath();
        ctx.moveTo(hx + 0.5, PT);
        ctx.lineTo(hx + 0.5, PT + ph);
        ctx.stroke();
        const lines = [`${fmt(xv)} ${xUnit}`];
        for (const s of series) {
          const i = Math.round((xv - (s.x0 ?? 0)) / (s.dx ?? 1));
          if (i >= 0 && i < s.y.length) lines.push(`${s.label ? s.label + " " : ""}${Number(s.y[i]).toPrecision(4)}`);
        }
        const bw = 150;
        const bx = hx + 8 + bw > PL + pw ? hx - 8 - bw : hx + 8;
        ctx.fillStyle = "rgba(251,249,244,0.95)";
        ctx.fillRect(bx, PT + 4, bw, 6 + 12 * lines.length);
        lines.forEach((t, i) => label(ctx, t, bx + 5, PT + 16 + 12 * i, { color: i ? series[i - 1]?.color ?? C.ink : C.ink, size: 9.5 }));
      }
    },
    () => `${version}|${hover.current}`
  );

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="block w-full cursor-crosshair"
      onMouseMove={(e) => {
        hover.current = e.clientX - e.currentTarget.getBoundingClientRect().left;
        invalidate();
      }}
      onMouseLeave={() => {
        hover.current = null;
        invalidate();
      }}
    />
  );
}
