// Signal sources for the DSP Analysis and Compare modules.
//
// motorSignal() re-runs the existing motor signal generator with the simulator's
// current parameters and fault state (read-only — the live engine is never
// touched), at the sampling rate the student chooses.  testSignal() builds a
// clean, known sum of sinusoids for checking results by hand.
//
// Both return `pre` (samples that precede the analysed segment) so IIR filters
// can be warmed up and their start-up transient discarded.

import { SignalGenerator } from "../simulation/signalGenerator.js";
import { createRng } from "../simulation/noiseModel.js";

const BLOCK_S = 0.05;

export function motorSignal({ params, faults, fs, n, channel = "vib", pre = 0, seed = 11, settle = 0.5 }) {
  const gen = new SignalGenerator({ seed, fs, params, faults, steady: true });
  gen.generate(Math.round(settle * fs), params, faults); // let fault state machines start
  const total = pre + n;
  const vib = new Float32Array(total);
  const cur = new Float32Array(total);
  const block = Math.max(1, Math.round(fs * BLOCK_S));
  for (let i = 0; i < total; i += block) {
    const m = Math.min(block, total - i);
    gen.generate(m, params, faults, { vib: vib.subarray(i, i + m), cur: cur.subarray(i, i + m) });
  }
  const src = channel === "cur" ? cur : vib;
  return {
    kind: "motor",
    channel,
    unit: channel === "cur" ? "A" : "g",
    fs,
    x: Float64Array.from(src.subarray(pre)),
    pre: Float64Array.from(src.subarray(0, pre)),
    rpm: gen.rpm,
    frot: gen.frot,
  };
}

/**
 * Clean educational signal:  x(t) = A1·sin(2πf1t) + A2·sin(2πf2t) + A3·sin(2πf3t) + noise
 * (default: a 25 Hz "1×" tone with weaker 2× and 3× harmonics).
 */
export function testSignal({ fs, n, pre = 0, f1 = 25, harmonics = true, noise = 0, seed = 5 }) {
  const rng = createRng(seed);
  const total = pre + n;
  const x = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / fs;
    let v = Math.sin(2 * Math.PI * f1 * t);
    if (harmonics) v += 0.5 * Math.sin(2 * Math.PI * 2 * f1 * t + 0.3) + 0.25 * Math.sin(2 * Math.PI * 3 * f1 * t + 1.1);
    if (noise > 0) v += noise * rng.gaussian();
    x[i] = v;
  }
  return { kind: "test", channel: "test", unit: "", fs, x: x.subarray(pre), pre: x.subarray(0, pre), rpm: f1 * 60, frot: f1 };
}

/**
 * One entry point for the lab modules.
 * source: "vib" | "cur" (motor, from the simulator's state) | "test" (clean sinusoids + optional noise)
 */
export function labSignal(source, { params, faults, fs, n, pre = 0, noise = 0, seed }) {
  if (source === "test") return testSignal({ fs, n, pre, noise, ...(seed != null && { seed }) });
  return motorSignal({ params, faults, fs, n, pre, channel: source, ...(seed != null && { seed }) });
}

/** Warm the filter up on `pre`, return only the analysed segment (start-up transient discarded). */
export function withWarmup(sig, run) {
  const full = new Float64Array(sig.pre.length + sig.x.length);
  full.set(sig.pre);
  full.set(sig.x, sig.pre.length);
  return run(full).subarray(sig.pre.length);
}
