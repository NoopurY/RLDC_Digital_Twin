"use client";
import { useMemo, useState } from "react";
import { EMPTY_FAULTS, FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { labSignal, withWarmup } from "@/lib/dsp/labSignals";
import { designIIR, validate, magnitude, applyIIR } from "@/lib/dsp/iirDesign";
import { amplitudeSpectrum } from "@/lib/dsp/spectrum";
import { timeStats } from "@/lib/dsp/statistics";
import LinePlot from "@/components/Charts/LinePlot";
import FilterControls from "@/components/DSP/FilterControls";
import { Section, Segmented, Field } from "@/components/ui/primitives";

// Same seed as the Healthy-vs-Faulty view, so all three modes start from the same signals.
const SEED = 21;
const COLORS = ["#2F5D46", "#A8402F", "#B26A35"];

/** The signal under test: healthy or currently-faulty motor, from the simulator state (read-only). */
function useMotorChoice(s) {
  const [which, setWhich] = useState("faulty");
  const [channel, setChannel] = useState("vib");
  const faulty = FAULT_TYPES.some((k) => s.faultTargets[k] > 0.005) ? s.faultTargets : { ...EMPTY_FAULTS, bearing: 0.5 };
  const name =
    which === "healthy"
      ? "Healthy motor"
      : Object.entries(faulty)
          .filter(([, v]) => v > 0.005)
          .map(([k, v]) => `${FAULT_INFO[k].label} ${(v * 100).toFixed(0)}%`)
          .join(" + ");
  const faults = which === "healthy" ? EMPTY_FAULTS : faulty;
  const control = (
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      <Field label="Motor condition">
        <Segmented
          size="md"
          value={which}
          onChange={setWhich}
          options={[
            { value: "healthy", label: "Healthy" },
            { value: "faulty", label: "Current faults" },
          ]}
        />
      </Field>
      <Field label="Channel">
        <Segmented
          size="md"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "vib", label: "Vibration" },
            { value: "cur", label: "Current" },
          ]}
        />
      </Field>
    </div>
  );
  return { faults, channel, name, control, key: `${which}|${channel}|${JSON.stringify(faults)}|${s.params.rpm}|${s.params.load}` };
}

function makeSignal(s, faults, channel, fs) {
  return labSignal(channel, { params: s.params, faults, fs, n: Math.round(0.5 * fs), pre: Math.round(0.5 * fs), seed: SEED });
}

const DEFAULT_CFG = { family: "butterworth", response: "lowpass", method: "bilinear", order: 4, fc: 200, fLow: 100, fHigh: 400, ripple: 1 };

function Errors({ list }) {
  return list.length ? (
    <ul className="space-y-1">
      {list.map((e) => (
        <li key={e} className="text-[12px] text-crimson">
          {e}
        </li>
      ))}
    </ul>
  ) : null;
}

