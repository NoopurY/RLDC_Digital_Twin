"use client";
import { memo } from "react";
import { useCanvas, C, label, niceStep } from "./useCanvas";

/** Static overlay of stored (down-sampled) spectra, e.g. from saved experiments. */
function MiniSpectrum({ spectra, height = 180, maxFreq = 400 }) {
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const PL = 40;
      const PR = 8;
      const PT = 8;
      const PB = 18;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      const valid = spectra.filter((s) => s?.spec?.mag?.length);
      if (!valid.length) {
        label(ctx, "no stored spectrum", PL + pw / 2, PT + ph / 2, { align: "center" });
        return;
      }
      const fTop = Math.min(maxFreq, ...valid.map((s) => s.spec.df * s.spec.mag.length));
      let ymax = 0;
      for (const s of valid) s.spec.mag.forEach((m, k) => k * s.spec.df <= fTop && (ymax = Math.max(ymax, m)));
      ymax = ymax * 1.12 || 0.01;
      const X = (f) => PL + (f / fTop) * pw;
      const Y = (m) => PT + ph - (m / ymax) * ph;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      const fs = niceStep(fTop, 6);
      for (let f = 0; f <= fTop; f += fs) {
        ctx.moveTo(Math.round(X(f)) + 0.5, PT);
        ctx.lineTo(Math.round(X(f)) + 0.5, PT + ph);
        label(ctx, `${f.toFixed(0)}`, X(f), h - 5, { align: "center", color: C.axis, size: 9 });
      }
      for (let j = 0; j <= 4; j++) {
        const y = Math.round(PT + (ph * j) / 4) + 0.5;
        ctx.moveTo(PL, y);
        ctx.lineTo(PL + pw, y);
        label(ctx, `${((ymax * (4 - j)) / 4 * 1000).toFixed(0)}`, PL - 4, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      ctx.stroke();
      label(ctx, "mg", 4, PT + 9, { color: C.axis, size: 9 });
      for (const s of valid) {
        ctx.save();
        ctx.strokeStyle = s.color;
        ctx.shadowColor = s.color;
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.3;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        s.spec.mag.forEach((m, k) => {
          const f = k * s.spec.df;
          if (f > fTop) return;
          k ? ctx.lineTo(X(f), Y(m)) : ctx.moveTo(X(f), Y(m));
        });
        ctx.stroke();
        ctx.restore();
      }
      let lx = PL + 6;
      for (const s of valid) {
        ctx.fillStyle = s.color;
        ctx.fillRect(lx, PT + 6, 8, 2);
        label(ctx, s.label, lx + 11, PT + 10, { color: C.text, size: 9 });
        lx += ctx.measureText(s.label).width + 26;
      }
    },
    () => spectra.map((s) => s?.label).join("|") + maxFreq
  );
  return <canvas ref={ref} style={{ height }} className="block w-full" />;
}

export default memo(MiniSpectrum);
