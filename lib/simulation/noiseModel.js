// Deterministic noise model.
// Every random value in the simulator comes from a seeded PRNG so that a run with
// the same seed and the same parameter timeline reproduces the same samples.

/** mulberry32: small, fast, well-distributed 32-bit PRNG. */
export function createRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const gaussian = () => {
    // Box–Muller, caching the second value.
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };
  return { next, gaussian, state: () => a };
}

/**
 * Coloured measurement noise: white Gaussian sensor noise plus a slow
 * first-order (Brownian-like) drift that mimics structural background vibration.
 */
export function createNoiseModel(rng) {
  let drift = 0;
  return {
    sample(sigma) {
      if (sigma <= 0) return 0;
      drift = 0.995 * drift + 0.1 * rng.gaussian();
      return sigma * (rng.gaussian() + 0.15 * drift);
    },
  };
}
