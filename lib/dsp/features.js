// Feature extraction: turns a processed signal window into the diagnostic
// feature set (time-domain, frequency-domain, envelope and motor-current).

import { timeStats } from "./statistics.js";
import { amplitudeSpectrum, amplitudeAt, findPeaks, spectralShape, bandPower, envelopeSpectrum } from "./spectrum.js";
import { MOTOR, bearingOrders } from "../simulation/motorModel.js";

const ORDERS = bearingOrders();

function median(arr) {
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/**
 * @param vib     processed vibration window (g)
 * @param cur     armature current window (A) — may be null for vibration-only inputs
 * @param fs      sampling frequency (Hz)
 * @param frot    shaft frequency from the tachometer channel (Hz)
 * @param window  FFT window type
 * @param telemetry scalar channels { rpm, temperature, load }
 */
export function extractFeatures({ vib, cur, fs, frot, window = "hann", telemetry = {} }) {
  const n = vib.length;
  const t = timeStats(vib);
  const spec = amplitudeSpectrum(vib, fs, { window });
  const { mag, power, df } = spec;
  const nyq = fs / 2;

  // Orders (tachometer-referenced)
  const tol = Math.max(1.5 * df, 0.5);
  const order = (k) => amplitudeAt(mag, df, k * frot, tol).amp;
  const a05 = frot > 1 ? order(0.5) : 0;
  const a = [0, 1, 2, 3, 4, 5, 6].map((k) => (k === 0 || frot <= 0.5 || k * frot > nyq - 2 ? 0 : order(k)));
  const floor = median(mag) * 4 + 1e-4;
  const harmonicCount = a.slice(1).filter((v) => v > Math.max(floor, 0.06 * a[1])).length;

  const peaks = findPeaks(mag, df, { minFreq: 2, maxCount: 8, threshold: floor });
  const dominant = peaks[0] ?? { freq: 0, amp: 0 };
  const shape = spectralShape(power, df);

  // Band energy split: low (≤ 6.5×) / mid / high (≥ 20 % of fs) — fractions of total.
  const total = bandPower(power, df, df, nyq) || 1e-12;
  const lowEdge = Math.min(Math.max(6.5 * frot, 20), nyq * 0.5);
  const highEdge = Math.max(0.2 * fs, lowEdge + 1);
  const eLow = bandPower(power, df, df, lowEdge) / total;
  const eHigh = bandPower(power, df, highEdge, nyq) / total;
  const eMid = Math.max(0, 1 - eLow - eHigh);

  // Envelope analysis around the bearing/structural resonance band.
  let bpfoAmp = 0;
  let bpfoSNR = 0;
  let envelope = null;
  if (frot > 1) {
    const env = envelopeSpectrum(vib, fs, { band: [0.2 * fs, 0.42 * fs] });
    const bpfo = ORDERS.bpfo * frot;
    if (bpfo < fs / 2 - 5) {
      bpfoAmp = amplitudeAt(env.mag, env.df, bpfo, Math.max(2 * env.df, 1.5)).amp;
      // Floor guard: if the resonance band holds no energy (e.g. removed by a
      // low-pass filter) the median → 0 and the ratio would explode.
      const envFloor = median(env.mag.subarray(1, Math.min(env.mag.length, Math.ceil(400 / env.df)))) + 2e-3 * t.rms + 1e-5;
      bpfoSNR = bpfoAmp / envFloor;
    }
    envelope = env;
  }

  // Motor current signature analysis (MCSA)
  let currentFeatures = {};
  let curSpec = null;
  if (cur && cur.length) {
    const ct = timeStats(cur);
    curSpec = amplitudeSpectrum(cur, fs, { window });
    const cm = curSpec.mag;
    const cdf = curSpec.df;
    const fc = MOTOR.commutatorSegments * frot;
    const ctol = Math.max(1.5 * cdf, 0.5);
    const ca = (f) => (f > 0 && f < nyq - 2 ? amplitudeAt(cm, cdf, f, ctol).amp : 0);
    const aComm = ca(fc);
    const sidebands = ca(fc - frot) + ca(fc + frot);
    const meanI = Math.abs(ct.mean) || 1e-6;
    currentFeatures = {
      currentMean: ct.mean,
      currentRipple: ct.std,
      rippleRatio: ct.std / meanI,
      current1x: ca(frot) / meanI,
      sidebandRatio: aComm > 1e-6 ? sidebands / aComm : 0,
      currentTHD: aComm > 1e-6 ? Math.hypot(ca(2 * fc), ca(3 * fc)) / aComm : 0,
      currentSkew: ct.skewness,
      currentPU: ct.mean / MOTOR.ratedCurrent,
    };
  }

  const features = {
    // time domain
    mean: t.mean,
    rms: t.rms,
    variance: t.variance,
    std: t.std,
    peak: t.peak,
    peakToPeak: t.peakToPeak,
    crestFactor: t.crestFactor,
    kurtosis: t.kurtosis,
    skewness: t.skewness,
    // frequency domain
    dominantFrequency: dominant.freq,
    dominantAmplitude: dominant.amp,
    shaftFrequency: frot,
    a05,
    a1: a[1],
    a2: a[2],
    a3: a[3],
    a4: a[4],
    a5: a[5],
    a6: a[6],
    harmonicRatio: a[1] > 1e-6 ? (a[2] + a[3]) / a[1] : 0,
    harmonicCount,
    spectralCentroid: shape.centroid,
    spectralBandwidth: shape.bandwidth,
    spectralEntropy: shape.entropy,
    bandEnergyLow: eLow,
    bandEnergyMid: eMid,
    bandEnergyHigh: eHigh,
    bpfoAmp,
    bpfoSNR,
    ...currentFeatures,
    // telemetry channels
    rpm: telemetry.rpm ?? frot * 60,
    temperature: telemetry.temperature ?? null,
    load: telemetry.load ?? null,
    n,
    fs,
  };
  return { features, spectrum: spec, currentSpectrum: curSpec, envelope, peaks };
}

/** The compact 8-element feature vector from the specification. */
export const FEATURE_VECTOR_KEYS = [
  "rms",
  "peak",
  "crestFactor",
  "kurtosis",
  "dominantFrequency",
  "harmonicRatio",
  "spectralEntropy",
  "bandEnergyHigh",
];

export const featureVector = (f) => FEATURE_VECTOR_KEYS.map((k) => f[k] ?? 0);
