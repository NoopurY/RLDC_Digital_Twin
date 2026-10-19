// Synthetic dataset generator.  Sweeps operating conditions × fault classes ×
// severities, generates real signal windows through the simulator and
// extracts features with the same DSP pipeline used live.

import { simulateWindows } from "./headless.js";
import { EMPTY_FAULTS } from "./motorModel.js";
import { createRng } from "./noiseModel.js";
import { DEFAULT_DSP } from "../dsp/pipeline.js";
import { mlVector } from "../dsp/features.js";
import { CLASSES } from "../diagnosis/classifier.js";

export const DEFAULT_SWEEP = {
  rpms: [800, 1000, 1200, 1500, 1800, 2200, 2500],
  loads: [10, 20, 40, 60, 80, 100],
  severityRange: [0.2, 1.0],
  windowsPerCombo: 1,
  seed: 2024,
};

export const DATASET_COLUMNS = [
  "timestamp", "rpm", "load", "temperature", "current", "rms", "peak", "crest_factor", "kurtosis",
  "dominant_frequency", "spectral_entropy", "harmonic_ratio", "fault_type", "fault_severity",
];

export function generateDataset(sweep = DEFAULT_SWEEP, { dsp = DEFAULT_DSP, onProgress } = {}) {
  const rng = createRng(sweep.seed);
  const rows = [];
  const X = [];
  const y = [];
  const P = []; // operating point + raw features per row (for rule-engine evaluation)
  const jobs = [];
  for (const rpm of sweep.rpms)
    for (const load of sweep.loads)
      for (const cls of CLASSES) {
        jobs.push({ rpm, load, cls });
      }
  const [smin, smax] = sweep.severityRange;
  let done = 0;
  for (const job of jobs) {
    for (let w = 0; w < sweep.windowsPerCombo; w++) {
      const severity = job.cls === "healthy" ? 0 : smin + (smax - smin) * rng.next();
      const params = {
        rpm: job.rpm,
        load: job.load,
        voltage: 215 + 30 * rng.next(),
        ambientTemp: 20 + 15 * rng.next(),
        noise: 2 + 20 * rng.next(),
        age: 10 * rng.next(),
        baseVibration: 10 + 30 * rng.next(),
      };
      const faults = { ...EMPTY_FAULTS };
      if (job.cls !== "healthy") faults[job.cls] = severity;
      const seed = Math.floor(rng.next() * 2 ** 31);
      const { features: f } = simulateWindows({ params, faults, dsp, seed, windows: 1, warmup: 0.25 });
      X.push(mlVector(f, params.ambientTemp));
      y.push(CLASSES.indexOf(job.cls));
      P.push({ params, features: f });
      rows.push({
        timestamp: rows.length,
        rpm: +f.rpm.toFixed(1),
        load: params.load,
        temperature: +f.temperature.toFixed(2),
        current: +(f.currentMean ?? 0).toFixed(3),
        rms: +f.rms.toFixed(5),
        peak: +f.peak.toFixed(5),
        crest_factor: +f.crestFactor.toFixed(4),
        kurtosis: +f.kurtosis.toFixed(4),
        dominant_frequency: +f.dominantFrequency.toFixed(2),
        spectral_entropy: +f.spectralEntropy.toFixed(4),
        harmonic_ratio: +f.harmonicRatio.toFixed(4),
        fault_type: job.cls,
        fault_severity: +severity.toFixed(3),
      });
    }
    done++;
    if (onProgress && done % 8 === 0) onProgress(done / jobs.length);
  }
  return { rows, X, y, P, classes: CLASSES };
}

export function toCSV(rows) {
  const head = DATASET_COLUMNS.join(",");
  return [head, ...rows.map((r) => DATASET_COLUMNS.map((c) => r[c]).join(","))].join("\n");
}
