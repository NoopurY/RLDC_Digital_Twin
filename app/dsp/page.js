"use client";
import { useEffect, useRef, useState } from "react";
import { useTwin } from "@/lib/engine/useTwin";
import { FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { labSignal, withWarmup } from "@/lib/dsp/labSignals";
import { analyzeFrequency, harmonicAt, isPowerOfTwo } from "@/lib/dsp/frequencyAnalysis";
import { RESPONSES, designIIR, validate, magnitude, applyIIR, formatHz } from "@/lib/dsp/iirDesign";
import { amplitudeSpectrum } from "@/lib/dsp/spectrum";
import { timeStats } from "@/lib/dsp/statistics";
import LinePlot from "@/components/Charts/LinePlot";
import FilterControls from "@/components/DSP/FilterControls";
import { PageHeader, Section, Segmented, Field, Btn, Readout, Chip, Toggle, cx } from "@/components/ui/primitives";

const TABS = [
  { value: "fft", label: "Frequency Analysis (DFT & FFT)" },
  { value: "iir", label: "Digital Filtering (IIR)" },
];

const SOURCES = {
  vib: { label: "Motor vibration", unit: "g" },
  cur: { label: "Armature current", unit: "A" },
  test: { label: "Clean test signal", unit: "" },
};

/** Simulator state used read-only: operating point and selected faults. */
const motorState = (s) => ({ params: s.params, faults: s.faultTargets ?? s.faults });

function faultText(s) {
  const f = s.faultTargets ?? s.faults;
  const on = FAULT_TYPES.filter((k) => f[k] > 0.005);
  return on.length ? on.map((k) => `${FAULT_INFO[k].label} ${(f[k] * 100).toFixed(0)}%`).join(" + ") : "no faults";
}

export default function DspPage() {
  const s = useTwin();
  const [tab, setTab] = useState("fft");
  if (!s) return null;
  return (
    <div>
      <PageHeader kicker="DSP analysis" title="Signal processing laboratory">
        Two modules applied to the motor signals: the frequency content of a signal (DFT & FFT) and digital IIR filters that reshape it. Motor signals are generated from the
        simulator&apos;s current operating point and faults, read-only — nothing here changes the simulator.
      </PageHeader>
      <div className="sticky top-12 z-20 -mx-4 mb-8 bg-canvas/95 px-4 backdrop-blur lg:-mx-6 lg:px-6">
        <Segmented size="md" value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "fft" ? <FrequencyModule s={s} /> : <FilterModule s={s} />}
    </div>
  );
}

function Step({ n, title, kicker, children, actions }) {
  return (
    <Section title={`${n} · ${title}`} kicker={kicker} actions={actions}>
      {children}
    </Section>
  );
}

function SourcePicker({ value, onChange, s, testLabel = SOURCES.test.label }) {
  return (
    <div className="space-y-2">
      <Segmented
        size="md"
        value={value}
        onChange={onChange}
        options={Object.entries(SOURCES).map(([v, o]) => ({ value: v, label: v === "test" ? testLabel : o.label }))}
      />
      <p className="text-[12px] text-muted">
        {value === "test"
          ? "x(t) = sin(2π·25t) + 0.5·sin(2π·50t + 0.3) + 0.25·sin(2π·75t + 1.1) — a known 25 Hz tone with 2× and 3× harmonics, for checking results by hand."
          : `Simulator state (read-only): ${s.params.rpm} rpm · ${s.params.load}% load · ${faultText(s)}. Change faults in the Simulator to see them here.`}
      </p>
    </div>
  );
}

