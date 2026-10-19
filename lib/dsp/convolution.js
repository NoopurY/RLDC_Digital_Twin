// Discrete linear convolution  y[n] = Σ_k h[k]·x[n − k]
// Used by the FIR filter (direct form). "same"-length causal output: y has the
// length of x and uses zero initial conditions.

export function convolve(x, h) {
  const N = x.length;
  const M = h.length;
  const y = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    let acc = 0;
    const kmax = Math.min(M - 1, n);
    for (let k = 0; k <= kmax; k++) acc += h[k] * x[n - k];
    y[n] = acc;
  }
  return y;
}
