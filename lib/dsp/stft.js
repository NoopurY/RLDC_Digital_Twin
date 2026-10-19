// Short-Time Fourier Transform.  Frames are computed incrementally as new
// samples arrive so the spectrogram can scroll in real time without
// recomputing history.

import { fft } from "./fft.js";
import { getWindow } from "./windowing.js";

/** Magnitude (dB re 1 g) of one STFT frame starting at `start`. */
export function stftFrame(x, start, nperseg, window = "hann", out) {
  const { w, sum } = getWindow(window, nperseg);
  const re = new Float64Array(nperseg);
  const im = new Float64Array(nperseg);
  let m = 0;
  for (let i = 0; i < nperseg; i++) m += x[start + i];
  m /= nperseg;
  for (let i = 0; i < nperseg; i++) re[i] = (x[start + i] - m) * w[i];
  fft(re, im);
  const bins = nperseg / 2;
  const db = out ?? new Float32Array(bins);
  const scale = 2 / sum;
  for (let k = 0; k < bins; k++) db[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) * scale + 1e-6);
  return db;
}

/** Full STFT of a signal: returns { frames: Float32Array[], times, df }. */
export function stft(x, fs, { nperseg = 256, overlap = 0.5, window = "hann" } = {}) {
  const hop = Math.max(1, Math.round(nperseg * (1 - overlap)));
  const frames = [];
  const times = [];
  for (let s = 0; s + nperseg <= x.length; s += hop) {
    frames.push(stftFrame(x, s, nperseg, window));
    times.push((s + nperseg / 2) / fs);
  }
  return { frames, times, df: fs / nperseg, hop };
}

/**
 * Rolling spectrogram buffer: a fixed number of columns (time) × bins.
 * Each `push` consumes new samples from a ring-buffer reader and emits frames.
 */
export class RollingSpectrogram {
  constructor({ columns = 240, nperseg = 256, overlap = 0.5, window = "hann" } = {}) {
    this.configure({ columns, nperseg, overlap, window });
  }
  configure({ columns, nperseg, overlap, window }) {
    this.columns = columns;
    this.nperseg = nperseg;
    this.overlap = overlap;
    this.window = window;
    this.hop = Math.max(1, Math.round(nperseg * (1 - overlap)));
    this.bins = nperseg / 2;
    this.data = new Float32Array(columns * this.bins).fill(-120);
    this.colTimes = new Float64Array(columns);
    this.head = 0; // next column to write
    this.count = 0;
    this.version = 0;
    this.lastStart = null;
  }
  /** `getSamples(start, len)` reads absolute sample indices from the source buffer. */
  update(totalSamples, getSamples, fs) {
    if (this.lastStart === null) this.lastStart = Math.max(0, totalSamples - this.nperseg);
    const frame = new Float32Array(this.bins);
    while (this.lastStart + this.nperseg <= totalSamples) {
      const seg = getSamples(this.lastStart, this.nperseg);
      if (!seg) {
        this.lastStart = totalSamples - this.nperseg;
        break;
      }
      stftFrame(seg, 0, this.nperseg, this.window, frame);
      this.data.set(frame, this.head * this.bins);
      this.colTimes[this.head] = (this.lastStart + this.nperseg / 2) / fs;
      this.head = (this.head + 1) % this.columns;
      this.count = Math.min(this.count + 1, this.columns);
      this.lastStart += this.hop;
      this.version++;
    }
  }
}
