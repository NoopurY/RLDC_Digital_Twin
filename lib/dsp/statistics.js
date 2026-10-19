// Time-domain statistics computed in a single pass where possible.

export function timeStats(x) {
  const n = x.length;
  let sum = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    sum += v;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  const mean = sum / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const v = x[i];
    sq += v * v;
    const d = v - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const variance = m2;
  const std = Math.sqrt(variance);
  const rms = Math.sqrt(sq / n);
  const peak = Math.max(Math.abs(max), Math.abs(min));
  return {
    mean,
    rms,
    variance,
    std,
    peak,
    peakToPeak: max - min,
    crestFactor: rms > 0 ? peak / rms : 0,
    // Pearson kurtosis (Gaussian = 3) and skewness (symmetric = 0)
    kurtosis: variance > 0 ? m4 / (variance * variance) : 0,
    skewness: std > 0 ? m3 / (std * std * std) : 0,
  };
}

export function mean(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/** Ordinary least-squares line fit y = a + b·x. */
export function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return { a: ys[0] ?? 0, b: 0, r2: 0 };
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = my - b * mx;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { a, b, r2 };
}
