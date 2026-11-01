// Frequency analysis for the DSP Analysis "Frequency Analysis (DFT & FFT)" module.
// Wraps the existing direct DFT (dft.js) and radix-2 FFT (fft.js): forward
// transform, single-sided magnitude spectrum, inverse FFT reconstruction and a
// measured DFT-vs-FFT comparison.  No window is applied (rectangular), so the
// result is exactly the textbook X[k].

import { dft } from "./dft.js";
import { fft } from "./fft.js";

export const isPowerOfTwo = (n) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

/** Single-sided amplitude spectrum: |X[k]|·2/N (DC and Nyquist bins ×1/N). */
function amplitude(re, im) {
  const N = re.length;
  const bins = Math.floor(N / 2) + 1;
  const mag = new Float64Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = (Math.hypot(re[k], im[k]) * (k === 0 || (N % 2 === 0 && k === N / 2) ? 1 : 2)) / N;
  return mag;
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * @param x   real samples (length N)
 * @param fs  sampling frequency (Hz)
 * @returns   spectra from DFT and (if N is a power of two) FFT, timings, IFFT reconstruction
 */
export function analyzeFrequency(x, fs) {
  const N = x.length;
  const df = fs / N;
  const radix2 = isPowerOfTwo(N);

  // Remove the mean so the DC bin does not dominate the plot (stated in the UI).
  let mean = 0;
  for (const v of x) mean += v;
  mean /= N;
  const xs = Float64Array.from(x, (v) => v - mean);

  const t0 = now();
  const D = dft(xs);
  const tDft = now() - t0;
  const dftMag = amplitude(D.re, D.im);

  let fftRes = null;
  if (radix2) {
    const re = Float64Array.from(xs);
    const im = new Float64Array(N);
    const t1 = now();
    fft(re, im);
    const tFft = now() - t1;
    let maxDiff = 0;
    for (let k = 0; k < N; k++) maxDiff = Math.max(maxDiff, Math.hypot(re[k] - D.re[k], im[k] - D.im[k]));

    // Inverse FFT: x[n] = (1/N)·Σ X[k]·e^{+j2πkn/N}
    const rr = Float64Array.from(re);
    const ri = Float64Array.from(im);
    fft(rr, ri, true);
    const recon = new Float64Array(N);
    let reconErr = 0;
    for (let n = 0; n < N; n++) {
      recon[n] = rr[n] / N + mean;
      reconErr = Math.max(reconErr, Math.abs(recon[n] - x[n]));
    }
    fftRes = { re, im, mag: amplitude(re, im), time: tFft, maxDiff, recon, reconErr };
  }

  const mag = fftRes ? fftRes.mag : dftMag;
  let kMax = 1;
  for (let k = 1; k < mag.length; k++) if (mag[k] > mag[kMax]) kMax = k;
  return {
    N,
    fs,
    df,
    nyquist: fs / 2,
    radix2,
    mean,
    dft: { mag: dftMag, time: tDft },
    fft: fftRes,
    mag,
    dominant: { freq: kMax * df, amp: mag[kMax], bin: kMax },
    ops: { dft: N * N, fft: radix2 ? (N / 2) * Math.log2(N) : null },
  };
}

/** Amplitude near a target frequency (nearest bin ± 1) and whether it stands above the noise floor. */
export function harmonicAt(mag, df, f) {
  const k0 = Math.round(f / df);
  if (k0 < 1 || k0 >= mag.length) return null;
  let k = k0;
  for (const c of [k0 - 1, k0 + 1]) if (c >= 1 && c < mag.length && mag[c] > mag[k]) k = c;
  const sorted = Array.from(mag).slice(1).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length / 2)] || 1e-12;
  return { freq: k * df, amp: mag[k], present: mag[k] > 4 * floor && mag[k] > 1e-6 };
}
