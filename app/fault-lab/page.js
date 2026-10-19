"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { useTwin, engine } from "@/lib/engine/useTwin";
import { simulateWindows } from "@/lib/simulation/headless";
import { EMPTY_FAULTS, FAULT_TYPES, MOTOR } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { DEFAULT_DSP } from "@/lib/dsp/pipeline";
import MiniSpectrum from "@/components/Charts/MiniSpectrum";
import MiniWave from "@/components/Charts/MiniWave";
import WhatIfLab from "@/components/FaultPanel/WhatIfLab";
import { PageHeader, Section } from "@/components/ui/primitives";

const SEV = 0.5;
const PARAMS = { rpm: 1500, load: 30, voltage: 230, noise: 8, age: 3.2, baseVibration: 20, ambientTemp: 25 };

// For each fault: which view shows its signature, and which numbers prove it.
const VIEW = {
  imbalance: { ch: "vib", fmax: 200, metrics: (f) => [["1× amplitude", f.a1 * 1000, "mg", 0], ["2× / 1×", f.a2 / Math.max(f.a1, 1e-6), "", 2]] },
  misalignment: { ch: "vib", fmax: 200, metrics: (f) => [["2× amplitude", f.a2 * 1000, "mg", 0], ["2× / 1×", f.a2 / Math.max(f.a1, 1e-6), "", 2]] },
  bearing: { ch: "vib", fmax: 1024, metrics: (f) => [["Kurtosis", f.kurtosis, "", 2], ["Envelope BPFO SNR", f.bpfoSNR, "×", 1]] },
  electrical: { ch: "cur", fmax: 450, metrics: (f) => [["Commutation sidebands", f.sidebandRatio, "", 2], ["Ripple THD", f.currentTHD * 100, "%", 0]] },
  overload: { ch: "vib", fmax: 400, metrics: (f) => [["Current", (f.currentPU ?? 0) * 100, "% rated", 0], ["Temperature", f.temperature, "°C", 1]] },
  looseness: { ch: "vib", fmax: 200, metrics: (f) => [["½× sub-harmonic", f.a05 * 1000, "mg", 0], ["Harmonics above floor", f.harmonicCount, "", 0]] },
};

function computeAtlas() {
  const run = (faults) => {
    const { results, features } = simulateWindows({ params: PARAMS, faults, dsp: DEFAULT_DSP, seed: 5, windows: 1 });
    const r = results[0];
    const n = Math.round(0.2 * DEFAULT_DSP.fs);
    return {
      features,
      vib: Array.from(r.vib.subarray(r.vib.length - n)),
      // current waveform, AC part only (the DC level is the load, not the signature)
      cur: r.cur ? (() => { const c = Array.from(r.cur.subarray(r.cur.length - n)); const m = c.reduce((a, b) => a + b, 0) / c.length; return c.map((v) => v - m); })() : null,
      spec: { df: r.spectrum.df, mag: r.spectrum.mag },
      curSpec: r.currentSpectrum && { df: r.currentSpectrum.df, mag: r.currentSpectrum.mag },
    };
  };
  const healthy = run(EMPTY_FAULTS);
  const faults = Object.fromEntries(FAULT_TYPES.map((f) => [f, run({ ...EMPTY_FAULTS, [f]: SEV })]));
  return { healthy, faults };
}

export default function FaultLabPage() {
  const s = useTwin();
  const router = useRouter();
  const [atlas, setAtlas] = useState(null);
  useEffect(() => {
    // Headless runs of the same generator + DSP the simulator uses (~50 ms).
    const id = setTimeout(() => setAtlas(computeAtlas()), 30);
    return () => clearTimeout(id);
  }, []);

  const tryIt = (f) => {
    engine.setFault(f, SEV);
    router.push("/simulator");
  };

  return (
    <div className="space-y-12">
      <PageHeader kicker="Fault lab" title="Fault signatures">
        Each fault is a mathematical model that reshapes the generated signals. Every fault below is simulated at {SEV * 100}% severity at {PARAMS.rpm} rpm / {PARAMS.load}% load
        and overlaid on the healthy reference (same seed) — these are the characteristic signatures the diagnosis engine looks for.
      </PageHeader>

      {!atlas ? (
        <p className="text-[13px] text-muted">Simulating the seven reference signals…</p>
      ) : (
        <div className="grid gap-x-10 gap-y-12 lg:grid-cols-2">
          {FAULT_TYPES.map((f) => {
            const v = VIEW[f];
            const F = atlas.faults[f];
            const H = atlas.healthy;
            const spec = (x) => (v.ch === "cur" ? x.curSpec : x.spec);
            const wave = (x) => (v.ch === "cur" ? x.cur : x.vib);
            const hm = v.metrics(H.features);
            return (
              <Section
                key={f}
                title={FAULT_INFO[f].label}
                kicker={FAULT_INFO[f].signature}
                actions={
                  <button onClick={() => tryIt(f)} className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-copper hover:underline">
                    Inject in simulator <ArrowRight size={12} />
                  </button>
                }
              >
                <p className="mb-3 text-[13px] leading-relaxed text-muted">{FAULT_INFO[f].description}</p>
                <div className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
                  {v.metrics(F.features).map(([k, val, u, d], i) => (
                    <div key={k}>
                      <div className="label-xs">{k}</div>
                      <div className="num text-[13px] text-muted">
                        {Number.isFinite(hm[i][1]) ? hm[i][1].toFixed(d) : "—"} <span className="text-dim">→</span>{" "}
                        <span className="text-[18px] text-crimson">{Number.isFinite(val) ? val.toFixed(d) : "—"}</span> <span className="text-[10px] text-dim">{u}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="label-xs mb-1">{v.ch === "cur" ? "Current ripple (AC part)" : "Vibration waveform"} · grey healthy, red faulty</div>
                    <MiniWave
                      fs={DEFAULT_DSP.fs}
                      unit={v.ch === "cur" ? "A" : "g"}
                      version={f}
                      traces={[
                        { data: wave(H), color: "#9A948A", width: 1 },
                        { data: wave(F), color: "#A8402F", width: 1.2, alpha: 0.9 },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="label-xs mb-1">{v.ch === "cur" ? "Current spectrum (MCSA)" : "Vibration spectrum"}</div>
                    <MiniSpectrum
                      height={90}
                      maxFreq={v.fmax}
                      spectra={[
                        { spec: spec(H), color: "#9A948A", label: "healthy" },
                        { spec: spec(F), color: "#A8402F", label: `${SEV * 100}%` },
                      ]}
                    />
                  </div>
                </div>
              </Section>
            );
          })}
        </div>
      )}

      {s && <WhatIfLab s={s} />}
      <p className="text-[11px] text-dim">
        Commutator: {MOTOR.commutatorSegments} segments → current ripple at {MOTOR.commutatorSegments}·f_rot. All signals are synthetic, generated by the twin.
      </p>
    </div>
  );
}
