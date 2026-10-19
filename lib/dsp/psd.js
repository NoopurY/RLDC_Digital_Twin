// Power spectral density by Welch's method: average the periodograms of
// overlapping Hann-windowed segments → lower variance than a single FFT.
//   PSD[k] = (1 / (f_s·Σw²)) · mean_m |FFT(w·x_m)[k]|²   (one-sided ×2)

import { fft } from "./fft.js";
import { getWindow } from "./windowing.js";

/** Welch power spectral density (units²/Hz), Hann window, 50 % overlap. */
export function welchPSD(x, fs, nperseg = 256) {
  const { w, sumSq } = getWindow("hann", nperseg);
  const hop = nperseg / 2;
  const bins = nperseg / 2 + 1;
  const psd = new Float64Array(bins);
  let segs = 0;
  const re = new Float64Array(nperseg);
  const im = new Float64Array(nperseg);
  for (let s = 0; s + nperseg <= x.length; s += hop) {
    let m = 0;
    for (let i = 0; i < nperseg; i++) m += x[s + i];
    m /= nperseg;
    for (let i = 0; i < nperseg; i++) {
      re[i] = (x[s + i] - m) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) psd[k] += (re[k] * re[k] + im[k] * im[k]) / (fs * sumSq);
    segs++;
  }
  for (let k = 0; k < bins; k++) psd[k] = (psd[k] / Math.max(segs, 1)) * (k === 0 || k === bins - 1 ? 1 : 2);
  return { psd, df: fs / nperseg };
}

/** Total power in a frequency band from a PSD (rectangular integration). */
export function bandPowerPSD(psd, df, f1, f2) {
  let s = 0;
  for (let k = Math.max(0, Math.floor(f1 / df)); k <= Math.min(psd.length - 1, Math.ceil(f2 / df)); k++) s += psd[k] * df;
  return s;
}
