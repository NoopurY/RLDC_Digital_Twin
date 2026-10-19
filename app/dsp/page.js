"use client";
import { useCallback, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { useTwin, engine } from "@/lib/engine/useTwin";
import { RecordedSource, parseSignalCSV } from "@/lib/engine/sources";
import { WINDOWS, getWindow, WINDOW_INFO } from "@/lib/dsp/windowing";
import { amplitudeSpectrum, amplitudeAt } from "@/lib/dsp/spectrum";
import { welchPSD, bandPowerPSD } from "@/lib/dsp/psd";
import { dft } from "@/lib/dsp/dft";
import { fft } from "@/lib/dsp/fft";
import { getFilter } from "@/lib/dsp/pipeline";
import { groupDelay } from "@/lib/dsp/filters";
import { MOTOR, bearingOrders } from "@/lib/simulation/motorModel";
import Oscilloscope from "@/components/SignalChart/Oscilloscope";
import SpectrumChart from "@/components/FFTChart/SpectrumChart";
import Spectrogram, { SPECTRO_GRADIENT } from "@/components/Spectrogram/Spectrogram";
import FeatureTable from "@/components/FeatureTable/FeatureTable";
import ResponseChart from "@/components/Charts/ResponseChart";
import { useCanvas, C, label } from "@/components/Charts/useCanvas";
import { PageHeader, Section, Slider, Segmented, Toggle, Field, Btn, Readout, cx } from "@/components/ui/primitives";

const TABS = ["Sampling", "Filtering", "FFT", "Windowing", "STFT", "PSD", "Features"];
const ORD = bearingOrders();

export default function DspPage() {
  const s = useTwin();
  const [tab, setTab] = useState("Sampling");
  if (!s) return null;
  return (
    <div>
      <PageHeader kicker="DSP analysis" title="Signal processing laboratory">
        The same synthetic accelerometer and current signals as the simulator, opened up for technical inspection. Settings here change the live pipeline that feeds the
        diagnosis.
      </PageHeader>
      <div className="sticky top-12 z-20 -mx-4 mb-6 bg-canvas/95 px-4 backdrop-blur lg:-mx-6 lg:px-6">
        <Segmented size="md" value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "Sampling" && <SamplingTab s={s} />}
      {tab === "Filtering" && <FilterTab s={s} />}
      {tab === "FFT" && <FftTab s={s} />}
      {tab === "Windowing" && <WindowTab s={s} />}
      {tab === "STFT" && <StftTab s={s} />}
      {tab === "PSD" && <PsdTab s={s} />}
      {tab === "Features" && <FeaturesTab s={s} />}
    </div>
  );
}