function Explain({ items }) {
  return (
    <dl className="grid gap-x-10 gap-y-4 md:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[13px] font-semibold text-ink">{k}</dt>
          <dd className="mt-1 text-[12.5px] leading-relaxed text-muted">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Eq = ({ children }) => <span className="num whitespace-nowrap text-ink">{children}</span>;

// ── Frequency Analysis (DFT & FFT) ─────────────────────────────────────────
const N_PRESETS = [64, 128, 256, 512];

function FrequencyModule({ s }) {
  const [cfg, setCfg] = useState({ source: "vib", fs: 512, N: 256 });
  const [nText, setNText] = useState("256");
  const [res, setRes] = useState(null);
  const [view, setView] = useState("freq");
  const [recon, setRecon] = useState(false);
  const runs = useRef(0);
  const set = (p) => setCfg((c) => ({ ...c, ...p }));

  const nValid = Number.isInteger(cfg.N) && cfg.N >= 8 && cfg.N <= 2048;
  const radix2 = isPowerOfTwo(cfg.N);

  const run = () => {
    if (!nValid) return;
    const sig = labSignal(cfg.source, { ...motorState(s), fs: cfg.fs, n: cfg.N });
    const fa = analyzeFrequency(sig.x, cfg.fs);
    runs.current += 1;
    setRes({ sig, fa, cfg, id: runs.current });
  };
  useEffect(run, []); // first result on arrival; afterwards only on Execute
  const stale = res && JSON.stringify(res.cfg) !== JSON.stringify(cfg);

  return (
    <div className="space-y-12">
      <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Step n={1} title="Select input signal">
          <SourcePicker value={cfg.source} onChange={(v) => set({ source: v })} s={s} />
        </Step>
        <Step n={2} title="Configure">
          <div className="space-y-4">
            <Field label="Sampling frequency f_s">
              <Segmented size="md" value={cfg.fs} onChange={(v) => set({ fs: v })} options={[256, 512, 1024, 2048].map((v) => ({ value: v, label: `${v} Hz` }))} />
            </Field>
            <Field label="Number of points N">
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  size="md"
                  value={cfg.N}
                  onChange={(v) => {
                    set({ N: v });
                    setNText(String(v));
                  }}
                  options={N_PRESETS.map((v) => ({ value: v, label: String(v) }))}
                />
                <input
                  className="inp w-24"
                  type="number"
                  value={nText}
                  onChange={(e) => {
                    setNText(e.target.value);
                    set({ N: Number(e.target.value) });
                  }}
                  aria-label="Custom N"
                />
              </div>
            </Field>
            {!nValid ? (
              <p className="text-[12px] text-crimson">N must be a whole number between 8 and 2048.</p>
            ) : !radix2 ? (
              <p className="text-[12px] text-amber">
                N = {cfg.N} is not a power of two. The radix-2 FFT needs N = 2<sup>m</sup> (64, 128, 256, 512 …), so only the direct DFT will be computed.
              </p>
            ) : (
              <p className="text-[12px] text-muted">
                N = 2<sup>{Math.log2(cfg.N)}</sup> ✓ radix-2 · record length {((cfg.N / cfg.fs) * 1000).toFixed(0)} ms · Δf = f_s/N = {(cfg.fs / cfg.N).toFixed(2)} Hz
              </p>
            )}
          </div>
        </Step>
      </div>

      <Step
        n={3}
        title="Execute"
        kicker={stale ? "settings changed — execute again to update the results" : res ? `N = ${res.fa.N} samples at ${res.fa.fs} Hz` : null}
        actions={
          <Btn variant="primary" onClick={run} disabled={!nValid}>
            {radix2 ? "Compute DFT & FFT" : "Compute DFT"}
          </Btn>
        }
      >
        {res && <TransformCheck fa={res.fa} />}
      </Step>

      {res && (
        <Step
          n={4}
          title="Visualize"
          kicker={`${SOURCES[res.cfg.source].label} · ${res.fa.N} points`}
          actions={
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "time", label: "Time domain" },
                { value: "freq", label: "Frequency domain" },
              ]}
            />
          }
        >
          {view === "time" ? <TimeView res={res} recon={recon} setRecon={setRecon} /> : <FreqView res={res} />}
        </Step>
      )}

      <Step n={5} title="Mathematics">
        <Explain
          items={[
            [
              "Discrete Fourier Transform (DFT)",
              <>
                <Eq>X[k] = Σ x[n]·e^(−j2πkn/N)</Eq>, n = 0 … N−1. Each bin k correlates the signal with a complex sinusoid at f<sub>k</sub> = k·f<sub>s</sub>/N. Computing all N bins
                directly needs N² complex multiplications.
              </>,
            ],
            [
              "Fast Fourier Transform (FFT)",
              <>
                The radix-2 decimation-in-time FFT splits x[n] into even and odd samples recursively, reusing results through butterflies. It gives exactly the same X[k] with
                (N/2)·log₂N multiplications — but N must be a power of two.
              </>,
            ],
            [
              "Inverse FFT",
              <>
                <Eq>x[n] = (1/N)·Σ X[k]·e^(+j2πkn/N)</Eq>. Running the same algorithm with the opposite sign and dividing by N returns the original samples; the reconstruction
                error is only floating-point round-off.
              </>,
            ],
            [
              "Frequency resolution",
              <>
                <Eq>Δf = f_s / N = 1 / T_record</Eq>. Two tones closer than Δf fall into the same bin. A tone between two bins spreads into its neighbours (leakage), because the
                record is not a whole number of periods (no window is applied here).
              </>,
            ],
            [
              "Harmonics",
              <>
                The shaft rotation frequency is <Eq>f_rot = RPM / 60</Eq>. Forces that repeat once per revolution appear at 1× f_rot; distorted or repeated twice/three times per
                revolution they also appear at 2× and 3×.
              </>,
            ],
          ]}
        />
      </Step>

      <Step n={6} title="Engineering relevance">
        <Explain
          items={[
            [
              "Why the FFT for motor vibration",
              "Most machine faults are periodic with shaft rotation, so they are easier to separate as lines in the spectrum than as shapes in the waveform. The FFT makes this cheap enough to run continuously on embedded hardware.",
            ],
            [
              "Reading 1×, 2×, 3×",
              "A large 1× component is typical of rotor imbalance; a strong 2× (and 3×) is often associated with misalignment or looseness. These are indications to investigate — the simulator’s diagnosis combines several features and trends before naming a fault.",
            ],
            [
              "Choosing N and f_s",
              "f_s must be more than twice the highest frequency of interest (Nyquist); N then sets the resolution. Larger N separates closely spaced lines but needs a longer, steadier recording.",
            ],
          ]}
        />
      </Step>
    </div>
  );
}

