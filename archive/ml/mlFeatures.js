// Archived: ML feature vector (was in lib/dsp/features.js)
/**
 * Extended, speed-normalised feature set used by the ML classifier.  Order
 * amplitudes are divided by RMS so the model learns spectral *shape* rather
 * than absolute level, which generalises across speeds.
 */
export const ML_FEATURE_KEYS = [
  "rmsLog",
  "crestFactor",
  "kurtosis",
  "skewness",
  "a1n",
  "a2n",
  "a3n",
  "a05n",
  "harmonicRatio",
  "harmonicCount",
  "spectralEntropy",
  "bandEnergyHigh",
  "bpfoSNRLog",
  "rippleRatio",
  "sidebandRatio",
  "currentTHD",
  "currentPU",
  "tempRise",
];

export function mlVector(f, ambient = 25) {
  const r = Math.max(f.rms, 1e-6);
  const m = {
    rmsLog: Math.log10(r),
    crestFactor: f.crestFactor,
    kurtosis: Math.min(f.kurtosis, 50),
    skewness: f.skewness,
    a1n: f.a1 / r,
    a2n: f.a2 / r,
    a3n: f.a3 / r,
    a05n: f.a05 / r,
    harmonicRatio: Math.min(f.harmonicRatio, 10),
    harmonicCount: f.harmonicCount,
    spectralEntropy: f.spectralEntropy,
    bandEnergyHigh: f.bandEnergyHigh,
    bpfoSNRLog: Math.log10(1 + (f.bpfoSNR ?? 0)),
    rippleRatio: f.rippleRatio ?? 0,
    sidebandRatio: Math.min(f.sidebandRatio ?? 0, 20),
    currentTHD: Math.min(f.currentTHD ?? 0, 20),
    currentPU: f.currentPU ?? 0,
    tempRise: (f.temperature ?? ambient) - ambient,
  };
  return ML_FEATURE_KEYS.map((k) => m[k]);
}