// ── Sampling ────────────────────────────────────────────────────────────────
function SamplingTab({ s }) {
  const { dsp } = s;
  const nyq = dsp.fs / 2;
  const frot = s.latest?.features?.shaftFrequency ?? s.params.rpm / 60;
  const N = MOTOR.commutatorSegments;
  const comps = [
    ["1× shaft rotation", frot],
    ["2× harmonic (misalignment)", 2 * frot],
    ["3× harmonic", 3 * frot],
    ["BPFO (bearing defect rate)", ORD.bpfo * frot],
    [`Commutation ripple (${N}× f_rot)`, N * frot],
    [`Ripple 2nd harmonic (${2 * N}×)`, 2 * N * frot],
    [`Ripple 3rd harmonic (${3 * N}×)`, 3 * N * frot],
  ];
  const alias = (f) => {
    const r = f % dsp.fs;
    return r > nyq ? dsp.fs - r : r;
  };
  return (
    <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-10">
        <InputSource s={s} />
        <Section title="Sampling">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sampling frequency f_s">
              <select className="sel" value={dsp.fs} disabled={s.inputMode === "external"} onChange={(e) => engine.setDsp({ fs: Number(e.target.value) })}>
                {[500, 1000, 2048, 4096, 8192].map((v) => (
                  <option key={v} value={v}>
                    {v} Hz
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Analysis window N">
              <select className="sel" value={dsp.fftSize} onChange={(e) => engine.setDsp({ fftSize: Number(e.target.value) })}>
                {[512, 1024, 2048, 4096, 8192].map((v) => (
                  <option key={v} value={v}>
                    {v} samples
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Readout size="sm" label="Nyquist f_s/2" value={nyq} unit="Hz" />
            <Readout size="sm" label="Resolution Δf" value={(dsp.fs / dsp.fftSize).toFixed(2)} unit="Hz" />
            <Readout size="sm" label="Window length" value={((dsp.fftSize / dsp.fs) * 1000).toFixed(0)} unit="ms" />
          </div>
          <p className="mt-3 text-[12px] text-muted">Changing f_s restarts acquisition with the new rate. Try 500 Hz to see the commutation ripple alias.</p>
        </Section>
      </div>
      <div className="space-y-10">
        <Section title="Nyquist check" kicker={`signal components at ${s.params.rpm} rpm vs f_s/2 = ${nyq} Hz`}>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="label-xs text-left">
                <th className="py-1 font-normal">Component</th>
                <th className="text-right font-normal">Frequency</th>
                <th className="pl-6 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {comps.map(([k, f]) => {
                const ok = f < nyq;
                return (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 text-ink">{k}</td>
                    <td className="num text-right">{f.toFixed(1)} Hz</td>
                    <td className={cx("num pl-6", ok ? "text-kinetic" : "text-crimson")}>{ok ? "resolved" : `ALIASES to ${alias(f).toFixed(1)} Hz`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-dim">
            Components above f_s/2 are not lost — they fold back to |f − k·f_s| and masquerade as lower frequencies. The simulator samples its analytic signal at f_s, so aliasing
            here is real, not illustrated.
          </p>
        </Section>
        <Section title="Raw signal" kicker="accelerometer, as sampled">
          <Oscilloscope channel="vib" seconds={0.2} mode="raw" height={170} color="#262522" />
          <div className="mt-4">
            <div className="label-xs mb-1">Armature current, as sampled</div>
            <Oscilloscope channel="cur" seconds={0.12} mode="raw" height={120} acCouple={false} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function InputSource({ s }) {
  const [fs, setFs] = useState(2048);
  const [rpm, setRpm] = useState(1500);
  const [msg, setMsg] = useState(null);
  const onFile = async (file) => {
    if (!file) return;
    const { vib, cur } = parseSignalCSV(await file.text());
    if (vib.length < 1024) return setMsg(`Need at least 1024 samples, got ${vib.length}.`);
    engine.useExternalSource(new RecordedSource({ vib, cur, fs, rpm, name: file.name }));
    setMsg(`${file.name}: ${vib.length} samples${cur ? " + current" : ""}`);
  };
  const exportCurrent = () => {
    const n = Math.min(engine.total, 8 * engine.dsp.fs);
    const v = engine.tail(n, "vib");
    const c = engine.tail(n, "cur");
    const text = ["vibration_g,current_A", ...Array.from(v, (x, i) => `${x.toFixed(6)},${c[i].toFixed(5)}`)].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `twin_signal_${engine.dsp.fs}Hz.csv`;
    a.click();
  };
  const sim = s.inputMode === "simulation";
  return (
    <Section title="Input source">
      <div className="space-y-1.5">
        {[
          ["simulation", "Digital twin simulation", "Synthetic signals from the motor model (default)."],
          ["external", "External signal", "A recorded CSV today; an ESP32 can stream into the same input later."],
        ].map(([k, t, d]) => (
          <button
            key={k}
            onClick={() => {
              if (k === "simulation") {
                engine.useExternalSource(null);
                setMsg(null);
              } else setMsg("Choose a CSV: column 1 = vibration (g), optional column 2 = current (A).");
            }}
            className="flex w-full items-start gap-2.5 text-left"
          >
            <span className={cx("mt-1 h-3 w-3 shrink-0 rounded-full border-2", (k === "simulation") === sim ? "border-copper bg-copper" : "border-line-2")} />
            <span>
              <span className="block text-[13px] text-ink">{t}</span>
              <span className="block text-[11.5px] text-muted">{d}</span>
            </span>
          </button>
        ))}
      </div>
      {!sim && <div className="mt-2 text-[12px] text-amber">Streaming {s.inputLabel}</div>}
      {(!sim || msg) && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Signal f_s (Hz)">
              <input className="inp" type="number" value={fs} onChange={(e) => setFs(Number(e.target.value) || 1000)} />
            </Field>
            <Field label="Tachometer (rpm)">
              <input className="inp" type="number" value={rpm} onChange={(e) => setRpm(Number(e.target.value) || 0)} />
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-copper hover:underline">
            <FileUp size={13} /> Load CSV signal
            <input type="file" accept=".csv,.txt" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {msg && <div className="text-[11.5px] text-muted">{msg}</div>}
          {!sim && (
            <Btn size="sm" onClick={() => engine.captureBaseline()}>
              Capture healthy reference
            </Btn>
          )}
        </div>
      )}
      <button onClick={exportCurrent} className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted hover:text-ink">
        Export current signal as CSV
      </button>
    </Section>
  );
}

// ── Filtering ───────────────────────────────────────────────────────────────
function FilterTab({ s }) {
  const { dsp } = s;
  const f = dsp.filter;
  const nyq = dsp.fs / 2;
  const set = (patch) => engine.setDsp({ filter: patch });
  const design = getFilter(f, dsp.fs);
  const gd = groupDelay(design);
  const isFir = f.family === "fir";
  return (
    <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Section title="Filter design" actions={<Toggle checked={f.enabled} onChange={(v) => set({ enabled: v })} label={f.enabled ? "Applied to pipeline" : "Bypassed"} />}>
        <div className="space-y-4">
          <Field label="Filter type">
            <Segmented
              size="md"
              value={isFir ? "fir" : "iir"}
              onChange={(v) => set({ family: v === "fir" ? "fir" : "butterworth" })}
              options={[
                { value: "fir", label: "FIR" },
                { value: "iir", label: "IIR" },
              ]}
            />
          </Field>
          {!isFir && (
            <Field label="Design">
              <Segmented
                size="md"
                value={f.family}
                onChange={(v) => set({ family: v })}
                options={[
                  { value: "butterworth", label: "Butterworth" },
                  { value: "chebyshev", label: "Chebyshev I" },
                ]}
              />
            </Field>
          )}
          <Field label="Response">
            <Segmented
              size="md"
              value={f.type}
              onChange={(v) => set({ type: v })}
              options={[
                { value: "lowpass", label: "Low-pass" },
                { value: "highpass", label: "High-pass" },
                { value: "bandpass", label: "Band-pass" },
              ]}
            />
          </Field>
          {isFir ? (
            <Slider label="Taps (length)" value={f.taps} min={7} max={255} step={2} onChange={(v) => set({ taps: v })} hint={`linear phase · delay ${(gd / dsp.fs * 1000).toFixed(1)} ms`} />
          ) : (
            <Slider label="Order" value={f.order} min={1} max={8} onChange={(v) => set({ order: v })} hint={`${f.type === "bandpass" ? 2 * f.order : f.order} poles, cascaded biquads`} />
          )}
          {f.family === "chebyshev" && <Slider label="Passband ripple" value={f.ripple} min={0.1} max={3} step={0.1} unit="dB" onChange={(v) => set({ ripple: v })} format={(v) => v.toFixed(1)} />}
          {f.type === "bandpass" ? (
            <>
              <Slider label="Lower cut-off" value={f.low} min={5} max={Math.round(nyq * 0.9)} unit="Hz" onChange={(v) => set({ low: Math.min(v, f.high - 5) })} />
              <Slider label="Upper cut-off" value={f.high} min={10} max={Math.round(nyq * 0.95)} unit="Hz" onChange={(v) => set({ high: Math.max(v, f.low + 5) })} />
            </>
          ) : (
            <Slider label="Cut-off" value={f.cutoff} min={2} max={Math.round(nyq * 0.95)} unit="Hz" onChange={(v) => set({ cutoff: v })} />
          )}
          <p className="text-[12px] leading-relaxed text-muted">
            {isFir
              ? "Windowed-sinc FIR (Hamming), applied by direct convolution y[n] = Σ h[k]·x[n−k]. Always stable, exactly linear phase."
              : "IIR from the analog prototype poles via the bilinear transform with pre-warping. Sharper for the same cost, but phase is not linear."}{" "}
            Diagnosis features are computed from the filtered signal — e.g. a 200 Hz low-pass hides the bearing resonance.
          </p>
        </div>
      </Section>
      <div className="space-y-10">
        <Section title="Frequency response" kicker={isFir ? `${design.taps.length}-tap FIR` : `${f.family} · ${design.sections.length} second-order sections`}>
          <ResponseChart design={design} fs={dsp.fs} cutoffs={f.type === "bandpass" ? [f.low, f.high] : [f.cutoff]} version={JSON.stringify(f) + dsp.fs} />
        </Section>
        <Section title="Before → after" kicker="the same samples, raw (left) and through the filter (right)">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="label-xs mb-1">Before · raw</div>
              <Oscilloscope channel="vib" seconds={0.2} mode="raw" height={160} color="#262522" />
            </div>
            <div>
              <div className="label-xs mb-1">After · {f.enabled ? "filtered" : "filter bypassed — enable it to compare"}</div>
              <Oscilloscope channel="vib" seconds={0.2} mode="filtered" height={160} />
            </div>
          </div>
          <div className="mt-4">
            <div className="label-xs mb-1">Spectrum of the filtered signal · dashed = |H(f)|</div>
            <SpectrumChart source="vib" height={200} maxFreq={nyq} />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── FFT ─────────────────────────────────────────────────────────────────────
function FftTab({ s }) {
  const [scale, setScale] = useState("linear");
  const [fmax, setFmax] = useState(400);
  const [check, setCheck] = useState(null);
  const f = s.latest?.features;
  const spec = s.latest?.spectrum;
  const nyq = s.dsp.fs / 2;
  const frot = f?.shaftFrequency ?? 0;
  const orders = [0.5, 1, 2, 3, 4, 5, 6].map((k) => ({ name: k === 0.5 ? "½×" : `${k}×`, f: k * frot })).concat([{ name: "BPFO", f: ORD.bpfo * frot }]);
  const verify = () => {
    const x = Float64Array.from(engine.tail(512, "vib"));
    const t0 = performance.now();
    const d = dft(x);
    const t1 = performance.now();
    const re = Float64Array.from(x);
    const im = new Float64Array(512);
    fft(re, im);
    const t2 = performance.now();
    let err = 0;
    for (let k = 0; k < 512; k++) err = Math.max(err, Math.hypot(re[k] - d.re[k], im[k] - d.im[k]));
    setCheck({ err, dft: t1 - t0, fft: t2 - t1 });
  };
  return (
    <div className="space-y-10">
      <Section
        title="Amplitude spectrum"
        kicker="wheel = zoom · drag = pan · double-click = reset · hover = frequency cursor"
        actions={
          <>
            <Segmented value={scale} onChange={setScale} options={[{ value: "linear", label: "Linear" }, { value: "db", label: "dB" }]} />
            <Segmented value={fmax} onChange={setFmax} options={[{ value: 200, label: "200 Hz" }, { value: 400, label: "400 Hz" }, { value: nyq, label: "Nyquist" }]} />
          </>
        }
      >
        <SpectrumChart key={fmax} source="vib" height={300} scale={scale} maxFreq={fmax} />
        <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-5">
          <Readout size="sm" label="Dominant frequency" value={f ? f.dominantFrequency.toFixed(1) : "—"} unit="Hz" tone="bad" />
          <Readout size="sm" label="Peak magnitude" value={f ? f.dominantAmplitude.toFixed(3) : "—"} unit="g" />
          <Readout size="sm" label="Harmonic ratio" value={f ? f.harmonicRatio.toFixed(2) : "—"} sub="(2× + 3×) / 1×" />
          <Readout size="sm" label="Spectral centroid" value={f ? f.spectralCentroid.toFixed(0) : "—"} unit="Hz" />
          <Readout size="sm" label="Spectral entropy" value={f ? f.spectralEntropy.toFixed(3) : "—"} />
        </div>
      </Section>
      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        <Section title="Harmonics" kicker="tachometer-referenced orders read from the spectrum">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="label-xs text-left">
                <th className="py-1 font-normal">Order</th>
                <th className="text-right font-normal">Frequency</th>
                <th className="text-right font-normal">Amplitude</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const a = spec && o.f > 0 && o.f < nyq ? amplitudeAt(spec.mag, spec.df, o.f, Math.max(1.5 * spec.df, 0.5)).amp : null;
                return (
                  <tr key={o.name} className="border-t border-line">
                    <td className="py-1.5 text-ink">{o.name}</td>
                    <td className="num text-right">{o.f.toFixed(1)} Hz</td>
                    <td className="num text-right">{a == null ? "—" : `${(a * 1000).toFixed(1)} mg`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
        <Section title="FFT vs DFT" kicker="independent check of the transform">
          <p className="text-[12.5px] leading-relaxed text-muted">
            The radix-2 FFT computes the same X[k] = Σ x[n]·e<sup>−j2πkn/N</sup> as the direct DFT, in O(N log N) instead of O(N²). Run both on the latest 512 samples:
          </p>
          <Btn className="mt-3" size="sm" onClick={verify}>
            Compare on live data
          </Btn>
          {check && (
            <div className="num mt-3 space-y-1 text-[12.5px]">
              <div>
                max |X<sub>FFT</sub> − X<sub>DFT</sub>| = <span className="text-kinetic">{check.err.toExponential(2)}</span>
              </div>
              <div className="text-muted">
                DFT {check.dft.toFixed(2)} ms · FFT {check.fft.toFixed(3)} ms · ≈ {(check.dft / Math.max(check.fft, 1e-3)).toFixed(0)}× faster
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

// ── Windowing ───────────────────────────────────────────────────────────────
const WIN_COLORS = { rectangular: "#A8402F", hann: "#2F5D46", hamming: "#B26A35", blackman: "#7C838B" };

function WindowTab({ s }) {
  const frot = s.latest?.features?.shaftFrequency ?? 25;
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const PL = 40;
      const PR = 10;
      const PT = 10;
      const PB = 20;
      const pw = w - PL - PR;
      const ph = h - PT - PB;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, PT, pw, ph);
      const N = engine.dsp.fftSize;
      const seg = engine.tail(N, "vib");
      if (!seg || seg.length < N) return;
      const fs = engine.dsp.fs;
      const f0 = 0;
      const f1 = Math.min(fs / 2, 4.5 * frot);
      const X = (f) => PL + ((f - f0) / (f1 - f0)) * pw;
      const Y = (db) => PT + ph - ((Math.max(-100, db) + 100) / 100) * ph;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (let db = 0; db >= -100; db -= 20) {
        ctx.moveTo(PL, Y(db));
        ctx.lineTo(PL + pw, Y(db));
        label(ctx, `${db}`, PL - 4, Y(db) + 3, { align: "right", color: C.axis, size: 9 });
      }
      for (let k = 1; k <= 4; k++) {
        ctx.moveTo(X(k * frot), PT);
        ctx.lineTo(X(k * frot), PT + ph);
        label(ctx, `${k}×`, X(k * frot), h - 6, { align: "center", color: C.axis, size: 9 });
      }
      ctx.stroke();
      label(ctx, "dB", 4, PT + 9, { color: C.axis, size: 9 });
      for (const win of WINDOWS) {
        const sp = amplitudeSpectrum(seg, fs, { window: win });
        let ref = 0;
        for (const v of sp.mag) ref = Math.max(ref, v);
        ctx.strokeStyle = WIN_COLORS[win];
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        let started = false;
        for (let k = 1; k < sp.mag.length; k++) {
          const fq = k * sp.df;
          if (fq > f1) break;
          const y = Y(20 * Math.log10(sp.mag[k] / ref + 1e-9));
          started ? ctx.lineTo(X(fq), y) : ctx.moveTo(X(fq), y);
          started = true;
        }
        ctx.stroke();
      }
    },
    () => Math.floor((s.latest?.t ?? 0) * 2)
  );
  return (
    <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Section title="Spectral leakage" kicker="the same live window analysed with each window function, normalised to its peak">
        <canvas ref={ref} style={{ height: 320 }} className="block w-full" />
        <div className="mt-2 flex flex-wrap gap-4">
          {WINDOWS.map((w) => (
            <span key={w} className="flex items-center gap-1.5 text-[12px] text-muted">
              <span className="h-[2px] w-4" style={{ background: WIN_COLORS[w] }} />
              {w}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          When a tone does not fall exactly on an FFT bin its energy leaks into neighbouring bins. The rectangular window has the narrowest peak but leaks most; Hann, Hamming and
          Blackman trade a wider main lobe for much lower side-lobes, keeping small harmonics visible beside a large 1× peak.
        </p>
      </Section>
      <Section title="Window properties">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="label-xs text-left">
              <th className="py-1 font-normal">Window</th>
              <th className="text-right font-normal">Side-lobe</th>
              <th className="text-right font-normal">ENBW</th>
              <th className="text-right font-normal">Gain</th>
            </tr>
          </thead>
          <tbody>
            {WINDOWS.map((w) => {
              const g = getWindow(w, s.dsp.fftSize);
              return (
                <tr key={w} className="border-t border-line">
                  <td className="py-1.5 capitalize text-ink">{w}</td>
                  <td className="num text-right">{WINDOW_INFO[w].sidelobe}</td>
                  <td className="num text-right">{g.enbw.toFixed(2)} bins</td>
                  <td className="num text-right">{g.coherentGain.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Field label="Window used by the live pipeline" className="mt-4">
          <Segmented value={s.dsp.window} onChange={(v) => engine.setDsp({ window: v })} options={WINDOWS.map((w) => ({ value: w, label: w }))} />
        </Field>
      </Section>
    </div>
  );
}

// ── STFT ────────────────────────────────────────────────────────────────────
function StftTab({ s }) {
  const [db, setDb] = useState([-50, 0]);
  const { dsp } = s;
  const hop = dsp.stft.nperseg * (1 - dsp.stft.overlap);
  return (
    <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Spectrogram" kicker="short-time Fourier transform of the vibration signal, scrolling live">
        <Spectrogram height={420} maxFreq={dsp.fs / 2} dbMin={db[0]} dbMax={db[1]} />
        <div className="mt-2 flex items-center gap-2">
          <span className="num text-[10px] text-dim">{db[0]} dB</span>
          <span className="h-2 w-48" style={{ background: SPECTRO_GRADIENT }} />
          <span className="num text-[10px] text-dim">{db[1]} dB</span>
        </div>
      </Section>
      <Section title="Frame settings">
        <div className="space-y-4">
          <Field label="Frame length">
            <Segmented value={dsp.stft.nperseg} onChange={(v) => engine.setDsp({ stft: { nperseg: v } })} options={[128, 256, 512, 1024].map((v) => ({ value: v, label: String(v) }))} />
          </Field>
          <Field label="Overlap">
            <Segmented value={dsp.stft.overlap} onChange={(v) => engine.setDsp({ stft: { overlap: v } })} options={[0.5, 0.75, 0.875].map((v) => ({ value: v, label: `${v * 100}%` }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Readout size="sm" label="Δf (frequency)" value={(dsp.fs / dsp.stft.nperseg).toFixed(1)} unit="Hz" />
            <Readout size="sm" label="Δt (hop)" value={((hop / dsp.fs) * 1000).toFixed(0)} unit="ms" />
          </div>
          <p className="text-[12px] leading-relaxed text-muted">
            Longer frames resolve frequency better but smear time; shorter frames do the opposite (Δf·Δt ≥ constant). Bearing impacts show as vertical streaks near the
            resonance band; imbalance as a steady line at 1×.
          </p>
          <Slider label="Colour floor" value={db[0]} min={-100} max={-20} unit="dB" onChange={(v) => setDb([v, db[1]])} />
          <Slider label="Colour ceiling" value={db[1]} min={-30} max={10} unit="dB" onChange={(v) => setDb([db[0], v])} />
        </div>
      </Section>
    </div>
  );
}

// ── PSD ─────────────────────────────────────────────────────────────────────
function PsdTab({ s }) {
  const [nper, setNper] = useState(256);
  const cache = useRef({ key: null, v: null });
  const t = s.latest?.t;
  const getSpec = useCallback(() => {
    const key = `${t}|${nper}`;
    if (cache.current.key !== key) {
      const fs = engine.dsp.fs;
      const seg = engine.tail(Math.min(engine.total, 4 * fs), "vib");
      if (!seg || seg.length < nper * 2) return null;
      const { psd, df } = welchPSD(seg, fs, nper);
      cache.current = { key, v: { mag: psd.map(Math.sqrt), psd, df, fs, key } };
    }
    return cache.current.v;
  }, [t, nper]);
  const p = getSpec();
  const fs = s.dsp.fs;
  const bands = p
    ? [
        ["Low (≤ 6.5× f_rot)", 0, 6.5 * (s.latest?.features?.shaftFrequency ?? 25)],
        ["Mid", 6.5 * (s.latest?.features?.shaftFrequency ?? 25), 0.2 * fs],
        ["High (≥ 0.2·f_s)", 0.2 * fs, fs / 2],
      ].map(([k, a, b]) => [k, bandPowerPSD(p.psd, p.df, a, b)])
    : [];
  const total = bands.reduce((a, [, v]) => a + v, 0) || 1;
  return (
    <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Section title="Power spectral density" kicker="Welch's method · Hann segments · 50 % overlap · last 4 s">
        <SpectrumChart key={nper} source="vib" height={320} scale="db" maxFreq={fs / 2} getSpecOverride={getSpec} unitLabel="dB g²/Hz" showFilter={false} showPeaks={false} />
      </Section>
      <Section title="Settings & band power">
        <Field label="Segment length">
          <Segmented value={nper} onChange={setNper} options={[128, 256, 512, 1024].map((v) => ({ value: v, label: String(v) }))} />
        </Field>
        <p className="mt-3 text-[12px] leading-relaxed text-muted">
          Averaging periodograms of many short segments lowers the variance of the estimate at the cost of resolution (Δf = {(fs / nper).toFixed(1)} Hz). The area under the PSD equals
          the signal's mean-square value (Parseval).
        </p>
        <table className="mt-4 w-full text-[12.5px]">
          <tbody>
            {bands.map(([k, v]) => (
              <tr key={k} className="border-t border-line">
                <td className="py-1.5 text-ink">{k}</td>
                <td className="num text-right">{(v * 1e6).toFixed(0)} mg²</td>
                <td className="num w-14 text-right text-muted">{((v / total) * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}

// ── Features ────────────────────────────────────────────────────────────────
function FeaturesTab({ s }) {
  const f = s.latest?.features;
  return (
    <div className="space-y-10">
      <FeatureTable s={s} />
      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        <Section title="Envelope spectrum" kicker={`bearing demodulation · band ${(0.2 * s.dsp.fs).toFixed(0)}–${(0.42 * s.dsp.fs).toFixed(0)} Hz`}>
          <SpectrumChart source="env" height={200} />
          <p className="mt-2 text-[12px] text-muted">
            |analytic signal| of the resonance band → FFT. Bearing impacts appear as lines at BPFO and its harmonics. BPFO SNR <span className="num text-ink">{f ? f.bpfoSNR.toFixed(1) : "—"}×</span>.
          </p>
        </Section>
        <Section title="Motor current signature" kicker="armature current waveform and spectrum (MCSA)">
          <Oscilloscope channel="cur" seconds={0.12} height={110} acCouple={false} />
          <div className="mt-3">
            <SpectrumChart source="cur" height={150} />
          </div>
        </Section>
      </div>
    </div>
  );
}
