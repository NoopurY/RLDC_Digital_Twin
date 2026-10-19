"use client";
import { memo, useRef } from "react";
import { engine } from "@/lib/engine/twinEngine";
import { useCanvas, C, label, niceStep } from "@/components/Charts/useCanvas";

// Colour map built from the palette: matte → slate → kinetic green → platinum → crimson peaks.
// Colour map from the palette: paper → sand → sage → forest → copper peaks.
const STOPS = [
  [0, [251, 249, 244]],
  [0.3, [228, 221, 203]],
  [0.55, [128, 156, 132]],
  [0.75, [47, 93, 70]],
  [0.9, [32, 46, 39]],
  [1, [178, 106, 53]],
];
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let j = 0;
    while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
    const [t0, c0] = STOPS[j];
    const [t1, c1] = STOPS[j + 1];
    const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = c0[k] + (c1[k] - c0[k]) * u;
  }
  return lut;
})();

export const SPECTRO_GRADIENT = `linear-gradient(to right, ${STOPS.map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(",")})`;

/** Live STFT spectrogram: time → x, frequency → y, magnitude (dB) → colour. */
/**
 * @param snapshot  frozen copy of the rolling spectrogram (from `snapshotSpectrogram`), or null for live
 * @param windowRange  [tStart, tEnd] seconds (absolute sim time) shaded to show the FFT window
 */
function Spectrogram({ height = 260, maxFreq, dbMin = -50, dbMax = 0, snapshot, windowRange }) {
  const off = useRef(null);
  const hover = useRef(null);
  const [ref, invalidate] = useCanvas(
    (ctx, w, h) => {
      const sg = snapshot ?? engine.spectrogram;
      const fs = engine.dsp.fs;
      const PL = 44;
      const PR = 8;
      const PT = 8;
      const PB = 20;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      if (!sg || sg.count === 0) {
        label(ctx, "accumulating STFT frames…", PL + pw / 2, PT + ph / 2, { align: "center" });
        return;
      }
      const { columns, bins, data, head } = sg;
      const df = fs / sg.nperseg;
      const fTop = Math.min(maxFreq ?? fs / 2, fs / 2);
      const kTop = Math.min(bins, Math.ceil(fTop / df));

      if (!off.current || off.current.width !== columns || off.current.height !== kTop) {
        off.current = document.createElement("canvas");
        off.current.width = columns;
        off.current.height = kTop;
      }
      const octx = off.current.getContext("2d");
      const img = octx.createImageData(columns, kTop);
      const range = dbMax - dbMin;
      for (let i = 0; i < columns; i++) {
        const col = (head + i) % columns;
        const base = col * bins;
        for (let k = 0; k < kTop; k++) {
          const v = data[base + k];
          const idx = Math.max(0, Math.min(255, Math.round(((v - dbMin) / range) * 255)));
          const p = ((kTop - 1 - k) * columns + i) * 4;
          img.data[p] = LUT[idx * 3];
          img.data[p + 1] = LUT[idx * 3 + 1];
          img.data[p + 2] = LUT[idx * 3 + 2];
          img.data[p + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off.current, PL, PT, pw, ph);

      // Axes
      const fstep = niceStep(fTop, 6);
      for (let f = 0; f <= fTop + 1e-6; f += fstep) {
        const y = PT + ph - (f / (kTop * df)) * ph;
        ctx.strokeStyle = "rgba(38,37,34,0.07)";
        ctx.beginPath();
        ctx.moveTo(PL, Math.round(y) + 0.5);
        ctx.lineTo(PL + pw, Math.round(y) + 0.5);
        ctx.stroke();
        label(ctx, f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${f.toFixed(0)}`, PL - 4, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      label(ctx, "Hz", 4, PT + 9, { color: C.axis, size: 9 });
      const span = (columns * sg.hop) / fs;
      for (let i = 0; i <= 5; i++) label(ctx, `${(-span + (span * i) / 5).toFixed(1)}`, PL + (pw * i) / 5, h - 6, { align: "center", color: C.axis, size: 9 });
      label(ctx, "s", PL + pw, h - 6, { align: "right", color: C.axis, size: 9 });

      // Shade the analysis window the FFT is computed from (synchronises the three views).
      if (windowRange) {
        const times = [];
        for (let i = 0; i < columns; i++) times.push(sg.colTimes[(head + i) % columns]);
        const xOf = (t) => {
          let best = 0;
          for (let i = 0; i < columns; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i;
          return PL + ((best + 0.5) / columns) * pw;
        };
        const x0 = xOf(windowRange[0]);
        const x1 = xOf(windowRange[1]);
        ctx.fillStyle = "rgba(178,106,53,0.14)";
        ctx.fillRect(x0, PT, Math.max(2, x1 - x0), ph);
        ctx.strokeStyle = "#B26A35";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0 + 0.5, PT + 0.5, Math.max(2, x1 - x0) - 1, ph - 1);
        ctx.lineWidth = 1;
      }
      // Current 1× marker at the right edge
      const frot = engine.latest?.features?.shaftFrequency;
      if (frot > 0.5 && frot < fTop) {
        const y = PT + ph - (frot / (kTop * df)) * ph;
        ctx.fillStyle = C.crimson;
        ctx.beginPath();
        ctx.moveTo(PL + pw, y);
        ctx.lineTo(PL + pw + 7, y - 4);
        ctx.lineTo(PL + pw + 7, y + 4);
        ctx.fill();
      }

      const hv = hover.current;
      if (hv && hv.x >= PL && hv.x <= PL + pw && hv.y >= PT && hv.y <= PT + ph) {
        const i = Math.floor(((hv.x - PL) / pw) * columns);
        const k = Math.floor(((PT + ph - hv.y) / ph) * kTop);
        const col = (head + i) % columns;
        const db = data[col * bins + k];
        const t = -span + ((i + 0.5) / columns) * span;
        const txt = `${(k * df).toFixed(1)} Hz · ${t.toFixed(2)} s · ${db.toFixed(1)} dB`;
        ctx.strokeStyle = "rgba(38,37,34,0.5)";
        ctx.beginPath();
        ctx.moveTo(hv.x + 0.5, PT);
        ctx.lineTo(hv.x + 0.5, PT + ph);
        ctx.moveTo(PL, hv.y + 0.5);
        ctx.lineTo(PL + pw, hv.y + 0.5);
        ctx.stroke();
        ctx.fillStyle = "rgba(251,248,241,0.96)";
        const bx = Math.min(hv.x + 8, PL + pw - 190);
        ctx.fillRect(bx, Math.max(PT, hv.y - 26), 186, 18);
        label(ctx, txt, bx + 6, Math.max(PT, hv.y - 26) + 12, { color: C.ink, size: 10 });
      }
    },
    () => `${snapshot ? "snap" + snapshot.version : engine.spectrogram?.version}|${windowRange?.[0]}|${hover.current?.x}|${hover.current?.y}|${maxFreq}|${dbMin}|${dbMax}`
  );
  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="block w-full cursor-crosshair"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        hover.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        invalidate();
      }}
      onMouseLeave={() => {
        hover.current = null;
        invalidate();
      }}
    />
  );
}

export default memo(Spectrogram);

/** Copy the live rolling spectrogram so a frozen view stays still while acquisition continues. */
export function snapshotSpectrogram() {
  const sg = engine.spectrogram;
  return { ...sg, data: sg.data.slice(), colTimes: sg.colTimes.slice(), version: sg.version };
}
