// Digital filter design and application.
//
// IIR  — Butterworth or Chebyshev Type-I, designed from the analog prototype
//        poles and mapped to the z-plane with the bilinear transform
//        (frequency pre-warped), realised as cascaded second-order sections
//        in Direct-Form-II-Transposed.
// FIR  — windowed-sinc (Hamming), linear phase, applied by direct convolution.
//
// Band-pass = high-pass(f_low) cascaded with low-pass(f_high).

import { convolve } from "./convolution.js";

export const FILTER_TYPES = ["lowpass", "highpass", "bandpass"];
export const FILTER_FAMILIES = ["butterworth", "chebyshev", "fir"];

// ── bilinear transform helpers ──────────────────────────────────────────────
// Analog section H(s) = (B2 s² + B1 s + B0) / (A2 s² + A1 s + A0), K = 2·f_s
function bilinear2(B2, B1, B0, A2, A1, A0, K) {
  const K2 = K * K;
  const a0 = A2 * K2 + A1 * K + A0;
  return {
    b: [(B2 * K2 + B1 * K + B0) / a0, (2 * B0 - 2 * B2 * K2) / a0, (B2 * K2 - B1 * K + B0) / a0],
    a: [1, (2 * A0 - 2 * A2 * K2) / a0, (A2 * K2 - A1 * K + A0) / a0],
  };
}
function bilinear1(B1, B0, A1, A0, K) {
  const a0 = A1 * K + A0;
  return { b: [(B1 * K + B0) / a0, (B0 - B1 * K) / a0, 0], a: [1, (A0 - A1 * K) / a0, 0] };
}

/**
 * Normalised (ω_c = 1) low-pass prototype poles in the left half-plane.
 * Returns pole pairs as { sigma (>0, = −Re p), mag2 (=|p|²) } and an optional real pole.
 */
function prototype(family, order, rippleDb) {
  const pairs = [];
  let real = null;
  let gain = 1;
  if (family === "chebyshev") {
    const eps = Math.sqrt(10 ** (rippleDb / 10) - 1);
    const v0 = Math.asinh(1 / eps) / order;
    for (let k = 1; k <= Math.floor(order / 2); k++) {
      const th = (Math.PI * (2 * k - 1)) / (2 * order);
      const sigma = Math.sinh(v0) * Math.sin(th);
      const w = Math.cosh(v0) * Math.cos(th);
      pairs.push({ sigma, mag2: sigma * sigma + w * w });
    }
    if (order % 2) real = Math.sinh(v0);
    if (order % 2 === 0) gain = 1 / Math.sqrt(1 + eps * eps); // even order: passband starts at the ripple trough
  } else {
    for (let k = 1; k <= Math.floor(order / 2); k++) {
      const th = (Math.PI * (2 * k - 1)) / (2 * order);
      pairs.push({ sigma: Math.sin(th), mag2: 1 });
    }
    if (order % 2) real = 1;
  }
  return { pairs, real, gain };
}

function iirSections(family, kind, fc, fs, order, rippleDb) {
  const nyq = fs / 2;
  fc = Math.min(Math.max(fc, 0.5), nyq * 0.98);
  const K = 2 * fs;
  const wc = K * Math.tan((Math.PI * fc) / fs); // pre-warped analog cut-off
  const { pairs, real, gain } = prototype(family, order, rippleDb);
  const sections = [];
  for (const { sigma, mag2 } of pairs) {
    if (kind === "lowpass") sections.push(bilinear2(0, 0, mag2 * wc * wc, 1, 2 * sigma * wc, mag2 * wc * wc, K));
    // s → ω_c/s maps the low-pass prototype to a high-pass section
    else sections.push(bilinear2(1, 0, 0, 1, (2 * sigma * wc) / mag2, (wc * wc) / mag2, K));
  }
  if (real !== null) {
    if (kind === "lowpass") sections.push(bilinear1(0, real * wc, 1, real * wc, K));
    else sections.push(bilinear1(1, 0, 1, wc / real, K));
  }
  if (gain !== 1 && sections.length) sections[0] = { b: sections[0].b.map((v) => v * gain), a: sections[0].a };
  return sections;
}

