"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pause, Radio } from "lucide-react";
import { engine } from "@/lib/engine/twinEngine";
import { filterSegment } from "@/lib/dsp/pipeline";
import { amplitudeSpectrum } from "@/lib/dsp/spectrum";
import Oscilloscope from "@/components/SignalChart/Oscilloscope";
import SpectrumChart from "@/components/FFTChart/SpectrumChart";
import Spectrogram, { snapshotSpectrogram } from "@/components/Spectrogram/Spectrogram";
import { Section, cx } from "@/components/ui/primitives";

const MAX_BACK = 10; // seconds of history available for scrubbing

/**
 * SIGNAL DNA — one synthetic vibration signal seen three ways, locked to one
 * timeline.  LIVE follows acquisition; FREEZE stops all three views at the
 * same instant and the scrubber moves them back together through the buffer.
 */
export default function SignalDNA({ s, focus }) {
  const [frozen, setFrozen] = useState(null); // { end, snap }
  const [back, setBack] = useState(0);
  const fs = s.dsp.fs;
  const N = s.dsp.fftSize;
  const fmax = Math.min(fs / 2, 400);

  const freeze = () => {
    setFrozen({ end: engine.total, snap: snapshotSpectrogram() });
    setBack(0);
  };
  const goLive = () => {
    setFrozen(null);
    setBack(0);
  };
  const end = frozen ? Math.max(N + 600, frozen.end - Math.round(back * fs)) : null;

  // FFT of exactly the window that the time view ends at (same filter as the pipeline).
  const cache = useRef({ key: null, spec: null });
  const getSpec = useCallback(() => {
    if (end == null) return null;
    if (cache.current.key !== end) {
      const seg = engine.getSegment(end - N - 512, N + 512, "vib");
      if (!seg) return cache.current.spec;
      const x = filterSegment(seg, N, engine.dsp.filter, fs);
      cache.current = { key: end, spec: { ...amplitudeSpectrum(x, fs, { window: engine.dsp.window }), key: end } };
    }
    return cache.current.spec;
  }, [end, N, fs]);

  const getEnd = useMemo(() => (end == null ? undefined : () => end), [end]);
  const liveEndT = engine.total / fs;
  const windowRange = frozen ? [(end - N) / fs, end / fs] : [liveEndT - N / fs, liveEndT];
  const f = s.latest?.features;

  return (
    <Section
      title="Signal DNA"
      kicker="one synthetic accelerometer signal · time, frequency and time–frequency views on a shared timeline"
      focus={focus === "time" || focus === "fft" || focus === "spectrogram"}
      actions={
        <div className="flex items-center gap-3">
          {frozen ? (
            <button onClick={goLive} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-copper hover:underline">
              <Radio size={12} /> Back to live
            </button>
          ) : (
            <button onClick={freeze} className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted hover:text-ink">
              <Pause size={12} /> Freeze &amp; scrub
            </button>
          )}
          <span className={cx("num text-[11px]", frozen ? "text-copper" : "text-kinetic")}>{frozen ? `t − ${back.toFixed(2)} s` : "● LIVE"}</span>
        </div>
      }
    >
      {frozen && (
        <div className="mb-3 flex items-center gap-3">
          <span className="label-xs">Timeline</span>
          <input
            type="range"
            className="rng flex-1"
            min={0}
            max={MAX_BACK}
            step={0.01}
            value={MAX_BACK - back}
            style={{ "--pct": `${((MAX_BACK - back) / MAX_BACK) * 100}%`, "--acc": "var(--color-copper)" }}
            onChange={(e) => setBack(MAX_BACK - Number(e.target.value))}
            aria-label="Scrub timeline"
          />
          <span className="num w-24 text-right text-[11px] text-muted">−{MAX_BACK} s … freeze</span>
        </div>
      )}

      <div className={cx("grid gap-x-6 gap-y-4", focus === "time" && "")}>
        <div className={cx(focus === "time" && "focus-zone")}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label-xs">Time domain · vibration (g){s.dsp.filter.enabled ? " · filtered over raw" : ""}</span>
            <span className="num text-[11px] text-muted">
              RMS <span className="text-ink">{f ? (f.rms * 1000).toFixed(0) : "—"}</span> mg · kurtosis <span className="text-ink">{f ? f.kurtosis.toFixed(2) : "—"}</span> · crest{" "}
              <span className="text-ink">{f ? f.crestFactor.toFixed(2) : "—"}</span>
            </span>
          </div>
          <Oscilloscope channel="vib" seconds={0.25} mode="both" height={150} getEnd={getEnd} />
        </div>
        <div className={cx(focus === "fft" && "focus-zone")}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label-xs">Frequency domain · FFT ({N} pts, Δf {(fs / N).toFixed(2)} Hz) — wheel to zoom</span>
            <span className="num text-[11px] text-muted">
              dominant <span className="text-crimson">{f ? f.dominantFrequency.toFixed(1) : "—"} Hz</span> · 1× <span className="text-ink">{f ? (f.a1 * 1000).toFixed(0) : "—"}</span> mg · 2×/1×{" "}
              <span className="text-ink">{f ? (f.a2 / Math.max(f.a1, 1e-6)).toFixed(2) : "—"}</span>
            </span>
          </div>
          <SpectrumChart source="vib" height={200} maxFreq={fmax} getSpecOverride={frozen ? getSpec : undefined} />
        </div>
        <div className={cx(focus === "spectrogram" && "focus-zone")}>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="label-xs">Time–frequency · STFT spectrogram · shaded = FFT window</span>
            <span className="num text-[11px] text-muted">
              high-band energy <span className="text-ink">{f ? (f.bandEnergyHigh * 100).toFixed(0) : "—"}%</span>
            </span>
          </div>
          <Spectrogram height={190} maxFreq={Math.min(fs / 2, 800)} snapshot={frozen?.snap} windowRange={windowRange} />
        </div>
      </div>
    </Section>
  );
}
