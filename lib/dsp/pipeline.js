// The processing chain shared by the live twin, headless runs and dataset
// generation:   raw window → (optional) digital filter → feature extraction.

import { designFilter, applyFilter } from "./filters.js";
import { extractFeatures } from "./features.js";

export const DEFAULT_DSP = {
  fs: 2048,
  fftSize: 2048,
  window: "hann",
  filter: { enabled: false, family: "butterworth", type: "highpass", cutoff: 10, low: 300, high: 800, order: 4, ripple: 1, taps: 63 },
  stft: { nperseg: 512, overlap: 0.75 },
};

const filterCache = new Map();
export function getFilter(fcfg, fs) {
  const key = JSON.stringify([fcfg.family, fcfg.type, fcfg.cutoff, fcfg.low, fcfg.high, fcfg.order, fcfg.ripple, fcfg.taps, fs]);
  let s = filterCache.get(key);
  if (!s) {
    s = designFilter({ ...fcfg, fs });
    filterCache.set(key, s);
    if (filterCache.size > 32) filterCache.delete(filterCache.keys().next().value);
  }
  return s;
}

/**
 * Filter a segment and keep the last `n` samples.  The segment should contain
 * extra leading samples (≥ 256) so the IIR transient has settled before the
 * analysis window begins.
 */
export function filterSegment(segment, n, fcfg, fs) {
  if (!fcfg?.enabled) return Float64Array.from(segment.subarray(segment.length - n));
  const y = applyFilter(getFilter(fcfg, fs), segment);
  return y.subarray(y.length - n);
}

export function processWindow({ vibSegment, curSegment, dsp, frot, telemetry }) {
  const n = dsp.fftSize;
  const vib = filterSegment(vibSegment, n, dsp.filter, dsp.fs);
  const cur = curSegment ? Float64Array.from(curSegment.subarray(curSegment.length - n)) : null;
  const result = extractFeatures({ vib, cur, fs: dsp.fs, frot, window: dsp.window, telemetry });
  return { ...result, vib, cur };
}
