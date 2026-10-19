// Window functions for spectral analysis.
// A window tapers the segment ends to reduce spectral leakage; its coherent
// gain (mean value) is used to correct amplitudes, and the equivalent noise
// bandwidth (ENBW, in bins) describes its resolution/leakage trade-off.


const windowCache = new Map();

export const WINDOWS = ["hann", "hamming", "blackman", "rectangular"];

/** Returns { w, coherentGain, enbw } for a window type and length. */
export function getWindow(type, n) {
  const key = `${type}:${n}`;
  let win = windowCache.get(key);
  if (win) return win;
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = (2 * Math.PI * i) / (n - 1);
    switch (type) {
      case "hamming":
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
      case "rectangular":
        w[i] = 1;
        break;
      default:
        w[i] = 0.5 - 0.5 * Math.cos(x);
    }
  }
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s += w[i];
    s2 += w[i] * w[i];
  }
  win = { w, coherentGain: s / n, enbw: (n * s2) / (s * s), sum: s, sumSq: s2 };
  windowCache.set(key, win);
  return win;
}

/** Characteristic numbers used by the leakage comparison. */
export const WINDOW_INFO = {
  rectangular: { mainLobe: "2 bins", sidelobe: "−13 dB" },
  hann: { mainLobe: "4 bins", sidelobe: "−31 dB" },
  hamming: { mainLobe: "4 bins", sidelobe: "−43 dB" },
  blackman: { mainLobe: "6 bins", sidelobe: "−58 dB" },
};