function TransformCheck({ fa }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Readout size="sm" label="DFT · multiplications" value={fa.ops.dft.toLocaleString()} sub={`measured ${fa.dft.time.toFixed(2)} ms`} />
      <Readout
        size="sm"
        label="FFT · multiplications"
        value={fa.fft ? fa.ops.fft.toLocaleString() : "—"}
        sub={fa.fft ? `measured ${fa.fft.time.toFixed(3)} ms` : "N is not a power of two"}
        tone={fa.fft ? "ok" : undefined}
      />
      <Readout size="sm" label="max |X_FFT − X_DFT|" value={fa.fft ? fa.fft.maxDiff.toExponential(1) : "—"} sub="same transform, two algorithms" />
      <Readout size="sm" label="IFFT reconstruction error" value={fa.fft ? fa.fft.reconErr.toExponential(1) : "—"} sub="max |x̂[n] − x[n]|" />
    </div>
  );
}

function TimeView({ res, recon, setRecon }) {
  const { sig, fa } = res;
  const unit = SOURCES[res.cfg.source].unit;
  const series = [{ y: sig.x, dx: 1000 / fa.fs, color: "#262522", kind: fa.N <= 64 ? "stem" : "line", label: "x[n]" }];
  if (recon && fa.fft) series.push({ y: fa.fft.recon, dx: 1000 / fa.fs, color: "#B26A35", dash: [5, 4], width: 1.6, label: "IFFT" });
  return (
    <div>
      <LinePlot series={series} xUnit="ms" yUnit={unit} height={260} version={`${res.id}|${recon}`} />
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <Toggle checked={recon} onChange={setRecon} label="Overlay IFFT reconstruction" />
        {recon && fa.fft && (
          <span className="text-[12px] text-muted">
            The dashed IFFT(FFT(x)) lies on top of x[n]: max error <span className="num text-ink">{fa.fft.reconErr.toExponential(1)}</span> {unit}.
          </span>
        )}
        {recon && !fa.fft && <span className="text-[12px] text-amber">IFFT needs a radix-2 N.</span>}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Original signal: {fa.N} samples at f_s = {fa.fs} Hz ({((fa.N / fa.fs) * 1000).toFixed(0)} ms).
      </p>
    </div>
  );
}