// ── B: Original vs Filtered ────────────────────────────────────────────────
export function OriginalVsFiltered({ s }) {
  const fs = s.dsp.fs;
  const choice = useMotorChoice(s);
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const full = { ...cfg, fs };
  const errors = validate(full);
  const sig = useMemo(() => makeSignal(s, choice.faults, choice.channel, fs), [choice.key, fs]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = useMemo(() => {
    if (errors.length) return null;
    const design = designIIR(full);
    const y = withWarmup(sig, (x) => applyIIR(design, x));
    return { design, y, sx: amplitudeSpectrum(sig.x, fs), sy: amplitudeSpectrum(y, fs), a: timeStats(sig.x), b: timeStats(y) };
  }, [sig, JSON.stringify(full)]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = choice.channel === "cur" ? "A" : "g";
  const show = Math.round(0.25 * fs);
  const scale = useMemo(() => {
    if (!out) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const a of [sig.x.subarray(0, show), out.y.subarray(0, show)]) for (const v of a) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    const fmax = Math.min(fs / 2, 400);
    let m = 0;
    for (const sp of [out.sx, out.sy]) for (let k = 1; k * sp.df <= fmax; k++) m = Math.max(m, sp.mag[k]);
    return { lo: lo - 0.05 * (hi - lo), hi: hi + 0.05 * (hi - lo), m: m * 1.1, fmax };
  }, [out, sig, show, fs]);
  const version = `${choice.key}|${JSON.stringify(full)}`;
  const cutoffs = cfg.response === "bandpass" ? [cfg.fLow, cfg.fHigh] : [cfg.fc];
  const frot = sig.frot;
  const orders = [1, 2, 3].map((k) => ({ x: k * frot, label: `${k}×` }));

  return (
    <div className="space-y-10">
      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Signal" kicker={`${choice.name} · ${s.params.rpm} rpm · f_s = ${fs} Hz`}>
          {choice.control}
        </Section>
        <Section title="Filter">
          <FilterControls cfg={cfg} onChange={(p) => setCfg((c) => ({ ...c, ...p }))} />
          <div className="mt-3">
            <Errors list={errors} />
          </div>
        </Section>
      </div>
      {out && (
        <>
          <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
            {[
              ["Original", sig.x, out.sx, "#262522"],
              ["Filtered", out.y, out.sy, "#2F5D46"],
            ].map(([t, x, sp, color]) => (
              <div key={t} className="min-w-0">
                <h2 className="display border-b border-ink/15 pb-2 text-[15px] font-bold uppercase text-ink">{t}</h2>
                <div className="label-xs mt-3 mb-1">Waveform · 250 ms · shared scale</div>
                <LinePlot series={[{ y: x.subarray(0, show), dx: 1000 / fs, color, label: t }]} yMin={scale.lo} yMax={scale.hi} xUnit="ms" yUnit={unit} height={150} version={version} />
                <div className="label-xs mt-4 mb-1">FFT · 0–{scale.fmax} Hz · shared scale</div>
                <LinePlot
                  series={[{ y: sp.mag, dx: sp.df, color, label: "|X|" }]}
                  markers={[...orders, ...cutoffs.map((f) => ({ x: f, label: "f_c", color: "#8E887E" }))]}
                  xMin={0}
                  xMax={scale.fmax}
                  yMin={0}
                  yMax={scale.m}
                  xUnit="Hz"
                  yUnit={unit}
                  height={180}
                  version={version}
                />
              </div>
            ))}
          </div>
          <StatsTable
            cols={["Original", "Filtered"]}
            rows={[
              ["RMS", [out.a.rms, out.b.rms], unit],
              ["Peak", [out.a.peak, out.b.peak], unit],
              ["Crest factor", [out.a.crestFactor, out.b.crestFactor], ""],
              ["Kurtosis", [out.a.kurtosis, out.b.kurtosis], ""],
            ]}
          />
        </>
      )}
    </div>
  );
}

function StatsTable({ cols, rows }) {
  const grid = { gridTemplateColumns: `minmax(0,1.2fr) repeat(${cols.length}, minmax(0,1fr))` };
  return (
    <div>
      <div className="grid border-b border-ink/15 pb-2" style={grid}>
        <span className="label-xs">Feature</span>
        {cols.map((c) => (
          <span key={c} className="label-xs text-right">
            {c}
          </span>
        ))}
      </div>
      {rows.map(([k, vals, u]) => (
        <div key={k} className="grid items-center border-b border-line py-1.5 text-[12.5px]" style={grid}>
          <span className="text-muted">{k}</span>
          {vals.map((v, i) => (
            <span key={i} className="num text-right">
              {typeof v === "string" ? v : Math.abs(v) >= 100 ? v.toFixed(0) : v.toPrecision(3)} {u && <span className="text-[10px] text-dim">{u}</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── C: Filter comparison ───────────────────────────────────────────────────
const VARY = [
  { value: "family", label: "Butterworth vs Chebyshev-I" },
  { value: "order", label: "Order 2 / 4 / 6" },
  { value: "cutoff", label: "Cut-off ×½ / ×1 / ×2" },
];

function variants(base, by) {
  if (by === "family")
    return [
      { ...base, family: "butterworth", name: "Butterworth" },
      { ...base, family: "chebyshev", name: `Chebyshev-I (${base.ripple} dB)` },
    ];
  if (by === "order") return [2, 4, 6].map((order) => ({ ...base, order, name: `Order ${order}` }));
  return [0.5, 1, 2].map((m) =>
    base.response === "bandpass"
      ? { ...base, fLow: base.fLow * m, fHigh: base.fHigh * m, name: `${base.fLow * m}–${base.fHigh * m} Hz` }
      : { ...base, fc: base.fc * m, name: `f_c = ${base.fc * m} Hz` }
  );
}

/** Stop-band probe frequency: one octave beyond the (upper/lower) edge. */
const probe = (c) => (c.response === "lowpass" ? 2 * c.fc : c.response === "highpass" ? c.fc / 2 : 2 * c.fHigh);

/** Peak-to-peak ripple (dB) of |H| over the passband. */
function passRipple(design, c) {
  const [f0, f1] = c.response === "lowpass" ? [0, c.fc] : c.response === "highpass" ? [c.fc, c.fs / 2 - 1] : [c.fLow, c.fHigh];
  const fr = Array.from({ length: 200 }, (_, i) => f0 + ((f1 - f0) * i) / 199);
  const db = magnitude(design, fr).map((m) => 20 * Math.log10(m + 1e-12));
  return Math.max(...db) - Math.min(...db);
}

export function FilterComparison({ s }) {
  const fs = s.dsp.fs;
  const choice = useMotorChoice(s);
  const [base, setBase] = useState(DEFAULT_CFG);
  const [by, setBy] = useState("family");
  const sig = useMemo(() => makeSignal(s, choice.faults, choice.channel, fs), [choice.key, fs]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseErrors = validate({ ...base, fs });
  const list = useMemo(() => {
    if (baseErrors.length) return [];
    const nyq = fs / 2;
    const freqs = Array.from({ length: 601 }, (_, i) => (i / 600) * nyq);
    return variants({ ...base, fs }, by).map((c) => {
      const design = designIIR(c);
      if (!design.ok) return { c, errors: design.errors };
      const y = withWarmup(sig, (x) => applyIIR(design, x));
      const H = Float64Array.from(magnitude(design, freqs), (m) => Math.max(-100, 20 * Math.log10(m + 1e-12)));
      const edge = c.response === "bandpass" ? [c.fLow, c.fHigh] : [c.fc];
      return {
        c,
        design,
        y,
        H,
        df: nyq / 600,
        stats: timeStats(y),
        atEdge: magnitude(design, edge).map((m) => 20 * Math.log10(m)),
        atProbe: probe(c) < nyq ? 20 * Math.log10(magnitude(design, [probe(c)])[0]) : null,
        ripple: passRipple(design, c),
      };
    });
  }, [sig, by, JSON.stringify(base), fs]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = list.filter((v) => v.design);
  const version = `${choice.key}|${by}|${JSON.stringify(base)}`;
  const unit = choice.channel === "cur" ? "A" : "g";
  const show = Math.round(0.1 * fs);

  return (
    <div className="space-y-10">
      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Signal & comparison" kicker={`${choice.name} · f_s = ${fs} Hz`}>
          <div className="space-y-4">
            {choice.control}
            <Field label="Compare">
              <Segmented size="md" value={by} onChange={setBy} options={VARY} />
            </Field>
          </div>
        </Section>
        <Section title="Base filter">
          <FilterControls cfg={base} onChange={(p) => setBase((c) => ({ ...c, ...p }))} hide={by === "family" ? ["family", "ripple"] : by === "order" ? ["order"] : []} />
          {by === "family" && (
            <Field label="Chebyshev passband ripple" className="mt-4">
              <Segmented size="md" value={base.ripple} onChange={(v) => setBase((c) => ({ ...c, ripple: v }))} options={[0.5, 1, 2, 3].map((v) => ({ value: v, label: `${v} dB` }))} />
            </Field>
          )}
          <div className="mt-3">
            <Errors list={[...baseErrors, ...list.filter((v) => v.errors).map((v) => `${v.c.name}: ${v.errors[0]}`)]} />
          </div>
        </Section>
      </div>

      {ok.length > 0 && (
        <>
          <div className="flex flex-wrap gap-5">
            {ok.map((v, i) => (
              <span key={v.c.name} className="flex items-center gap-2 text-[12.5px] text-ink">
                <span className="h-[3px] w-5" style={{ background: COLORS[i] }} />
                {v.c.name}
              </span>
            ))}
          </div>
          <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
            <div>
              <div className="label-xs mb-1">Magnitude response · dB</div>
              <LinePlot
                series={ok.map((v, i) => ({ y: v.H, dx: v.df, color: COLORS[i], width: 1.6, label: v.c.name }))}
                hlines={[{ y: -3.01, label: "−3 dB", color: "#8E887E" }]}
                xMin={0}
                yMin={-80}
                yMax={5}
                xUnit="Hz"
                yUnit="dB"
                height={240}
                version={version}
              />
            </div>
            <div>
              <div className="label-xs mb-1">Filtered signal · 100 ms · original in grey</div>
              <LinePlot
                series={[
                  { y: sig.x.subarray(0, show), dx: 1000 / fs, color: "rgba(142,136,126,0.6)", label: "x" },
                  ...ok.map((v, i) => ({ y: v.y.subarray(0, show), dx: 1000 / fs, color: COLORS[i], label: v.c.name.split(" ")[0] })),
                ]}
                xUnit="ms"
                yUnit={unit}
                height={240}
                version={version}
              />
            </div>
          </div>
          <StatsTable
            cols={ok.map((v) => v.c.name)}
            rows={[
              ["|H| at cut-off (dB)", ok.map((v) => v.atEdge.map((d) => d.toFixed(2)).join(" / ")), ""],
              [`|H| one octave into stop-band (dB)`, ok.map((v) => (v.atProbe == null ? "above Nyquist" : v.atProbe.toFixed(1))), ""],
              ["Passband ripple (dB)", ok.map((v) => v.ripple.toFixed(2)), ""],
              ["Largest pole radius", ok.map((v) => v.design.maxPole.toFixed(4)), ""],
              ["Output RMS", ok.map((v) => v.stats.rms), unit],
              ["Output kurtosis", ok.map((v) => v.stats.kurtosis), ""],
            ]}
          />
          <p className="text-[12px] leading-relaxed text-muted">
            Every variant filters the same samples. Steeper filters (higher order, Chebyshev) reach more stop-band attenuation, at the cost of poles nearer the unit circle and — for
            Chebyshev — passband ripple.
          </p>
        </>
      )}
    </div>
  );
}
