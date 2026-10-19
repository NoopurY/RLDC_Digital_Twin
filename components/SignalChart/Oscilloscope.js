"use client";
import { memo, useRef } from "react";
import { engine } from "@/lib/engine/twinEngine";
import { applyFilter } from "@/lib/dsp/filters";
import { getFilter } from "@/lib/dsp/pipeline";
import { useCanvas, C, drawGrid, label, trace } from "@/components/Charts/useCanvas";

/**
 * Roll-mode oscilloscope over the engine's live sample buffer.
 * mode: "raw" | "filtered" | "both" (filtered overlays raw).
 */
function Oscilloscope({ channel = "vib", seconds = 0.25, mode = "raw", height = 170, color, acCouple = channel === "vib", title, getEnd }) {
  const scale = useRef({ lo: -0.1, hi: 0.1 });
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const fs = engine.dsp.fs;
      const n = Math.round(seconds * fs);
      const pad = 512;
      // Roll smoothly: the window ends at the interpolated "now" index, not at the last block boundary.
      const end = getEnd ? getEnd() : engine.liveIndex();
      const seg = engine.getSegment(end - n - pad, n + pad, channel);
      const PL = 44;
      const PR = 8;
      const PT = 8;
      const PB = 18;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      drawGrid(ctx, PL, PT, pw, ph, 10, 6);
      if (!seg || seg.length < n + pad) {
        label(ctx, "acquiring…", PL + pw / 2, PT + ph / 2, { align: "center" });
        return;
      }
      const raw = seg.subarray(pad);
      const showFiltered = channel === "vib" && engine.dsp.filter.enabled && mode !== "raw";
      const filt = showFiltered ? applyFilter(getFilter(engine.dsp.filter, fs), seg).subarray(pad) : null;
      const primary = mode === "filtered" && filt ? filt : raw;

      // Auto-range with slow decay (scope-style)
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < primary.length; i++) {
        if (primary[i] < lo) lo = primary[i];
        if (primary[i] > hi) hi = primary[i];
      }
      if (acCouple) {
        const m = Math.max(Math.abs(lo), Math.abs(hi), 0.02) * 1.15;
        lo = -m;
        hi = m;
      } else {
        const span = Math.max(hi - lo, 0.2);
        const mid = (hi + lo) / 2;
        lo = mid - span * 0.65;
        hi = mid + span * 0.65;
      }
      const s = scale.current;
      s.lo = lo < s.lo ? lo : s.lo + (lo - s.lo) * 0.06;
      s.hi = hi > s.hi ? hi : s.hi + (hi - s.hi) * 0.06;
      const Y = (v) => PT + ph - ((v - s.lo) / (s.hi - s.lo)) * ph;

      // Decimate to ≤ 2 points per pixel (min/max per column keeps impulses visible)
      const draw = (arr, col, opts) => {
        const cols = Math.min(arr.length, Math.floor(pw));
        const xs = [];
        const ys = [];
        const per = arr.length / cols;
        for (let c = 0; c < cols; c++) {
          const a = Math.floor(c * per);
          const b = Math.max(a + 1, Math.floor((c + 1) * per));
          let mn = Infinity;
          let mx = -Infinity;
          for (let i = a; i < b; i++) {
            if (arr[i] < mn) mn = arr[i];
            if (arr[i] > mx) mx = arr[i];
          }
          const x = PL + (c / cols) * pw;
          xs.push(x, x);
          ys.push(Y(mn), Y(mx));
        }
        trace(ctx, xs, ys, col, opts);
      };
      const base = color ?? (channel === "cur" ? C.crimson : C.green);
      if (mode === "both" && filt) {
        draw(raw, "rgba(38,37,34,0.28)", { width: 1, glow: false });
        draw(filt, base, {});
      } else draw(primary, base, {});

      // zero line + axes
      if (s.lo < 0 && s.hi > 0) {
        ctx.strokeStyle = C.gridStrong;
        ctx.beginPath();
        ctx.moveTo(PL, Math.round(Y(0)) + 0.5);
        ctx.lineTo(PL + pw, Math.round(Y(0)) + 0.5);
        ctx.stroke();
      }
      const unit = channel === "cur" ? "A" : "g";
      for (let j = 0; j <= 6; j += 2) {
        const v = s.hi - ((s.hi - s.lo) * j) / 6;
        label(ctx, `${v.toFixed(Math.abs(s.hi - s.lo) < 0.5 ? 3 : 2)}`, PL - 4, PT + (ph * j) / 6 + 3, { align: "right", color: C.axis, size: 9 });
      }
      label(ctx, unit, 4, PT + 10, { color: C.axis, size: 9 });
      const ms = seconds * 1000;
      for (let i = 0; i <= 10; i += 2) label(ctx, `${(-ms + (ms * i) / 10).toFixed(0)}`, PL + (pw * i) / 10, h - 5, { align: "center", color: C.axis, size: 9 });
      label(ctx, "ms", PL + pw, h - 5, { align: "right", color: C.axis, size: 9 });
      if (title) label(ctx, title, PL + 6, PT + 12, { color: C.text, size: 10 });
    },
    () => (getEnd ? `${getEnd()}|${engine.dsp.filter.enabled}` : engine.running ? performance.now() : engine.total)
  );
  return <canvas ref={ref} style={{ height }} className="block w-full" />;
}

export default memo(Oscilloscope);
