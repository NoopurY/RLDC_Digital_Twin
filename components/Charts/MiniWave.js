"use client";
import { memo } from "react";
import { useCanvas, C, label } from "./useCanvas";

/** Static overlay of short waveforms on a shared scale (e.g. healthy vs faulty). */
function MiniWave({ traces, height = 90, fs, version, unit = "g" }) {
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const P = 4;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      const valid = traces.filter((t) => t?.data?.length);
      if (!valid.length) return;
      let m = 0;
      for (const t of valid) for (const v of t.data) m = Math.max(m, Math.abs(v));
      m = m * 1.1 || 1;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(0, h / 2 + 0.5);
      ctx.lineTo(w, h / 2 + 0.5);
      ctx.stroke();
      for (const t of valid) {
        ctx.strokeStyle = t.color;
        ctx.lineWidth = t.width ?? 1.2;
        ctx.globalAlpha = t.alpha ?? 1;
        ctx.beginPath();
        t.data.forEach((v, i) => {
          const x = P + (i / (t.data.length - 1)) * (w - 2 * P);
          const y = h / 2 - (v / m) * (h / 2 - P);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      label(ctx, `±${m.toFixed(2)} ${unit}`, w - 4, 11, { align: "right", color: C.axis, size: 9 });
      if (fs) label(ctx, `${((valid[0].data.length / fs) * 1000).toFixed(0)} ms`, 4, h - 4, { color: C.axis, size: 9 });
    },
    () => version
  );
  return <canvas ref={ref} style={{ height }} className="block w-full" />;
}

export default memo(MiniWave);
