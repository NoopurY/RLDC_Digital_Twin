// Spectral analysis: windowed single-sided amplitude spectrum, Welch PSD,
// peak picking, harmonic tracking, band energy and Hilbert envelope spectrum.

import { fft } from "./fft.js";
import { getWindow } from "./windowing.js";

/**
 * Single-sided amplitude spectrum of the last N samples of x.
 * Scaled by the window's coherent gain so that a sinusoid of amplitude A
 * appears as a peak of height ≈ A.
 */
export function amplitudeSpectrum(x, fs, { n = x.length, window = "hann", removeMean = true } = {}) {
  const offset = x.length - n;
  const { w, sum } = getWindow(window, n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let m = 0;
  if (removeMean) {
    for (let i = 0; i < n; i++) m += x[offset + i];
    m /= n;
  }
  for (let i = 0; i < n; i++) re[i] = (x[offset + i] - m) * w[i];
  fft(re, im);
  const bins = n / 2 + 1;
  const mag = new Float64Array(bins);
  const power = new Float64Array(bins);
  const scale = 2 / sum;
  for (let k = 0; k < bins; k++) {
    const a = Math.hypot(re[k], im[k]) * (k === 0 || k === n / 2 ? scale / 2 : scale);
    mag[k] = a;
    power[k] = a * a;
  }
  return { mag, power, df: fs / n, n, fs };
}

export { welchPSD } from "./psd.js";

/** Parabolic interpolation of a peak at bin k → { freq, amp }. */
export function interpolatePeak(mag, k, df) {
  if (k <= 0 || k >= mag.length - 1) return { freq: k * df, amp: mag[k] };
  const a = mag[k - 1];
  const b = mag[k];
  const c = mag[k + 1];
  // Only interpolate true local maxima; otherwise the parabola is meaningless.
  if (b < a || b < c) return { freq: k * df, amp: b };
  const denom = a - 2 * b + c;
  const p = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { freq: (k + p) * df, amp: b - 0.25 * (a - c) * p };
}

/** Local maxima above a threshold, sorted by amplitude (descending). */
export function findPeaks(mag, df, { minFreq = 1, maxCount = 8, threshold = 0, minSepHz = 3 } = {}) {
  const peaks = [];
  const k0 = Math.max(1, Math.ceil(minFreq / df));
  for (let k = k0; k < mag.length - 1; k++) {
    if (mag[k] > threshold && mag[k] >= mag[k - 1] && mag[k] > mag[k + 1]) peaks.push(interpolatePeak(mag, k, df));
  }
  peaks.sort((p, q) => q.amp - p.amp);
  const out = [];
  for (const p of peaks) {
    if (out.every((o) => Math.abs(o.freq - p.freq) >= minSepHz)) out.push(p);
    if (out.length >= maxCount) break;
  }
  return out;
}

/** Largest amplitude within ±tol Hz of a target frequency (order tracking with tachometer). */
export function amplitudeAt(mag, df, f, tol = 1.5) {
  if (f <= 0) return { freq: 0, amp: 0 };
  const lo = Math.max(1, Math.floor((f - tol) / df));
  const hi = Math.min(mag.length - 2, Math.ceil((f + tol) / df));
  let best = lo;
  for (let k = lo; k <= hi; k++) if (mag[k] > mag[best]) best = k;
  return interpolatePeak(mag, best, df);
}

export function bandPower(power, df, f1, f2) {
  const k1 = Math.max(0, Math.floor(f1 / df));
  const k2 = Math.min(power.length - 1, Math.ceil(f2 / df));
  let s = 0;
  for (let k = k1; k <= k2; k++) s += power[k];
  return s;
}

/** Spectral centroid, bandwidth (2nd moment) and normalised Shannon entropy. */
export function spectralShape(power, df) {
  let total = 0;
  for (let k = 1; k < power.length; k++) total += power[k];
  if (total <= 0) return { centroid: 0, bandwidth: 0, entropy: 0 };
  let c = 0;
  for (let k = 1; k < power.length; k++) c += k * df * power[k];
  c /= total;
  let bw = 0;
  let h = 0;
  for (let k = 1; k < power.length; k++) {
    const p = power[k] / total;
    bw += (k * df - c) ** 2 * p;
    if (p > 0) h -= p * Math.log2(p);
  }
  return { centroid: c, bandwidth: Math.sqrt(bw), entropy: h / Math.log2(power.length - 1) };
}

/**
 * Envelope spectrum (demodulation) for bearing diagnostics:
 * band-limited analytic signal via FFT-domain Hilbert transform, magnitude
 * → envelope, then amplitude spectrum of the envelope.
 */
export function envelopeSpectrum(x, fs, { band = [0.2 * fs, 0.45 * fs], n = x.length } = {}) {
  const offset = x.length - n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = x[offset + i];
  fft(re, im);
  const df = fs / n;
  // Keep only positive frequencies inside the band, doubled → analytic, band-passed signal.
  for (let k = 0; k < n; k++) {
    const f = k * df;
    const inBand = k > 0 && k < n / 2 && f >= band[0] && f <= band[1];
    if (inBand) {
      re[k] *= 2;
      im[k] *= 2;
    } else {
      re[k] = 0;
      im[k] = 0;
    }
  }
  fft(re, im, true);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.hypot(re[i], im[i]) / n;
  return { env, ...amplitudeSpectrum(env, fs, { window: "hann" }) };
}
