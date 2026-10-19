// Engine verification: runs every fault at several severities through the full
// generator → DSP → diagnosis → health chain and prints the results.
// Usage: npm run verify

import { runHeadless } from "../lib/simulation/headless.js";
import { FAULT_TYPES } from "../lib/simulation/motorModel.js";
import { designFilter, frequencyResponse } from "../lib/dsp/filters.js";
import { amplitudeSpectrum } from "../lib/dsp/spectrum.js";
import { applyFilter } from "../lib/dsp/filters.js";
import { dft } from "../lib/dsp/dft.js";
import { fft } from "../lib/dsp/fft.js";
import { welchPSD } from "../lib/dsp/psd.js";

const fmt = (v, d = 3) => (typeof v === "number" ? v.toFixed(d) : String(v));
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log(`   ✗ ${msg}`);
  }
};

// 1. FFT amplitude calibration: a 1 g sine at 50 Hz must read ≈ 1.0 at 50 Hz.
{
  const fs = 2048;
  const n = 2048;
  const x = new Float64Array(n).map((_, i) => Math.sin((2 * Math.PI * 50 * i) / fs));
  const s = amplitudeSpectrum(x, fs);
  const k = Math.round(50 / s.df);
  console.log(`FFT calibration: |X(50 Hz)| = ${fmt(s.mag[k])} (expected 1.000)`);
  check(Math.abs(s.mag[k] - 1) < 0.02, "FFT amplitude calibration");
}

// 2. Butterworth response: −3 dB at cut-off.
{
  const sos = designFilter({ type: "lowpass", fs: 2048, cutoff: 200, order: 4 });
  const h = frequencyResponse(sos, 2048, [10, 200, 400]);
  console.log(`LP-4 @200 Hz: |H| = ${[...h].map((v) => fmt(20 * Math.log10(v), 1) + " dB").join(", ")} at 10/200/400 Hz`);
  check(Math.abs(20 * Math.log10(h[1]) + 3.01) < 0.1, "Butterworth −3 dB point");
}

// 2b. Chebyshev-I: ripple ≤ 1 dB in the passband, −1 dB at cut-off; FIR: −6 dB at cut-off.
{
  const ch = designFilter({ family: "chebyshev", type: "lowpass", fs: 2048, cutoff: 200, order: 4, ripple: 1 });
  const fr = Array.from({ length: 50 }, (_, i) => (i / 49) * 195);
  const hp = frequencyResponse(ch, 2048, fr).map((v) => 20 * Math.log10(v));
  const hc = 20 * Math.log10(frequencyResponse(ch, 2048, [200])[0]);
  console.log(`Cheby-I 4 @200 Hz: passband ${fmt(Math.min(...hp), 2)}…${fmt(Math.max(...hp), 2)} dB, ${fmt(hc, 2)} dB at cut-off`);
  check(Math.min(...hp) > -1.05 && Math.max(...hp) < 0.05 && Math.abs(hc + 1) < 0.1, "Chebyshev ripple");
  const fir = designFilter({ family: "fir", type: "lowpass", fs: 2048, cutoff: 200, taps: 101 });
  const hf = frequencyResponse(fir, 2048, [20, 200, 400]).map((v) => 20 * Math.log10(v));
  console.log(`FIR-101 LP @200 Hz: ${hf.map((d) => fmt(d, 1)).join(" / ")} dB at 20/200/400 Hz`);
  check(Math.abs(hf[1] + 6.02) < 0.5 && hf[2] < -40, "FIR windowed-sinc response");
  // filtering really removes a 600 Hz tone
  const x = new Float64Array(4096).map((_, i) => Math.sin((2 * Math.PI * 25 * i) / 2048) + Math.sin((2 * Math.PI * 600 * i) / 2048));
  const y = applyFilter(fir, x).subarray(512);
  const s = amplitudeSpectrum(y, 2048, { n: 2048 });
  console.log(`FIR applied: 25 Hz ${fmt(s.mag[25])}, 600 Hz ${fmt(s.mag[600], 4)}`);
  check(s.mag[25] > 0.95 && s.mag[600] < 0.01, "FIR attenuates stop-band tone");
}

