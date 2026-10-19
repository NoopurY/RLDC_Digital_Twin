"use client";
import { motion } from "framer-motion";
import { useTwin } from "@/lib/engine/useTwin";
import { CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { MOTOR, bearingOrders } from "@/lib/simulation/motorModel";
import { PageHeader, Section } from "@/components/ui/primitives";

const ORD = bearingOrders();

function stages(s) {
  const L = s?.latest;
  const f = L?.features;
  const fl = s?.dsp.filter;
  return [
    ["Motor model", "lib/simulation/motorModel.js · mechanicalModel.js · electricalModel.js · thermalModel.js", "Torque balance, back-EMF, R(T), speed controller with droop and supply saturation, first-order thermal network.", L ? `${L.rpm.toFixed(0)} rpm · ${L.current?.toFixed(2)} A · ${L.temperature?.toFixed(1)} °C` : ""],
    ["Signal generation", "lib/simulation/signalGenerator.js · faultModels.js", "Phase-coherent rotor angle; the healthy model and six fault models shape vibration and current sample by sample.", s ? `${Object.values(s.faults).filter((v) => v > 0.005).length} active fault(s)` : ""],
    ["Sampling & noise", "lib/simulation/noiseModel.js", "Seeded Gaussian sensor noise plus structural drift; signals sampled at f_s into ring buffers.", s ? `f_s ${s.dsp.fs} Hz · seed ${s.seed}` : ""],
    ["Filtering", "lib/dsp/filters.js · convolution.js", "FIR (windowed sinc, convolution) or IIR (Butterworth / Chebyshev, bilinear transform).", fl ? (fl.enabled ? `${fl.family} ${fl.type}` : "bypass") : ""],
    ["FFT / STFT / PSD", "lib/dsp/fft.js · dft.js · windowing.js · stft.js · psd.js", "Windowed radix-2 FFT, rolling STFT, Welch PSD, Hilbert envelope spectrum.", s ? `N ${s.dsp.fftSize} · ${s.dsp.window} · Δf ${(s.dsp.fs / s.dsp.fftSize).toFixed(2)} Hz` : ""],
    ["Feature extraction", "lib/dsp/features.js · statistics.js", "Time statistics, order amplitudes from the tachometer, spectral shape, band energy, BPFO, current signature.", f ? `RMS ${(f.rms * 1000).toFixed(0)} mg · kurtosis ${f.kurtosis.toFixed(2)}` : ""],
    ["Fault diagnosis", "lib/diagnosis/faultRules.js · classifier.js · explanations.js", "Transparent rules against the twin's own healthy reference; every verdict lists its evidence.", L?.diagnosis ? `${CLASS_LABELS[L.diagnosis.label]} · ${L.diagnosis.confidence.toFixed(0)}%` : ""],
    ["Health estimation", "lib/diagnosis/healthScore.js · prognosis.js", "Feature-based penalty breakdown → 0–100 index → least-squares degradation trend (model-based estimate).", L?.health ? `health ${L.health.score.toFixed(0)} · ${L.health.band.label}` : ""],
  ];
}

const EQUATIONS = [
  ["Armature circuit", "V_a = R_a(T)·I + L_a·dI/dt + K_e·ω"],
  ["Torque balance", "K_t·I = T_load + T_friction(ω, age, faults)"],
  ["Copper resistance", "R_a(T) = R_a25·(1 + 0.00393·(T − 25))"],
  ["Thermal network", "τ_th·dT/dt = T_amb + R_th·P_loss − T"],
  ["Imbalance", "x(t) = s·A·(ω/ω₀)²·sin(2π·f_rot·t + φ)"],
  ["Misalignment", "Σ_k s^p_k·A_k·sin(2π·k·f_rot·t + φ_k), k = 1…4, 2× dominant"],
  ["Bearing (outer race)", `BPFO = (N_b/2)(1 − d/D·cos β)·f_rot = ${ORD.bpfo.toFixed(3)}·f_rot; impacts ring as e^(−t/τ)·sin(2π·f_res·t)`],
  ["Electrical", `i(t) = I + ripple·(1 + 0.9s·cos θ)·sin(${MOTOR.commutatorSegments}θ) − notch(θ) + harmonics`],
  ["Looseness", "one-sided clipping of the 1× response + ½× sub-harmonic + rattle impacts"],
];

export default function ArchitecturePage() {
  const s = useTwin();
  const st = stages(s);
  return (
    <div className="space-y-14">
      <PageHeader kicker="Architecture" title="How it works">
        A software-defined digital twin of an RLDC motor: a controlled environment for fault injection, digital signal processing, fault diagnosis and predictive condition
        monitoring. Nothing on screen is a canned animation — every view is computed from the samples flowing down this chain. The copper values are read from the running twin
        now.
      </PageHeader>

      <ol className="max-w-4xl">
        {st.map(([name, file, desc, live], i) => (
          <motion.li
            key={name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 gap-y-1 border-l border-ink/15 pb-6 last:pb-0 md:grid-cols-[28px_minmax(0,1fr)_240px]"
          >
            <span className="num -ml-[14px] flex h-7 w-7 items-center justify-center rounded-full border border-ink/25 bg-canvas text-[11px] text-ink">{i + 1}</span>
            <div>
              <div className="display text-[15px] font-bold uppercase tracking-[0.04em]">{name}</div>
              <div className="text-[13px] leading-relaxed text-muted">{desc}</div>
              <div className="num mt-0.5 text-[10.5px] text-dim">{file}</div>
            </div>
            <div className="num col-start-2 text-[12.5px] text-copper md:col-start-3 md:text-right">{live}</div>
          </motion.li>
        ))}
      </ol>

      <div className="grid gap-x-12 gap-y-12 lg:grid-cols-2">
        <Section title="Input sources">
          <svg viewBox="0 0 380 250" className="w-full max-w-md" role="img" aria-label="Simulation and ESP32 inputs feed the same DSP engine">
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#B26A35" />
              </marker>
            </defs>
            <Box x={20} y={10} title="DIGITAL TWIN" sub="signal engine (default)" active={s?.inputMode !== "external"} />
            <Box x={210} y={10} title="ESP32 / EXTERNAL" sub="CSV now · stream later" active={s?.inputMode === "external"} />
            <path d="M95 60 L95 100 L190 100 L190 124" fill="none" stroke="#D3CAB6" strokeWidth="1.5" />
            <path d="M285 60 L285 100 L190 100" fill="none" stroke="#D3CAB6" strokeWidth="1.5" />
            <path d={s?.inputMode === "external" ? "M285 60 L285 100 L190 100 L190 124" : "M95 60 L95 100 L190 100 L190 124"} fill="none" stroke="#B26A35" strokeWidth="1.6" className="flow-line" markerEnd="url(#arr)" />
            <Box x={115} y={126} title="DSP ENGINE" sub="filter · FFT · STFT · features" active />
            <path d="M190 176 L190 196" stroke="#B26A35" strokeWidth="1.6" className="flow-line" markerEnd="url(#arr)" />
            <Box x={115} y={198} title="DIAGNOSTICS" sub="rules · health · trend" active />
          </svg>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            Every source implements <span className="num text-ink">read(n) → {"{ vib, cur, rpm }"}</span> (lib/engine/sources.js). An ESP32 gateway would push samples into{" "}
            <span className="num text-ink">StreamSource</span> over WebSerial or WebSocket; the DSP and diagnosis code do not change. Hardware is optional, never required.
          </p>
        </Section>
        <Section title="Data & performance">
          <ul className="space-y-2 text-[13px] leading-relaxed text-muted">
            <li>High-rate samples live only in browser ring buffers (65 536 samples per channel). Generation runs every 30 ms; analysis at 8 Hz.</li>
            <li>Charts and the 3D twin read the buffers inside requestAnimationFrame — samples never trigger React re-renders.</li>
            <li>
              MongoDB stores summaries only: <span className="num text-ink">experiments</span>, <span className="num text-ink">scenarios</span> and{" "}
              <span className="num text-ink">simulationSessions</span> (features, diagnosis, health, timestamps, metadata).
            </li>
            <li>
              Route handlers: <span className="num text-ink">/api/simulation</span> (headless twin for What-if), <span className="num text-ink">/api/diagnosis</span> (features →
              verdict), plus CRUD for the three collections.
            </li>
          </ul>
        </Section>
      </div>

      <Section title="Model equations">
        <div className="max-w-4xl">
          {EQUATIONS.map(([k, v]) => (
            <div key={k} className="grid gap-1 border-b border-line py-2 sm:grid-cols-[200px_minmax(0,1fr)]">
              <span className="text-[12.5px] text-muted">{k}</span>
              <span className="num text-[12.5px] text-ink">{v}</span>
            </div>
          ))}
          <p className="num mt-2 text-[11px] text-dim">
            R_a25 = {MOTOR.Ra25} Ω · L_a = {MOTOR.La * 1000} mH · K_e = K_t = {MOTOR.Ke} V·s/rad · rated torque {MOTOR.ratedTorque} N·m (I ≈ {MOTOR.ratedCurrent.toFixed(1)} A) ·{" "}
            {MOTOR.commutatorSegments} commutator segments · {MOTOR.bearing.balls}-ball bearing, d/D = {MOTOR.bearing.dOverD}
          </p>
        </div>
      </Section>

      <Section title="Scope and limitations">
        <ul className="max-w-4xl list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
          <li>All signals are synthetic. Fault models are physics-inspired and calibrated for plausibility, not fitted to a particular physical motor.</li>
          <li>The thermal time constant is compressed to ≈ {MOTOR.thermalTau} s so heating is visible during a demonstration.</li>
          <li>3D rotation is slowed ×1/12 to avoid stroboscopic aliasing on screen; signals are generated at true speed.</li>
          <li>The degradation trend is a model-based estimate (least-squares extrapolation of simulated health), not a validated failure prediction.</li>
          <li>Diagnosis uses transparent deterministic rules. An ML classifier was prototyped and archived (archive/ml); it can be reconnected through the classifier interface.</li>
        </ul>
      </Section>
    </div>
  );
}

function Box({ x, y, title, sub, active }) {
  return (
    <g>
      <rect x={x} y={y} width={150} height={50} rx="2" fill="#FAF8F2" stroke={active ? "#B26A35" : "#D3CAB6"} strokeWidth="1.3" />
      <text x={x + 75} y={y + 21} textAnchor="middle" fill="#262522" style={{ font: "600 11px var(--font-jet), monospace", letterSpacing: "0.08em" }}>
        {title}
      </text>
      <text x={x + 75} y={y + 37} textAnchor="middle" fill="#64605A" style={{ font: "9.5px var(--font-jet), monospace" }}>
        {sub}
      </text>
    </g>
  );
}
