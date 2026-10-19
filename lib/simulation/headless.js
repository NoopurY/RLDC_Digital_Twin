// Headless (no-UI) simulation runs.  Same generator, same DSP, same diagnosis
// as the live twin — used for the healthy reference, What-If analysis,
// dataset generation and the server-side /api/simulation route.

import { SignalGenerator } from "./signalGenerator.js";
import { DEFAULT_PARAMS, EMPTY_FAULTS, rpmOf } from "./motorModel.js";
import { DEFAULT_DSP, processWindow } from "../dsp/pipeline.js";
import { RuleClassifier } from "../diagnosis/classifier.js";
import { computeHealth } from "../diagnosis/healthScore.js";

const PAD = 512; // filter settling samples

const AVG_KEYS = [
  "rms", "peak", "peakToPeak", "crestFactor", "kurtosis", "skewness", "variance", "std", "mean",
  "a05", "a1", "a2", "a3", "a4", "a5", "a6", "harmonicRatio", "harmonicCount",
  "spectralCentroid", "spectralBandwidth", "spectralEntropy", "bandEnergyLow", "bandEnergyMid", "bandEnergyHigh",
  "bpfoAmp", "bpfoSNR", "currentMean", "currentRipple", "rippleRatio", "current1x", "sidebandRatio",
  "currentTHD", "currentSkew", "currentPU", "dominantAmplitude",
];

export function averageFeatures(list) {
  const out = { ...list.at(-1) };
  for (const k of AVG_KEYS) {
    if (list[0][k] === undefined) continue;
    out[k] = list.reduce((s, f) => s + (f[k] ?? 0), 0) / list.length;
  }
  return out;
}

/** Generate `windows` analysis windows at steady state and return per-window + averaged features. */
export function simulateWindows({ params, faults, dsp = DEFAULT_DSP, seed = 1, windows = 3, warmup = 0.3 }) {
  const gen = new SignalGenerator({ seed, fs: dsp.fs, params, faults, steady: true });
  const n = dsp.fftSize;
  // Warm-up so fault state machines (bearing impacts, rattle) are running.
  gen.generate(Math.round(warmup * dsp.fs), params, faults);
  const results = [];
  for (let w = 0; w < windows; w++) {
    const total = n + PAD;
    const vib = new Float32Array(total);
    const cur = new Float32Array(total);
    // Generate in ≤ 50 ms blocks like the live engine.
    const block = Math.round(dsp.fs * 0.05);
    for (let i = 0; i < total; i += block) {
      const m = Math.min(block, total - i);
      gen.generate(m, params, faults, { vib: vib.subarray(i, i + m), cur: cur.subarray(i, i + m) });
    }
    const r = processWindow({
      vibSegment: vib,
      curSegment: cur,
      dsp,
      frot: gen.frot,
      telemetry: { rpm: gen.rpm, temperature: gen.temp, load: params.load },
    });
    results.push(r);
  }
  return { results, gen, features: averageFeatures(results.map((r) => r.features)) };
}

/** Healthy reference for a given operating point (the twin's "expected" behaviour). */
export function computeBaseline(params, dsp = DEFAULT_DSP, seed = 4242) {
  return simulateWindows({ params, faults: EMPTY_FAULTS, dsp, seed, windows: 3 }).features;
}

export function runHeadless({ params = DEFAULT_PARAMS, faults = EMPTY_FAULTS, dsp = DEFAULT_DSP, seed = 1, windows = 3, classifier = RuleClassifier } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const f = { ...EMPTY_FAULTS, ...faults };
  const { features, gen, results } = simulateWindows({ params: p, faults: f, dsp, seed, windows });
  const baseline = computeBaseline(p, dsp);
  const diagnosis = classifier.classify(features, baseline, { rpmSet: p.rpm, ambient: p.ambientTemp });
  const health = computeHealth(features, baseline);
  const op = gen.op;
  const last = results.at(-1);
  return {
    params: p,
    faults: f,
    telemetry: {
      rpm: rpmOf(gen.state.omega),
      temperature: gen.temp,
      current: op.current,
      torque: op.torque,
      efficiency: op.efficiency,
      pIn: op.pIn,
      saturated: op.saturated,
    },
    features,
    baseline,
    diagnosis: { label: diagnosis.label, primary: diagnosis.primary, confidence: diagnosis.confidence, severity: diagnosis.severity, scores: diagnosis.scores, evidence: diagnosis.evidence },
    health: { score: health.score, band: health.band.label, items: health.items },
    spectrum: downsampleSpectrum(last.spectrum.mag, last.spectrum.df, 256),
  };
}

/** Compact spectrum summary for persistence (max-pooled to `bins` points). */
export function downsampleSpectrum(mag, df, bins = 256) {
  const step = Math.max(1, Math.floor(mag.length / bins));
  const out = [];
  for (let i = 0; i + step <= mag.length; i += step) {
    let m = 0;
    for (let j = i; j < i + step; j++) m = Math.max(m, mag[j]);
    out.push(+m.toFixed(5));
  }
  return { df: df * step, mag: out };
}