// 2c. DFT ≡ FFT, and Welch PSD integrates to the signal variance (Parseval).
{
  const x = Float64Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.9));
  const d = dft(x);
  const re = Float64Array.from(x);
  const im = new Float64Array(256);
  fft(re, im);
  let err = 0;
  for (let k = 0; k < 256; k++) err = Math.max(err, Math.hypot(re[k] - d.re[k], im[k] - d.im[k]));
  console.log(`DFT vs FFT max |ΔX| = ${err.toExponential(2)}`);
  check(err < 1e-9, "DFT equals FFT");
  const n = Float64Array.from({ length: 8192 }, (_, i) => Math.sin(i * 0.9) * 2);
  const { psd, df } = welchPSD(n, 2048, 256);
  const pw = psd.reduce((a, b) => a + b, 0) * df;
  console.log(`Welch PSD power ${fmt(pw)} (expected 2.000)`);
  check(Math.abs(pw - 2) < 0.1, "PSD Parseval");
}

// 3. Determinism
{
  const a = runHeadless({ params: { rpm: 1500, load: 30 }, faults: { bearing: 0.4 }, seed: 9 });
  const b = runHeadless({ params: { rpm: 1500, load: 30 }, faults: { bearing: 0.4 }, seed: 9 });
  console.log(`Determinism: rms ${a.features.rms} === ${b.features.rms}`);
  check(a.features.rms === b.features.rms, "same seed → identical features");
}

// 4. Fault sweep
const base = { rpm: 1500, load: 30, noise: 8, age: 3.2 };
const header = "fault        sev  | label          conf  sev       health | rms    kurt  a1     a2     a05    bpfoSNR sideband I_pu  T";
console.log("\n" + header + "\n" + "-".repeat(header.length));
for (const fault of ["none", ...FAULT_TYPES]) {
  for (const sev of fault === "none" ? [0] : [0.05, 0.2, 0.5, 0.8]) {
    const faults = fault === "none" ? {} : { [fault]: sev };
    const r = runHeadless({ params: base, faults, seed: 3 });
    const f = r.features;
    const d = r.diagnosis;
    console.log(
      `${fault.padEnd(12)} ${fmt(sev, 2)} | ${d.label.padEnd(14)} ${fmt(d.confidence, 0).padStart(4)}  ${d.severity.padEnd(9)} ${fmt(r.health.score, 0).padStart(5)} | ` +
        `${fmt(f.rms)}  ${fmt(f.kurtosis, 2)}  ${fmt(f.a1)}  ${fmt(f.a2)}  ${fmt(f.a05)}  ${fmt(f.bpfoSNR, 1).padStart(6)}  ${fmt(f.sidebandRatio, 2).padStart(6)}  ${fmt(f.currentPU, 2)}  ${fmt(f.temperature, 0)}`
    );
    if (fault === "none") check(d.label === "healthy", "healthy motor classified healthy");
    else if (sev >= 0.2) check(d.label === fault || d.active?.includes(fault), `${fault} @ ${sev} detected (got ${d.label})`);
  }
}

// 5. Combined
{
  const r = runHeadless({ params: base, faults: { imbalance: 0.35, bearing: 0.4 }, seed: 5 });
  console.log(`\nCombined imbalance 35% + bearing 40% → ${r.diagnosis.label} (${fmt(r.diagnosis.confidence, 0)}%), health ${fmt(r.health.score, 0)}`);
  check(r.diagnosis.label === "combined", "combined fault detected");
}

// 6. Operating-point sweep for false positives
for (const rpm of [800, 1500, 2500])
  for (const load of [10, 60, 100]) {
    const r = runHeadless({ params: { ...base, rpm, load }, seed: 17 });
    if (r.diagnosis.label !== "healthy") {
      console.log(`   false positive @ ${rpm} rpm / ${load}% → ${r.diagnosis.label}`);
      failures++;
    }
  }

// 7. Overload physics chain
{
  const lo = runHeadless({ params: { ...base, load: 40 }, seed: 1 });
  const hi = runHeadless({ params: { ...base, load: 80 }, seed: 1 });
  console.log(
    `\nLoad 40%→80%: rpm ${fmt(lo.telemetry.rpm, 0)}→${fmt(hi.telemetry.rpm, 0)}, I ${fmt(lo.telemetry.current, 2)}→${fmt(hi.telemetry.current, 2)} A, T ${fmt(lo.telemetry.temperature, 1)}→${fmt(hi.telemetry.temperature, 1)} °C, rms ${fmt(lo.features.rms)}→${fmt(hi.features.rms)}`
  );
  check(hi.telemetry.rpm < lo.telemetry.rpm && hi.telemetry.current > lo.telemetry.current && hi.telemetry.temperature > lo.telemetry.temperature, "load→current→temperature→rpm chain");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