function FreqView({ res }) {
  const { fa, sig } = res;
  const unit = SOURCES[res.cfg.source].unit;
  const frot = sig.frot;
  const harm = [1, 2, 3].map((k) => ({ k, f: k * frot, h: frot > 0 && k * frot < fa.nyquist ? harmonicAt(fa.mag, fa.df, k * frot) : null }));
  const markers = harm.filter(({ k, h }) => h && (k === 1 || h.present)).map(({ k, f }) => ({ x: f, label: k === 1 ? "f_rot" : `${k}×` }));
  return (
    <div>
      <LinePlot
        series={[{ y: fa.mag, dx: fa.df, color: "#2F5D46", kind: fa.N <= 128 ? "stem" : "line", width: 1.5, label: "|X|" }]}
        markers={markers}
        xMin={0}
        xMax={fa.nyquist}
        yMin={0}
        xUnit="Hz"
        yUnit={unit ? `${unit} (amplitude)` : "amplitude"}
        height={260}
        version={res.id}
      />
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Readout size="sm" label="Dominant frequency" value={fa.dominant.freq.toFixed(2)} unit="Hz" tone="copper" sub={`bin k = ${fa.dominant.bin}`} />
        <Readout size="sm" label="Frequency resolution Δf" value={fa.df.toFixed(2)} unit="Hz" sub={`f_s/N = ${fa.fs}/${fa.N}`} />
        <Readout size="sm" label="Nyquist f_s/2" value={fa.nyquist} unit="Hz" />
        <Readout size="sm" label="Shaft f_rot = RPM/60" value={frot.toFixed(2)} unit="Hz" sub={`${(frot * 60).toFixed(0)} rpm`} />
      </div>
      <table className="mt-5 w-full max-w-2xl text-[12.5px]">
        <thead>
          <tr className="label-xs text-left">
            <th className="py-1 font-normal">Order</th>
            <th className="text-right font-normal">Expected</th>
            <th className="text-right font-normal">Nearest bin</th>
            <th className="text-right font-normal">Amplitude</th>
            <th className="pl-6 font-normal">In this spectrum</th>
          </tr>
        </thead>
        <tbody>
          {harm.map(({ k, f, h }) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-ink">{k === 1 ? "1× (f_rot)" : `${k}×`}</td>
              <td className="num text-right">{f.toFixed(1)} Hz</td>
              <td className="num text-right">{h ? `${h.freq.toFixed(1)} Hz` : "—"}</td>
              <td className="num text-right">{h ? h.amp.toPrecision(3) : "—"}</td>
              <td className={cx("pl-6", h?.present ? "text-ink" : "text-dim")}>{!h ? "above Nyquist" : h.present ? "visible above noise floor" : "not distinguishable"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-dim">
        Mean removed before the transform (DC not shown). Amplitudes are single-sided, 2|X[k]|/N. A visible harmonic is an observation, not a confirmed fault.
      </p>
    </div>
  );
}

// ── Digital Filtering (IIR) ────────────────────────────────────────────────
const BAND_RESONANCE = (fs) => Math.min(1800, 0.3 * fs); // structural resonance excited by bearing impacts in the motor model

const DEFAULT_FILTER = { family: "butterworth", response: "lowpass", method: "bilinear", order: 4, fc: 200, fLow: 100, fHigh: 400, ripple: 1 };

function runFilter(cfg, s) {
  const design = designIIR(cfg);
  if (!design.ok) return { cfg, design };
  const n = Math.round(0.5 * cfg.fs);
  const pre = Math.round(0.5 * cfg.fs); // warm-up: zero initial state, transient discarded
  const sig = labSignal(cfg.source, { ...motorState(s), fs: cfg.fs, n, pre, noise: 0.35 });
  const y = withWarmup(sig, (x) => applyIIR(design, x));
  const out = { cfg, design, sig, y, before: timeStats(sig.x), after: timeStats(y) };
  if (cfg.source === "test") {
    // Known clean signal → exact SNR before and after (the filter is linear, so filtered noise = filtered noisy − filtered clean).
    const clean = labSignal("test", { fs: cfg.fs, n, pre, noise: 0 });
    const yc = withWarmup(clean, (x) => applyIIR(design, x));
    const pow = (a, b) => a.reduce((acc, v, i) => acc + (b ? (v - b[i]) ** 2 : v * v), 0);
    out.snrIn = 10 * Math.log10(pow(clean.x) / pow(sig.x, clean.x));
    out.snrOut = 10 * Math.log10(pow(yc) / pow(y, yc));
  }
  const nyq = cfg.fs / 2;
  const freqs = Array.from({ length: 801 }, (_, i) => (i / 800) * nyq);
  out.response = Float64Array.from(magnitude(design, freqs), (m) => Math.max(-100, 20 * Math.log10(m + 1e-12)));
  out.df = nyq / 800;
  out.specX = amplitudeSpectrum(sig.x, cfg.fs);
  out.specY = amplitudeSpectrum(y, cfg.fs);
  return out;
}

function FilterModule({ s }) {
  const [cfg, setCfg] = useState({ source: "vib", fs: 2048, ...DEFAULT_FILTER });
  const [res, setRes] = useState(null);
  const runs = useRef(0);
  const set = (p) => setCfg((c) => ({ ...c, ...p }));
  const errors = validate(cfg);
  const run = () => {
    if (errors.length) return;
    runs.current += 1;
    setRes({ ...runFilter(cfg, s), id: runs.current });
  };
  useEffect(run, []);
  const stale = res && JSON.stringify(res.cfg) !== JSON.stringify(cfg);

  return (
    <div className="space-y-12">
      <div className="grid gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Step n={1} title="Select input signal">
          <SourcePicker value={cfg.source} onChange={(v) => set({ source: v })} s={s} testLabel="Test signal + noise" />
          <Field label="Sampling frequency f_s" className="mt-4">
            <Segmented size="md" value={cfg.fs} onChange={(v) => set({ fs: v })} options={[1024, 2048, 4096].map((v) => ({ value: v, label: `${v} Hz` }))} />
          </Field>
          {cfg.source === "test" && <p className="mt-2 text-[12px] text-muted">White Gaussian noise (σ = 0.35) is added to the test signal — the practical noise-reduction example.</p>}
        </Step>
        <Step n={2} title="Configure filter">
          <FilterControls cfg={cfg} onChange={set} />
          {errors.length > 0 && (
            <ul className="mt-3 space-y-1">
              {errors.map((e) => (
                <li key={e} className="text-[12px] text-crimson">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </Step>
      </div>

      <Step
        n={3}
        title="Execute"
        kicker={stale ? "settings changed — execute again to update the results" : res?.design.ok ? "filter designed and applied to 0.5 s of signal (after a 0.5 s warm-up)" : null}
        actions={
          <Btn variant="primary" onClick={run} disabled={errors.length > 0}>
            Design &amp; apply filter
          </Btn>
        }
      >
        {res?.design.ok && <DesignSummary res={res} />}
      </Step>

      {res?.design.ok && (
        <Step n={4} title="Visualize" kicker={`${SOURCES[res.cfg.source].label} · f_s = ${res.cfg.fs} Hz`}>
          <FilterPlots res={res} />
        </Step>
      )}

      {res?.design.ok && (
        <Step n={5} title="Mathematics" kicker="the designed transfer function">
          <Coefficients res={res} />
          <div className="mt-8">
            <Explain items={[familyText(res.cfg.family), methodText(res.cfg.method)]} />
          </div>
        </Step>
      )}

      <Step n={6} title="Engineering relevance">
        <Explain
          items={[
            [
              "Noise reduction",
              "A low-pass filter keeps the running-speed components (1×, 2×, 3× — tens of Hz) and removes broadband sensor and electrical noise above the cut-off, making the waveform and its trend easier to read. Try the test signal: the SNR improvement is measured exactly.",
            ],
            [
              "What a filter can hide",
              "Bearing defects show up as short impacts that ring a structural resonance at several hundred Hz. A low-pass below that band removes them along with the noise — the waveform looks healthier than the machine is. Bearing analysis uses a band-pass around the resonance instead.",
            ],
            [
              "Butterworth or Chebyshev",
              "Butterworth keeps the passband flat, so amplitudes are measured without ripple error. Chebyshev-I reaches the same attenuation with a lower order, accepting a small ripple — useful when a nearby unwanted component must be suppressed.",
            ],
            [
              "Order and stability",
              "Higher order gives a steeper transition but poles closer to the unit circle, more phase distortion and higher sensitivity to coefficient rounding. That is why the filter is run as second-order sections, not one high-order difference equation.",
            ],
          ]}
        />
      </Step>
    </div>
  );
}

function DesignSummary({ res }) {
  const { cfg, design } = res;
  const cut = cfg.response === "bandpass" ? `${cfg.fLow}–${cfg.fHigh} Hz` : `${cfg.fc} Hz`;
  const fres = BAND_RESONANCE(cfg.fs);
  const gres = magnitude(design, [fres])[0];
  const attRes = -20 * Math.log10(gres + 1e-12);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Readout size="sm" label="Method" value={cfg.method === "bilinear" ? "Bilinear" : "Impulse inv."} sub={design.structure === "cascade" ? `${design.sections.length} cascaded biquads` : `${design.sections.length} parallel sections`} />
        <Readout size="sm" label="Approximation" value={cfg.family === "butterworth" ? "Butterworth" : "Chebyshev-I"} sub={cfg.family === "chebyshev" ? `${cfg.ripple} dB ripple` : "maximally flat"} />
        <Readout size="sm" label={`${RESPONSES[cfg.response]} · order`} value={cfg.order} sub={cfg.response === "bandpass" ? `prototype order ${cfg.order / 2}` : `${cfg.order} poles`} />
        <Readout size="sm" label="Cut-off" value={cut} sub={`Nyquist ${cfg.fs / 2} Hz`} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-muted">
        <Chip tone={design.stable ? "ok" : "bad"}>{design.stable ? "stable" : "unstable"}</Chip>
        <span>
          largest pole radius |p|<sub>max</sub> = <span className="num text-ink">{design.maxPole.toFixed(4)}</span> {design.stable ? "< 1 — all poles inside the unit circle" : "≥ 1"}
        </span>
      </div>
      {res.snrIn != null && (
        <p className="text-[13px] text-ink">
          Noise reduction: SNR <span className="num">{res.snrIn.toFixed(1)} dB</span> → <span className="num text-kinetic">{res.snrOut.toFixed(1)} dB</span>{" "}
          <span className="text-muted">({(res.snrOut - res.snrIn >= 0 ? "+" : "") + (res.snrOut - res.snrIn).toFixed(1)} dB)</span>
        </p>
      )}
      {cfg.source === "vib" && gres < 0.5 && (
        <p className="border-l-2 border-amber pl-3 text-[12.5px] leading-relaxed text-ink">
          This filter attenuates the ≈{fres.toFixed(0)} Hz structural-resonance band by {attRes.toFixed(0)} dB. Bearing-defect impacts ring this resonance, so after filtering they
          are {attRes >= 20 ? "largely removed" : "weakened"} — and with them the high kurtosis they cause (here {res.before.kurtosis.toFixed(2)} → {res.after.kurtosis.toFixed(2)}).
          For bearing diagnosis, keep this band in the passband.
        </p>
      )}
    </div>
  );
}

function FilterPlots({ res }) {
  const { cfg, sig, y, design } = res;
  const unit = SOURCES[cfg.source].unit;
  const show = Math.round(0.2 * cfg.fs);
  const xs = sig.x.subarray(0, show);
  const ys = y.subarray(0, show);
  let lo = Infinity;
  let hi = -Infinity;
  for (const a of [xs, ys]) for (const v of a) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  const pad = (hi - lo) * 0.06;
  const cutoffs = cfg.response === "bandpass" ? [cfg.fLow, cfg.fHigh] : [cfg.fc];
  const passLine = cfg.family === "chebyshev" ? { y: -cfg.ripple, label: `−${cfg.ripple} dB ripple`, color: "#B26A35" } : { y: -3.01, label: "−3 dB", color: "#B26A35" };
  return (
    <div className="space-y-8">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <div>
          <div className="label-xs mb-1">Original x[n] · 200 ms</div>
          <LinePlot series={[{ y: xs, dx: 1000 / cfg.fs, color: "#262522", label: "x" }]} yMin={lo - pad} yMax={hi + pad} xUnit="ms" yUnit={unit} height={190} version={res.id} />
        </div>
        <div>
          <div className="label-xs mb-1">Filtered y[n] · same scale</div>
          <LinePlot series={[{ y: ys, dx: 1000 / cfg.fs, color: "#2F5D46", label: "y" }]} yMin={lo - pad} yMax={hi + pad} xUnit="ms" yUnit={unit} height={190} version={res.id} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Readout size="sm" label="RMS" value={`${res.before.rms.toPrecision(3)} → ${res.after.rms.toPrecision(3)}`} unit={unit} />
        <Readout size="sm" label="Peak" value={`${res.before.peak.toPrecision(3)} → ${res.after.peak.toPrecision(3)}`} unit={unit} />
        <Readout size="sm" label="Kurtosis" value={`${res.before.kurtosis.toFixed(2)} → ${res.after.kurtosis.toFixed(2)}`} sub="3 = Gaussian; impacts raise it" />
        <Readout size="sm" label="Crest factor" value={`${res.before.crestFactor.toFixed(2)} → ${res.after.crestFactor.toFixed(2)}`} />
      </div>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        <div>
          <div className="label-xs mb-1">Magnitude response |H(e^jω)| · dB</div>
          <LinePlot
            series={[{ y: res.response, dx: res.df, color: "#2F5D46", width: 1.6, label: "|H|" }]}
            markers={cutoffs.map((f) => ({ x: f, label: `${f} Hz` }))}
            hlines={[passLine]}
            xMin={0}
            yMin={-80}
            yMax={5}
            xUnit="Hz"
            yUnit="dB"
            height={220}
            version={res.id}
          />
        </div>
        <div>
          <div className="label-xs mb-1">Spectrum · original (grey) vs filtered (green)</div>
          <LinePlot
            series={[
              { y: res.specX.mag, dx: res.specX.df, color: "#8E887E", label: "X" },
              { y: res.specY.mag, dx: res.specY.df, color: "#2F5D46", width: 1.5, label: "Y" },
            ]}
            markers={cutoffs.map((f) => ({ x: f, color: "#8E887E" }))}
            xMin={0}
            xMax={cfg.fs / 2}
            yMin={0}
            xUnit="Hz"
            yUnit={unit}
            height={220}
            version={res.id}
          />
        </div>
      </div>
      <p className="text-[11.5px] text-dim">
        Filter state starts at zero; it runs over {(sig.pre.length / cfg.fs).toFixed(1)} s of preceding signal first and that start-up transient is discarded. Spectra: Hann window,{" "}
        {sig.x.length} points. {design.structure === "parallel" ? "Parallel form: the outputs of all sections are added." : "Cascade form: each biquad feeds the next."}
      </p>
    </div>
  );
}

function Coefficients({ res }) {
  const { design } = res;
  const hz = formatHz(design.b, design.a);
  const rows = Math.max(design.b.length, design.a.length);
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <div className="num inline-block min-w-full text-[12.5px] text-ink">
          <div className="whitespace-nowrap px-1">{hz.num}</div>
          <div className="my-1 flex items-center gap-2">
            <span className="text-muted">H(z) =</span>
            <span className="h-px flex-1 bg-ink/40" />
          </div>
          <div className="whitespace-nowrap px-1">{hz.den}</div>
        </div>
      </div>
      <p className="text-[12.5px] text-muted">
        Difference equation: <Eq>y[n] = Σ b_k·x[n−k] − Σ a_k·y[n−k]</Eq>, k ≥ 1 for the feedback sum (a₀ = 1).
      </p>
      <table className="w-full max-w-md text-[12.5px]">
        <thead>
          <tr className="label-xs text-left">
            <th className="py-1 font-normal">k</th>
            <th className="text-right font-normal">b_k (numerator)</th>
            <th className="text-right font-normal">a_k (denominator)</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, k) => (
            <tr key={k} className="border-t border-line">
              <td className="num py-1">{k}</td>
              <td className="num text-right">{design.b[k] != null ? design.b[k].toPrecision(6) : "—"}</td>
              <td className="num text-right">{design.a[k] != null ? design.a[k].toPrecision(6) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function familyText(family) {
  return family === "butterworth"
    ? [
        "Butterworth approximation",
        <>
          <Eq>|H(jΩ)|² = 1 / (1 + (Ω/Ω_c)^(2N))</Eq>. Maximally flat: no ripple in the passband, −3 dB exactly at the cut-off, roll-off 20·N dB/decade. Its poles lie evenly on a
          circle in the s-plane.
        </>,
      ]
    : [
        "Chebyshev Type-I approximation",
        <>
          <Eq>|H(jΩ)|² = 1 / (1 + ε²·T_N²(Ω/Ω_c))</Eq>, with ε² = 10^(ripple/10) − 1 and T_N the Chebyshev polynomial. The passband ripples by a fixed amount (equiripple); in
          exchange the transition is steeper than Butterworth for the same order. Its poles lie on an ellipse.
        </>,
      ];
}

function methodText(method) {
  return method === "bilinear"
    ? [
        "Bilinear transformation",
        <>
          <Eq>s = 2f_s·(1 − z⁻¹)/(1 + z⁻¹)</Eq> maps the whole jΩ axis onto the unit circle once, so there is no aliasing and a stable analog filter always gives a stable digital
          one. The mapping compresses frequency (<Eq>Ω = 2f_s·tan(ω/2)</Eq>), so the cut-off is pre-warped first to land exactly where requested.
        </>,
      ]
    : [
        "Impulse invariant transformation",
        <>
          <Eq>h[n] = T·h_a(nT)</Eq>: the digital impulse response is the sampled analog one. Each analog pole p<sub>k</sub> maps to <Eq>z = e^(p_k·T)</Eq>, so stability is preserved.
          Because sampling aliases the analog response, it suits low-pass and band-pass filters only — a high-pass is not band-limited.
        </>,
      ];
}