// ── FIR (windowed sinc) ─────────────────────────────────────────────────────
function sinc(x) {
  return x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
}
function firTaps(kind, fs, { cutoff, low, high }, numTaps) {
  const N = numTaps % 2 ? numTaps : numTaps + 1; // odd → type-I linear phase (HP/BP need it)
  const M = N - 1;
  const h = new Float64Array(N);
  const lp = (fc, n) => (2 * fc) / fs * sinc(((2 * fc) / fs) * (n - M / 2));
  for (let n = 0; n < N; n++) {
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / M); // Hamming
    let v;
    if (kind === "lowpass") v = lp(cutoff, n);
    else if (kind === "highpass") v = (n === M / 2 ? 1 : 0) - lp(cutoff, n);
    else v = lp(high, n) - lp(low, n);
    h[n] = v * w;
  }
  return h;
}

/**
 * Design a filter.
 * @returns {{kind:"iir", sections:Array} | {kind:"fir", taps:Float64Array}}
 */
export function designFilter({ family = "butterworth", type = "lowpass", fs, cutoff = 200, low = 100, high = 400, order = 4, ripple = 1, taps = 63 }) {
  if (family === "fir") return { kind: "fir", taps: firTaps(type, fs, { cutoff, low: Math.min(low, high - 1), high }, Math.max(5, Math.min(401, Math.round(taps)))) };
  order = Math.max(1, Math.min(10, Math.round(order)));
  const fam = family === "chebyshev" ? "chebyshev" : "butterworth";
  if (type === "lowpass") return { kind: "iir", sections: iirSections(fam, "lowpass", cutoff, fs, order, ripple) };
  if (type === "highpass") return { kind: "iir", sections: iirSections(fam, "highpass", cutoff, fs, order, ripple) };
  const lo = Math.min(low, high - 1);
  return { kind: "iir", sections: [...iirSections(fam, "highpass", lo, fs, order, ripple), ...iirSections(fam, "lowpass", high, fs, order, ripple)] };
}

const asDesign = (d) => (Array.isArray(d) ? { kind: "iir", sections: d } : d);

/** Apply a designed filter to a signal. Returns a new Float64Array. */
export function applyFilter(design, x) {
  const d = asDesign(design);
  if (d.kind === "fir") return convolve(x, d.taps);
  let y = Float64Array.from(x);
  for (const { b, a } of d.sections) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = b[0] * xi + z1;
      z1 = b[1] * xi - a[1] * yi + z2;
      z2 = b[2] * xi - a[2] * yi;
      y[i] = yi;
    }
  }
  return y;
}

/** Magnitude response |H(e^{jω})| at the given frequencies. */
export function frequencyResponse(design, fs, freqs) {
  const d = asDesign(design);
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    const w = (2 * Math.PI * freqs[i]) / fs;
    if (d.kind === "fir") {
      let re = 0;
      let im = 0;
      for (let n = 0; n < d.taps.length; n++) {
        re += d.taps[n] * Math.cos(w * n);
        im -= d.taps[n] * Math.sin(w * n);
      }
      out[i] = Math.hypot(re, im);
      continue;
    }
    const c1 = Math.cos(w);
    const s1 = Math.sin(w);
    const c2 = Math.cos(2 * w);
    const s2 = Math.sin(2 * w);
    let mag = 1;
    for (const { b, a } of d.sections) {
      const nr = b[0] + b[1] * c1 + b[2] * c2;
      const ni = -(b[1] * s1 + b[2] * s2);
      const dr = a[0] + a[1] * c1 + a[2] * c2;
      const di = -(a[1] * s1 + a[2] * s2);
      mag *= Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
    out[i] = mag;
  }
  return out;
}

/** Group delay in samples (FIR: (N−1)/2; IIR: not constant → null). */
export const groupDelay = (design) => (asDesign(design).kind === "fir" ? (asDesign(design).taps.length - 1) / 2 : null);

/** Remove the DC component (mean). */
export function detrend(x) {
  let m = 0;
  for (let i = 0; i < x.length; i++) m += x[i];
  m /= x.length;
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] - m;
  return y;
}
