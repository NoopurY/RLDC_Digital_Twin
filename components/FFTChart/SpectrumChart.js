"use client";
import { memo, useEffect, useRef } from "react";
import { engine } from "@/lib/engine/twinEngine";
import { frequencyResponse } from "@/lib/dsp/filters";
import { getFilter } from "@/lib/dsp/pipeline";
import { findPeaks } from "@/lib/dsp/spectrum";
import { MOTOR, bearingOrders } from "@/lib/simulation/motorModel";
import { useCanvas, C, drawGrid, label, niceStep, monoFont } from "@/components/Charts/useCanvas";

const BPFO = bearingOrders().bpfo;

/**
 * Interactive amplitude spectrum.
 *  source: "vib" | "cur" | "env"     (vibration, armature current, envelope)
 *  wheel = zoom around cursor · drag = pan · double-click = reset · hover = cursor readout
 */
function SpectrumChart({ source = "vib", maxFreq, height = 220, scale = "linear", showOrders = true, showFilter = true, showPeaks = true, color, getSpecOverride, unitLabel, annotate = true }) {
  const view = useRef({ f0: 0, f1: null, hover: null, drag: null, ymax: 0.1 });
  // Displayed magnitudes ease toward each new FFT window (exponential, frame-rate independent).
  const disp = useRef({ arr: null, src: null, t: 0, settled: true });
  const getSpec = () => {
    if (getSpecOverride) return getSpecOverride();
    const L = engine.latest;
    if (!L) return null;
    return source === "cur" ? L.currentSpectrum : source === "env" ? L.envelope : L.spectrum;
  };

  const [ref, invalidate] = useCanvas(
    (ctx, w, h) => {
      const spec = getSpec();
      const L = engine.latest;
      const PL = 46;
      const PR = 10;
      const PT = 10;
      const PB = 20;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      if (!spec) {
        drawGrid(ctx, PL, PT, pw, ph, 10, 5);
        label(ctx, "waiting for first FFT window…", PL + pw / 2, PT + ph / 2, { align: "center" });
        return;
      }
      const { df, fs } = spec;
      const D = disp.current;
      const now = performance.now();
      if (!D.arr || D.arr.length !== spec.mag.length) {
        D.arr = Float64Array.from(spec.mag);
        D.t = now;
      }
      const k = 1 - Math.exp(-Math.min(0.1, (now - D.t) / 1000) * 9);
      D.t = now;
      let diff = 0;
      for (let i = 0; i < D.arr.length; i++) {
        const dv = spec.mag[i] - D.arr[i];
        D.arr[i] += dv * k;
        diff = Math.max(diff, Math.abs(dv));
      }
      D.settled = diff < 1e-5;
      const mag = D.arr;
      const v = view.current;
      const nyq = fs / 2;
      const defMax = maxFreq ?? (source === "env" ? Math.min(nyq, 400) : source === "cur" ? Math.min(nyq, 700) : nyq);
      if (v.f1 == null) v.f1 = defMax;
      const f0 = Math.max(0, v.f0);
      const f1 = Math.min(nyq, v.f1);
      const X = (f) => PL + ((f - f0) / (f1 - f0)) * pw;
      const k0 = Math.max(1, Math.floor(f0 / df));
      const k1 = Math.min(mag.length - 1, Math.ceil(f1 / df));
      const isDb = scale === "db";
      const val = (m) => (isDb ? 20 * Math.log10(m + 1e-6) : m);

      let peak = 0;
      for (let k = k0; k <= k1; k++) if (mag[k] > peak) peak = mag[k];
      const target = Math.max(peak * 1.18, source === "cur" ? 0.02 : 0.01);
      v.ymax = target > v.ymax ? target : v.ymax + (target - v.ymax) * 0.12;
      const yMin = isDb ? -90 : 0;
      const yMax = isDb ? Math.max(-10, 20 * Math.log10(v.ymax) + 3) : v.ymax;
      const Y = (m) => PT + ph - ((Math.max(yMin, val(m)) - yMin) / (yMax - yMin)) * ph;

      // Grid + ticks
      const fstep = niceStep(f1 - f0, 8);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (let f = Math.ceil(f0 / fstep) * fstep; f <= f1; f += fstep) {
        const x = Math.round(X(f)) + 0.5;
        ctx.moveTo(x, PT);
        ctx.lineTo(x, PT + ph);
        label(ctx, f >= 1000 ? `${(f / 1000).toFixed(1)}k` : `${+f.toFixed(1)}`, x, h - 6, { align: "center", color: C.axis, size: 9 });
      }
      for (let j = 0; j <= 5; j++) {
        const y = Math.round(PT + (ph * j) / 5) + 0.5;
        ctx.moveTo(PL, y);
        ctx.lineTo(PL + pw, y);
        const yv = yMax - ((yMax - yMin) * j) / 5;
        label(ctx, isDb ? `${yv.toFixed(0)}` : source === "cur" ? yv.toFixed(3) : `${(yv * 1000).toFixed(0)}`, PL - 5, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      ctx.stroke();
      label(ctx, unitLabel ?? (isDb ? "dB" : source === "cur" ? "A" : "mg"), 4, PT + 9, { color: C.axis, size: 9 });
      label(ctx, "Hz", PL + pw, h - 6, { align: "right", color: C.axis, size: 9 });

      // Order / defect-frequency markers
      const frot = L?.features?.shaftFrequency ?? 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(PL, PT, pw, ph);
      ctx.clip();
      if (showOrders && frot > 0.5) {
        const marks = [];
        if (source === "vib") {
          [0.5, 1, 2, 3, 4, 5, 6].forEach((o) => marks.push({ f: o * frot, t: `${o}×`, c: o === 1 ? C.crimson : "rgba(168,64,47,0.45)" }));
          marks.push({ f: BPFO * frot, t: "BPFO", c: C.amber });
        } else if (source === "env") {
          [1, 2, 3].forEach((o) => marks.push({ f: o * BPFO * frot, t: `${o}×BPFO`, c: C.amber }));
          marks.push({ f: frot, t: "1×", c: "rgba(168,64,47,0.6)" });
        } else {
          const N = MOTOR.commutatorSegments;
          marks.push({ f: frot, t: "1×", c: "rgba(168,64,47,0.6)" });
          marks.push({ f: N * frot, t: `${N}× comm`, c: C.crimson });
          marks.push({ f: (N - 1) * frot, t: "−sb", c: C.amber });
          marks.push({ f: (N + 1) * frot, t: "+sb", c: C.amber });
          marks.push({ f: 2 * N * frot, t: `${2 * N}×`, c: "rgba(168,64,47,0.45)" });
        }
        ctx.setLineDash([3, 4]);
        for (const m of marks) {
          if (m.f < f0 || m.f > f1) continue;
          const x = Math.round(X(m.f)) + 0.5;
          ctx.strokeStyle = m.c;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(x, PT);
          ctx.lineTo(x, PT + ph);
          ctx.stroke();
          ctx.globalAlpha = 1;
          label(ctx, m.t, x + 3, PT + 10, { color: m.c, size: 9 });
        }
        ctx.setLineDash([]);
      }

      // Filter response overlay (right axis 0…1)
      const filt = engine.dsp.filter;
      if (showFilter && source === "vib" && filt.enabled) {
        const N = 220;
        const fr = Array.from({ length: N }, (_, i) => f0 + ((f1 - f0) * i) / (N - 1));
        const H = frequencyResponse(getFilter(filt, fs), fs, fr);
        ctx.fillStyle = "rgba(47,93,70,0.05)";
        ctx.strokeStyle = "rgba(47,93,70,0.65)";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = X(fr[i]);
          const y = PT + ph - Math.min(1, H[i]) * ph * 0.92;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.lineTo(X(f1), PT + ph);
        ctx.lineTo(X(f0), PT + ph);
        ctx.fill();
        ctx.setLineDash([]);
        label(ctx, "|H(f)|", PL + pw - 4, PT + 10, { align: "right", color: C.green, size: 9 });
      }

      // Spectrum (filled)
      const col = color ?? (source === "cur" ? C.crimson : source === "env" ? C.amber : C.green);
      const grad = ctx.createLinearGradient(0, PT, 0, PT + ph);
      grad.addColorStop(0, col + "55");
      grad.addColorStop(1, col + "05");
      ctx.beginPath();
      ctx.moveTo(X(k0 * df), PT + ph);
      const step = Math.max(1, Math.floor((k1 - k0) / (pw * 1.5)));
      for (let k = k0; k <= k1; k += step) {
        let m = mag[k];
        for (let j = 1; j < step && k + j <= k1; j++) m = Math.max(m, mag[k + j]);
        ctx.lineTo(X(k * df), Y(m));
      }
      ctx.lineTo(X(k1 * df), PT + ph);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.save();
      ctx.shadowColor = col;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = k0; k <= k1; k += step) {
        let m = mag[k];
        for (let j = 1; j < step && k + j <= k1; j++) m = Math.max(m, mag[k + j]);
        k === k0 ? ctx.moveTo(X(k * df), Y(m)) : ctx.lineTo(X(k * df), Y(m));
      }
      ctx.stroke();
      ctx.restore();

      // Peaks
      if (showPeaks) {
        const pk = source === "vib" && L.peaks && !getSpecOverride ? L.peaks : findPeaks(mag, df, { minFreq: Math.max(2, f0), maxCount: 6, threshold: peak * 0.08, minSepHz: 4 });
        pk.filter((p) => p.freq >= f0 && p.freq <= f1)
          .slice(0, 5)
          .forEach((p, i) => {
            const x = X(p.freq);
            const y = Y(mag[Math.round(p.freq / df)] ?? p.amp);
            ctx.fillStyle = i === 0 ? C.crimson : C.ink;
            ctx.beginPath();
            ctx.arc(x, y, i === 0 ? 3.2 : 2.4, 0, Math.PI * 2);
            ctx.fill();
            // Name the peak when it sits on a known order / defect frequency.
            let name = "";
            if (annotate && frot > 0.5 && source !== "env") {
              const ord = p.freq / frot;
              const k = Math.round(ord);
              if (Math.abs(p.freq - BPFO * frot) < Math.max(2 * df, 1.5)) name = " · BPFO";
              else if (source === "cur" && Math.abs(ord - MOTOR.commutatorSegments) < 0.15) name = " · commutation";
              else if (k >= 1 && k <= 6 && Math.abs(ord - k) < Math.max((2 * df) / frot, 0.04)) name = k === 1 ? " · 1× rotational" : ` · ${k}× harmonic`;
              else if (Math.abs(ord - 0.5) < 0.04) name = " · ½× sub-harmonic";
            }
            label(ctx, `${p.freq.toFixed(1)} Hz${i < 3 ? name : ""}`, x, y - 6, { align: "center", color: i === 0 ? C.crimson : C.text, size: 9 });
          });
      }
      ctx.restore();

      // Hover cursor
      if (v.hover != null) {
        const f = f0 + ((v.hover - PL) / pw) * (f1 - f0);
        if (f >= f0 && f <= f1) {
          const k = Math.round(f / df);
          const x = Math.round(X(k * df)) + 0.5;
          ctx.strokeStyle = "rgba(38,37,34,0.5)";
          ctx.beginPath();
          ctx.moveTo(x, PT);
          ctx.lineTo(x, PT + ph);
          ctx.stroke();
          const amp = mag[k] ?? 0;
          const order = frot > 0.5 ? ` · ${(k * df / frot).toFixed(2)}×` : "";
          const txt = `${(k * df).toFixed(2)} Hz · ${source === "cur" ? `${amp.toFixed(4)} A` : `${(amp * 1000).toFixed(1)} mg`}${isDb ? ` (${val(amp).toFixed(1)} dB)` : ""}${order}`;
          ctx.font = monoFont(10);
          const tw = ctx.measureText(txt).width + 12;
          const bx = Math.min(x + 8, PL + pw - tw);
          ctx.fillStyle = "rgba(251,248,241,0.96)";
          ctx.strokeStyle = C.gridStrong;
          ctx.fillRect(bx, PT + 18, tw, 18);
          ctx.strokeRect(bx + 0.5, PT + 18.5, tw - 1, 17);
          label(ctx, txt, bx + 6, PT + 30, { color: C.ink, size: 10 });
        }
      }
      if (f0 > 0 || f1 < defMax) label(ctx, `zoom ${f0.toFixed(0)}–${f1.toFixed(0)} Hz · dbl-click reset`, PL + 6, PT + ph - 6, { color: C.axis, size: 9 });
    },
    () => `${disp.current.settled ? (getSpecOverride ? getSpecOverride()?.key : engine.latest?.t) : performance.now()}|${view.current.f0}|${view.current.f1}|${view.current.hover}|${scale}|${engine.dsp.filter.enabled}`
  );

  const onWheel = (e) => {
    const spec = getSpec();
    if (!spec) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = view.current;
    const pw = r.width - 56;
    const fc = v.f0 + ((e.clientX - r.left - 46) / pw) * (v.f1 - v.f0);
    const z = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const nyq = spec.fs / 2;
    let a = fc - (fc - v.f0) * z;
    let b = fc + (v.f1 - fc) * z;
    if (b - a < 4 * spec.df) return;
    v.f0 = Math.max(0, a);
    v.f1 = Math.min(nyq, b);
    invalidate();
  };
  // Native non-passive wheel listener so zooming doesn't scroll the page.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e) => {
      e.preventDefault();
      wheelRef.current({ deltaY: e.deltaY, clientX: e.clientX, currentTarget: el });
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [ref]);

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = view.current;
    v.hover = e.clientX - r.left;
    if (v.drag) {
      const pw = r.width - 56;
      const dF = ((e.clientX - v.drag.x) / pw) * (v.drag.f1 - v.drag.f0);
      const span = v.drag.f1 - v.drag.f0;
      const nyq = getSpec()?.fs / 2 || 1024;
      v.f0 = Math.max(0, Math.min(nyq - span, v.drag.f0 - dF));
      v.f1 = v.f0 + span;
    }
    invalidate();
  };

  return (
    <canvas
      ref={ref}
      style={{ height }}
      className="block w-full cursor-crosshair touch-none"
      onMouseMove={onMove}
      onMouseLeave={() => {
        view.current.hover = null;
        view.current.drag = null;
        invalidate();
      }}
      onMouseDown={(e) => (view.current.drag = { x: e.clientX, f0: view.current.f0, f1: view.current.f1 })}
      onMouseUp={() => (view.current.drag = null)}
      onDoubleClick={() => {
        view.current.f0 = 0;
        view.current.f1 = null;
        invalidate();
      }}
    />
  );
}

export default memo(SpectrumChart);
