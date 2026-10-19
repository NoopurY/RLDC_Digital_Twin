"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTwin } from "@/lib/engine/useTwin";
import { api } from "@/lib/api/client";
import { simulateWindows, computeBaseline } from "@/lib/simulation/headless";
import { EMPTY_FAULTS, DEFAULT_PARAMS, FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { DEFAULT_DSP } from "@/lib/dsp/pipeline";
import { RuleClassifier, CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { computeHealth } from "@/lib/diagnosis/healthScore";
import { useCanvas, C, label, niceStep } from "@/components/Charts/useCanvas";
import { PageHeader, Field, cx } from "@/components/ui/primitives";

/** Deterministically re-synthesise a configuration through the full chain. */
function synthesize({ params, faults, dsp, seed, name }) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const f = { ...EMPTY_FAULTS, ...faults };
  const d = { ...DEFAULT_DSP, ...(dsp ?? {}), filter: { ...DEFAULT_DSP.filter, ...(dsp?.filter ?? {}) } };
  const { results, features } = simulateWindows({ params: p, faults: f, dsp: d, seed: seed ?? 1, windows: 1 });
  const r = results[0];
  const base = computeBaseline(p, d);
  const diag = RuleClassifier.classify(features, base, { rpmSet: p.rpm, ambient: p.ambientTemp });
  const health = computeHealth(features, base);
  const n = Math.round(0.25 * d.fs);
  return { name, params: p, faults: f, features, diag, health, wave: r.vib.subarray(r.vib.length - n), spec: r.spectrum, fs: d.fs };
}

const ROWS = [
  ["RMS", (x) => x.features.rms * 1000, 0, "mg"],
  ["Peak", (x) => x.features.peak * 1000, 0, "mg"],
  ["Kurtosis", (x) => x.features.kurtosis, 2, ""],
  ["Crest factor", (x) => x.features.crestFactor, 2, ""],
  ["Dominant frequency", (x) => x.features.dominantFrequency, 1, "Hz"],
  ["1× rotational", (x) => x.features.a1 * 1000, 0, "mg"],
  ["2× harmonic", (x) => x.features.a2 * 1000, 0, "mg"],
  ["High-frequency energy", (x) => x.features.bandEnergyHigh * 100, 0, "%"],
  ["Envelope BPFO SNR", (x) => x.features.bpfoSNR, 1, "×"],
  ["Current", (x) => x.features.currentMean, 2, "A"],
  ["Temperature", (x) => x.features.temperature, 1, "°C"],
];

function Compare() {
  const s = useTwin();
  const q = useSearchParams();
  const [exps, setExps] = useState([]);
  const [selA, setSelA] = useState(q.get("a") ?? "live:healthy");
  const [selB, setSelB] = useState(q.get("b") ?? "live:current");
  const [pair, setPair] = useState(null);
  const [hoverF, setHoverF] = useState(null);

  useEffect(() => {
    api.experiments.list().then((r) => setExps(r.items)).catch(() => setExps([]));
  }, []);

  const resolve = (sel) => {
    if (sel === "live:healthy") return { name: "Healthy reference", params: s?.params, faults: EMPTY_FAULTS, dsp: s?.dsp, seed: 21 };
    if (sel === "live:current") {
      const faulty = s && FAULT_TYPES.some((k) => s.faultTargets[k] > 0.005) ? s.faultTargets : { ...EMPTY_FAULTS, bearing: 0.5 };
      const nm = Object.entries(faulty).filter(([, v]) => v > 0.005).map(([k, v]) => `${FAULT_INFO[k].label} ${(v * 100).toFixed(0)}%`).join(" + ");
      return { name: nm, params: s?.params, faults: faulty, dsp: s?.dsp, seed: 21 };
    }
    const e = exps.find((x) => x.id === sel);
    return e && { name: e.scenarioName, params: e.motorParameters, faults: e.faults, dsp: e.dsp, seed: e.seed ?? 1 };
  };

  const ready = !!s && (selA.startsWith("live:") || exps.length) && (selB.startsWith("live:") || exps.length);
  useEffect(() => {
    if (!ready) return;
    const a = resolve(selA);
    const b = resolve(selB);
    if (!a || !b) return;
    const id = setTimeout(() => setPair([synthesize(a), synthesize(b)]), 20);
    return () => clearTimeout(id);
    // Re-run only when the selection (or the experiment list) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selA, selB, ready, exps.length]);

  const options = [
    { value: "live:healthy", label: "Healthy reference (current operating point)" },
    { value: "live:current", label: "Current simulator faults (or bearing 50%)" },
    ...exps.map((e) => ({ value: e.id, label: `Experiment · ${e.scenarioName}` })),
  ];

  return (
    <div className="space-y-10">
      <PageHeader kicker="Compare" title="Healthy vs faulty">
        Two configurations re-synthesised through the same generator, DSP and diagnosis chain (deterministic seed). The waveforms share one amplitude scale and the spectra share
        one scale and one frequency cursor, so differences are visible, not just listed.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="A">
          <select className="sel" value={selA} onChange={(e) => setSelA(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="B">
          <select className="sel" value={selB} onChange={(e) => setSelB(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {!pair ? (
        <p className="text-[13px] text-muted">Synthesising both signals…</p>
      ) : (
        <SyncView pair={pair} hoverF={hoverF} setHoverF={setHoverF} />
      )}
    </div>
  );
}

function SyncView({ pair, hoverF, setHoverF }) {
  const [A, B] = pair;
  const waveMax = useMemo(() => Math.max(...pair.flatMap((p) => [Math.max(...p.wave), -Math.min(...p.wave)])) * 1.1, [pair]);
  const fmax = 400;
  const specMax = useMemo(
    () => Math.max(...pair.map((p) => Math.max(...Array.from(p.spec.mag).slice(1, Math.ceil(fmax / p.spec.df))))) * 1.12,
    [pair]
  );
  return (
    <div className="space-y-8">
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
        {pair.map((p, i) => (
          <div key={i} className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-ink/15 pb-2">
              <h2 className={cx("display truncate text-[15px] font-bold uppercase", p.diag.label === "healthy" ? "text-kinetic" : "text-crimson")}>{p.name || (i ? "B" : "A")}</h2>
              <span className="num text-[13px]">
                Health{" "}
                <span className={cx("text-[22px]", p.health.score >= 80 ? "text-kinetic" : p.health.score >= 40 ? "text-amber" : "text-crimson")}>{p.health.score.toFixed(0)}</span>
              </span>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">
              {CLASS_LABELS[p.diag.label]}
              {p.diag.label !== "healthy" && ` · ${p.diag.confidence.toFixed(0)}% · ${p.diag.severity}`} · {p.params.rpm} rpm · {p.params.load}% load
            </div>
            <div className="label-xs mt-4 mb-1">Waveform · 250 ms</div>
            <WaveCanvas data={p.wave} max={waveMax} fs={p.fs} color={i ? "#A8402F" : "#2F5D46"} />
            <div className="label-xs mt-4 mb-1">FFT · 0–{fmax} Hz · shared scale & cursor</div>
            <SpecCanvas spec={p.spec} max={specMax} fmax={fmax} color={i ? "#A8402F" : "#2F5D46"} hoverF={hoverF} setHoverF={setHoverF} frot={p.features.shaftFrequency} />
          </div>
        ))}
      </div>

      <div>
        <div className="grid grid-cols-[minmax(0,1.2fr)_1fr_1fr_minmax(0,1fr)] border-b border-ink/15 pb-2">
          <span className="label-xs">Feature</span>
          <span className="label-xs text-right">A</span>
          <span className="label-xs text-right">B</span>
          <span className="label-xs pl-6">Change</span>
        </div>
        {ROWS.map(([k, g, d, u]) => {
          const a = g(A);
          const b = g(B);
          const rel = Math.abs(a) > 1e-9 ? (b - a) / Math.abs(a) : 0;
          return (
            <div key={k} className="grid grid-cols-[minmax(0,1.2fr)_1fr_1fr_minmax(0,1fr)] items-center border-b border-line py-1.5 text-[12.5px]">
              <span className="text-muted">{k}</span>
              <span className="num text-right">
                {a.toFixed(d)} <span className="text-[10px] text-dim">{u}</span>
              </span>
              <span className="num text-right">
                {b.toFixed(d)} <span className="text-[10px] text-dim">{u}</span>
              </span>
              <span className="flex items-center gap-2 pl-6">
                <span className="relative h-[5px] w-28 bg-line">
                  <span className="absolute inset-y-0 left-1/2 w-px bg-ink/30" />
                  <span className={cx("absolute inset-y-0", rel >= 0 ? "left-1/2 bg-crimson/70" : "right-1/2 bg-kinetic/70")} style={{ width: `${Math.min(1, Math.abs(rel) / 3) * 50}%` }} />
                </span>
                <span className={cx("num text-[11.5px]", Math.abs(rel) < 0.05 ? "text-dim" : rel > 0 ? "text-crimson" : "text-kinetic")}>
                  {rel >= 0 ? "+" : ""}
                  {(rel * 100).toFixed(0)}%
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaveCanvas({ data, max, fs, color }) {
  const [ref] = useCanvas(
    (ctx, w, h) => {
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      for (let j = 1; j < 4; j++) {
        ctx.moveTo(0, (h * j) / 4 + 0.5);
        ctx.lineTo(w, (h * j) / 4 + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = h / 2 - (data[i] / max) * (h / 2 - 4);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      label(ctx, `±${max.toFixed(2)} g (shared)`, w - 4, 11, { align: "right", color: C.axis, size: 9 });
    },
    () => `${max}|${data.length}|${data[0]}`
  );
  return <canvas ref={ref} style={{ height: 130 }} className="block w-full" />;
}

function SpecCanvas({ spec, max, fmax, color, hoverF, setHoverF, frot }) {
  const PL = 38;
  const [ref] = useCanvas(
    (ctx, w, h) => {
      const PB = 18;
      const pw = w - PL - 6;
      const ph = h - PB - 6;
      ctx.fillStyle = C.bg;
      ctx.fillRect(PL, 6, pw, ph);
      const X = (f) => PL + (f / fmax) * pw;
      const Y = (m) => 6 + ph - (m / max) * ph;
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      const st = niceStep(fmax, 8);
      for (let f = 0; f <= fmax; f += st) {
        ctx.moveTo(X(f) + 0.5, 6);
        ctx.lineTo(X(f) + 0.5, 6 + ph);
        label(ctx, `${f}`, X(f), h - 5, { align: "center", color: C.axis, size: 9 });
      }
      for (let j = 0; j <= 4; j++) {
        const y = 6 + (ph * j) / 4;
        ctx.moveTo(PL, y + 0.5);
        ctx.lineTo(PL + pw, y + 0.5);
        label(ctx, `${(((max * (4 - j)) / 4) * 1000).toFixed(0)}`, PL - 4, y + 3, { align: "right", color: C.axis, size: 9 });
      }
      ctx.stroke();
      [1, 2, 3].forEach((k) => {
        if (k * frot > fmax) return;
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "rgba(178,106,53,0.6)";
        ctx.beginPath();
        ctx.moveTo(X(k * frot), 6);
        ctx.lineTo(X(k * frot), 6 + ph);
        ctx.stroke();
        ctx.setLineDash([]);
        label(ctx, `${k}×`, X(k * frot) + 3, 16, { color: "#B26A35", size: 9 });
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let k = 1; k * spec.df <= fmax && k < spec.mag.length; k++) {
        const x = X(k * spec.df);
        const y = Y(spec.mag[k]);
        k === 1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
      if (hoverF != null && hoverF <= fmax) {
        const kk = Math.round(hoverF / spec.df);
        const x = X(kk * spec.df);
        ctx.strokeStyle = "rgba(38,37,34,0.55)";
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 6);
        ctx.lineTo(x + 0.5, 6 + ph);
        ctx.stroke();
        const txt = `${(kk * spec.df).toFixed(1)} Hz · ${(spec.mag[kk] * 1000).toFixed(1)} mg`;
        ctx.fillStyle = "rgba(251,249,244,0.95)";
        ctx.fillRect(Math.min(x + 6, PL + pw - 150), 22, 146, 16);
        label(ctx, txt, Math.min(x + 10, PL + pw - 146), 34, { color: C.ink, size: 10 });
      }
      label(ctx, "mg", 4, 14, { color: C.axis, size: 9 });
    },
    () => `${max}|${hoverF}|${spec.mag.length}|${spec.mag[5]}`
  );
  return (
    <canvas
      ref={ref}
      style={{ height: 190 }}
      className="block w-full cursor-crosshair"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const f = ((e.clientX - r.left - PL) / (r.width - PL - 6)) * fmax;
        setHoverF(f >= 0 && f <= fmax ? f : null);
      }}
      onMouseLeave={() => setHoverF(null)}
    />
  );
}

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <Compare />
    </Suspense>
  );
}
