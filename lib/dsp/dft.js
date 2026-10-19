// Direct (O(N²)) discrete Fourier transform — kept for teaching and as an
// independent check that the FFT is correct:
//   X[k] = Σ_{n=0}^{N−1} x[n] · e^{−j2πkn/N}

export function dft(x) {
  const N = x.length;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    let sr = 0;
    let si = 0;
    for (let n = 0; n < N; n++) {
      const a = (-2 * Math.PI * k * n) / N;
      sr += x[n] * Math.cos(a);
      si += x[n] * Math.sin(a);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}
