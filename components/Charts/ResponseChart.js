"use client";
import { memo } from "react";
import { useCanvas, C, label, niceStep } from "./useCanvas";
import { frequencyResponse } from "@/lib/dsp/filters";

/** Filter magnitude response in dB from 0 to Nyquist, with cut-off markers. */
function ResponseChart({ design, fs, cutoffs = [], height = 180, version }) {
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const PL = 40;
      const PR = 10;
      const PT = 8;
      const PB = 20;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      const nyq = fs / 2;
      const N = 300;
      const f = Array.from({ length: N }, (_, i) => (i / (N - 1)) * nyq);
      const H = frequencyResponse(design, fs, f);
      const dbMin = -80;
      const X = (v) => PL + (v / nyq) * pw;
      const Y = (db) => PT + ph - ((Math.max(dbMin, db) - dbMin) / (5 - dbMin)) * ph;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (let db = 0; db >= dbMin; db -= 20) {
        const y = Math.round(Y(db)) + 0.5;
        ctx.moveTo(PL, y);
        ctx.lineTo(PL + pw, y);
        label(ctx, `${db}`, PL - 4, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      const st = niceStep(nyq, 8);
      for (let v = 0; v <= nyq; v += st) {
        const x = Math.round(X(v)) + 0.5;
        ctx.moveTo(x, PT);
        ctx.lineTo(x, PT + ph);
        label(ctx, `${v.toFixed(0)}`, x, h - 6, { align: "center", color: C.axis, size: 9 });
      }
      ctx.stroke();
      label(ctx, "dB", 4, PT + 9, { color: C.axis, size: 9 });
      label(ctx, "Hz", PL + pw, h - 6, { align: "right", color: C.axis, size: 9 });
      // −3 dB line
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(38,37,34,0.35)";
      ctx.beginPath();
      ctx.moveTo(PL, Y(-3));
      ctx.lineTo(PL + pw, Y(-3));
      ctx.stroke();
      ctx.strokeStyle = C.crimson;
      for (const c of cutoffs) {
        ctx.beginPath();
        ctx.moveTo(X(c), PT);
        ctx.lineTo(X(c), PT + ph);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      label(ctx, "−3 dB", PL + 4, Y(-3) - 3, { color: C.axis, size: 9 });
      ctx.strokeStyle = C.green;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const y = Y(20 * Math.log10(H[i] + 1e-9));
        i ? ctx.lineTo(X(f[i]), y) : ctx.moveTo(X(f[i]), y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    },
    () => version
  );
  return <canvas ref={ref} style={{ height }} className="block w-full" />;
}

export default memo(ResponseChart);
