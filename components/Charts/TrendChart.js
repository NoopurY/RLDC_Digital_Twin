"use client";
import { memo, useRef } from "react";
import { useCanvas, C, label, niceStep } from "./useCanvas";

/**
 * Multi-series time trend.  `data` is an array of points with a `t` field.
 * series: [{ key, label, color, axis: "left" | "right", fmt }]
 * Optional `fit` = { a, b, t0, t1 } draws the estimated linear trend and its extrapolation.
 * Optional `bands` = [{ from, to, color }] shades y-ranges of the left axis.
 */
function TrendChart({ data, series, height = 180, yDomain, yRight, fit, bands, extendSeconds = 0, version, xLabel = "s" }) {
  const hover = useRef(null);
  const [ref, invalidate] = useCanvas(
    (ctx, w, h) => {
      const PL = 40;
      const PR = yRight ? 40 : 10;
      const PT = 10;
      const PB = 20;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      if (!data || data.length < 2) {
        label(ctx, "collecting history…", PL + pw / 2, PT + ph / 2, { align: "center" });
        return;
      }
      const t0 = data[0].t;
      const t1 = data.at(-1).t + extendSeconds;
      const X = (t) => PL + ((t - t0) / Math.max(1e-6, t1 - t0)) * pw;
      const dom = (axis, fixed) => {
        if (fixed) return fixed;
        let lo = Infinity;
        let hi = -Infinity;
        for (const s of series.filter((s) => (s.axis ?? "left") === axis))
          for (const p of data) {
            const v = p[s.key];
            if (v == null || !Number.isFinite(v)) continue;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        if (!Number.isFinite(lo)) return [0, 1];
        const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
        return [lo - pad, hi + pad];
      };
      const L = dom("left", yDomain);
      const R = yRight ? dom("right", Array.isArray(yRight) ? yRight : null) : null;
      const Y = (v, d) => PT + ph - ((v - d[0]) / (d[1] - d[0])) * ph;

      bands?.forEach((b) => {
        ctx.fillStyle = b.color;
        const ya = Y(Math.min(b.to, L[1]), L);
        const yb = Y(Math.max(b.from, L[0]), L);
        ctx.fillRect(PL, ya, pw, yb - ya);
      });

      const step = niceStep(L[1] - L[0], 4);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (let v = Math.ceil(L[0] / step) * step; v <= L[1]; v += step) {
        const y = Math.round(Y(v, L)) + 0.5;
        ctx.moveTo(PL, y);
        ctx.lineTo(PL + pw, y);
        label(ctx, Math.abs(step) < 0.01 ? v.toExponential(0) : `${+v.toFixed(step < 1 ? 2 : 0)}`, PL - 4, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      const ts = niceStep(t1 - t0, 6);
      for (let t = Math.ceil(t0 / ts) * ts; t <= t1; t += ts) {
        const x = Math.round(X(t)) + 0.5;
        ctx.moveTo(x, PT);
        ctx.lineTo(x, PT + ph);
        label(ctx, `${t.toFixed(0)}`, x, h - 6, { align: "center", color: C.axis, size: 9 });
      }
      ctx.stroke();
      label(ctx, xLabel, PL + pw, h - 6, { align: "right", color: C.axis, size: 9 });
      if (R) {
        for (let j = 0; j <= 4; j++) {
          const v = R[0] + ((R[1] - R[0]) * j) / 4;
          label(ctx, `${+v.toFixed(R[1] - R[0] < 2 ? 2 : 0)}`, PL + pw + 4, Y(v, R) + 3, { color: C.axis, size: 9 });
        }
      }

      for (const s of series) {
        const d = (s.axis ?? "left") === "right" ? R : L;
        ctx.save();
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width ?? 1.4;
        ctx.setLineDash(s.dash ?? []);
        ctx.beginPath();
        let started = false;
        for (const p of data) {
          const v = p[s.key];
          if (v == null || !Number.isFinite(v)) continue;
          const x = X(p.t);
          const y = Y(v, d);
          started ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          started = true;
        }
        ctx.stroke();
        ctx.restore();
      }

      if (fit) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = C.amber;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const ta = Math.max(fit.t0, t0);
        ctx.moveTo(X(ta), Y(fit.a + fit.b * ta, L));
        ctx.lineTo(X(t1), Y(fit.a + fit.b * t1, L));
        ctx.stroke();
        ctx.restore();
      }

      // legend
      let lx = PL + 6;
      for (const s of series) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, PT + 6, 8, 2);
        label(ctx, s.label, lx + 11, PT + 10, { color: C.text, size: 9 });
        ctx.font = "9px monospace";
        lx += ctx.measureText(s.label).width + 28;
      }

      const hv = hover.current;
      if (hv != null && hv >= PL && hv <= PL + pw) {
        const t = t0 + ((hv - PL) / pw) * (t1 - t0);
        let best = data[0];
        for (const p of data) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
        const x = X(best.t);
        ctx.strokeStyle = "rgba(38,37,34,0.45)";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, PT);
        ctx.lineTo(x + 0.5, PT + ph);
        ctx.stroke();
        const txt = `t=${best.t.toFixed(1)}  ` + series.map((s) => `${s.label} ${s.fmt ? s.fmt(best[s.key]) : best[s.key]?.toFixed?.(2)}`).join("  ");
        ctx.font = "10px monospace";
        const tw = Math.min(pw - 8, ctx.measureText(txt).width + 14);
        const bx = Math.min(x + 8, PL + pw - tw);
        ctx.fillStyle = "rgba(251,248,241,0.96)";
        ctx.fillRect(bx, PT + 16, tw, 18);
        label(ctx, txt, bx + 6, PT + 28, { color: C.ink, size: 10 });
      }
    },
    () => `${version ?? data?.length}|${data?.at(-1)?.t}|${hover.current}|${fit?.b}`
  );
  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="block w-full"
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

export default memo(TrendChart);
