// Motor health score (0–100) built from explicit, feature-based penalties.
// Each contribution is computed from extracted features relative to the
// healthy reference, so the score is fully traceable.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const HEALTH_BANDS = [
  { min: 80, label: "HEALTHY", tone: "ok" },
  { min: 60, label: "WARNING", tone: "warn" },
  { min: 40, label: "DEGRADED", tone: "warn" },
  { min: 20, label: "CRITICAL", tone: "bad" },
  { min: -1, label: "FAILURE RISK", tone: "bad" },
];

export const healthBand = (score) => HEALTH_BANDS.find((b) => score >= b.min) ?? HEALTH_BANDS.at(-1);

export function computeHealth(f, base) {
  const rmsRatio = (f.rms + 1e-4) / (base.rms + 1e-4);
  const items = [
    {
      key: "vibration",
      label: "Vibration (RMS vs reference)",
      formula: `14·(log₂(${rmsRatio.toFixed(2)}) − 1)`,
      value: -clamp(14 * (Math.log2(rmsRatio) - 1), 0, 40),
    },
    {
      key: "harmonic",
      label: "Harmonic / sub-harmonic content",
      formula: `8·Δ(harmonic ratio) + 60·Δ(0.5×/1×)`,
      value: -clamp(
        8 * (f.harmonicRatio - base.harmonicRatio - 0.3) +
          60 * Math.max(0, f.a05 / Math.max(f.a1, 1e-4) - 0.12),
        0,
        18
      ),
    },
    {
      key: "impulsive",
      label: "Impulsiveness (kurtosis, BPFO)",
      formula: `3·Δkurtosis + 5·log₂(BPFO SNR / 4)`,
      value: -clamp(
        3 * Math.max(0, f.kurtosis - Math.max(base.kurtosis, 3) - 0.5) + 5 * Math.max(0, Math.log2(Math.max(f.bpfoSNR, 1) / 4)),
        0,
        24
      ),
    },
    {
      key: "temperature",
      label: "Temperature",
      formula: `0.6·(T − 65 °C)`,
      value: -clamp(0.6 * ((f.temperature ?? 25) - 65), 0, 20),
    },
    {
      key: "current",
      label: "Current (load & signature)",
      formula: `40·(I/I_rated − 1) + 25·Δsidebands`,
      value: -clamp(
        40 * Math.max(0, (f.currentPU ?? 0) - 1.0) + 25 * Math.max(0, (f.sidebandRatio ?? 0) - (base.sidebandRatio ?? 0) - 0.06),
        0,
        22
      ),
    },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  const score = clamp(100 + total, 0, 100);
  return { score, base: 100, items, band: healthBand(score) };
}
