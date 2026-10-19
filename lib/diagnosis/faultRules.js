// Transparent rule-based diagnosis.
//
// Every rule compares the measured features with the twin's HEALTHY REFERENCE
// at the same operating point (same speed, load, voltage, noise, age).  Each
// rule produces a score in [0, 1], a magnitude (for severity grading) and a
// list of human-readable evidence lines so the conclusion is explainable.

const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const pct = (r) => `${r >= 1 ? "+" : ""}${((r - 1) * 100).toFixed(0)}%`;
const safeRatio = (a, b, floor = 1e-4) => (a + floor) / (b + floor);

export function evaluateRules(f, base, ctx = {}) {
  const out = {};
  const rmsR = safeRatio(f.rms, base.rms);
  const df = f.fs / f.n;
  const isNearShaft = Math.abs(f.dominantFrequency - f.shaftFrequency) < Math.max(2 * df, 1.5);

  // ── Rotor imbalance: synchronous 1× growth, low harmonic content ─────────
  {
    const r1 = safeRatio(f.a1, base.a1, 0.004);
    const shape = 1 - 0.75 * sig(4 * (f.harmonicRatio - 1.0));
    const loose = 1 - 0.7 * sig(10 * (f.a05 / Math.max(f.a1, 1e-4) - 0.25));
    const score = sig(3 * (Math.log2(r1) - 1.5)) * shape * loose;
    out.imbalance = {
      score,
      magnitude: clamp01((r1 - 1) / 20),
      evidence: [
        { ok: rmsR > 1.3, text: `RMS vibration ${pct(rmsR)} vs healthy reference` },
        { ok: isNearShaft, text: `Dominant peak at ${f.dominantFrequency.toFixed(1)} Hz ${isNearShaft ? "=" : "≠"} 1× shaft (${f.shaftFrequency.toFixed(1)} Hz)` },
        { ok: r1 > 2.5, text: `1× amplitude ${(f.a1 * 1000).toFixed(0)} mg (${r1.toFixed(1)}× reference)` },
        { ok: f.harmonicRatio < 0.8, text: `Harmonic ratio (2×+3×)/1× = ${f.harmonicRatio.toFixed(2)} → synchronous pattern` },
      ],
    };
  }

  // ── Misalignment: strong 2× (and 3×) relative to 1× ──────────────────────
  {
    const r2 = safeRatio(f.a2, base.a2, 0.004);
    const rel = f.a2 / Math.max(f.a1, 1e-4);
    const notLoose = 1 - 0.6 * sig(10 * (f.a05 / Math.max(f.a1, 1e-4) - 0.3));
    const score = sig(3 * (Math.log2(r2) - 1.6)) * sig(5 * (rel - 0.45)) * notLoose;
    out.misalignment = {
      score,
      magnitude: clamp01((f.a2 - base.a2) / 0.35),
      evidence: [
        { ok: rel > 0.5, text: `2× / 1× = ${rel.toFixed(2)} (misalignment typically > 0.5)` },
        { ok: r2 > 3, text: `2× amplitude ${(f.a2 * 1000).toFixed(0)} mg (${r2.toFixed(1)}× reference)` },
        { ok: f.a3 > 1.5 * (base.a3 + 0.003), text: `3× order present: ${(f.a3 * 1000).toFixed(0)} mg` },
        { ok: f.harmonicRatio > base.harmonicRatio + 0.5, text: `Harmonic ratio ${f.harmonicRatio.toFixed(2)} (ref ${base.harmonicRatio.toFixed(2)})` },
      ],
    };
  }

  // ── Bearing: impulsiveness + envelope BPFO + resonance-band energy ───────
  {
    const dk = f.kurtosis - Math.max(base.kurtosis, 2.5);
    const eh = f.bandEnergyHigh - base.bandEnergyHigh;
    const snr = f.bpfoSNR;
    // Noisy-OR: envelope (demodulated BPFO) evidence alone is sufficient, because
    // it still works when strong 1× vibration masks kurtosis and band energy.
    const env = sig(1.2 * (snr - 6));
    const imp = sig(2 * (dk - 1.2));
    const hf = sig(12 * (eh - 0.12));
    const score = clamp01(1 - (1 - 0.75 * env) * (1 - 0.6 * imp) * (1 - 0.4 * hf));
    const scoreAdj = score < 0.25 ? score * 0.6 : score;
    out.bearing = {
      score: scoreAdj,
      magnitude: clamp01(Math.max(dk / 10, (snr - 4) / 120, (rmsR - 1) / 12)),
      evidence: [
        { ok: f.kurtosis > 4, text: `Kurtosis ${f.kurtosis.toFixed(2)} (ref ${base.kurtosis.toFixed(2)}; Gaussian = 3)` },
        { ok: f.crestFactor > Math.max(4.5, base.crestFactor * 1.3), text: `Crest factor ${f.crestFactor.toFixed(2)} → impulsive content` },
        { ok: snr > 5, text: `Envelope spectrum: BPFO line ${snr.toFixed(1)}× above envelope floor` },
        { ok: eh > 0.1, text: `High-band energy ${(f.bandEnergyHigh * 100).toFixed(0)}% (ref ${(base.bandEnergyHigh * 100).toFixed(0)}%)` },
      ],
    };
  }

  // ── Electrical: current-signature distortion ─────────────────────────────
  {
    const sb = (f.sidebandRatio ?? 0) - (base.sidebandRatio ?? 0);
    const thd = (f.currentTHD ?? 0) - (base.currentTHD ?? 0);
    const c1 = safeRatio(f.current1x ?? 0, base.current1x ?? 0, 0.001);
    const score = clamp01(0.5 * sig(14 * (sb - 0.15)) + 0.3 * sig(10 * (thd - 0.25)) + 0.2 * sig(3 * (Math.log2(c1) - 1.5)));
    out.electrical = {
      score: score < 0.3 ? score * 0.6 : score,
      magnitude: clamp01(sb / 0.9),
      evidence: [
        { ok: sb > 0.12, text: `Commutation sidebands (N·f ± f_rot) ${(f.sidebandRatio ?? 0).toFixed(2)} of carrier (ref ${(base.sidebandRatio ?? 0).toFixed(2)})` },
        { ok: thd > 0.2, text: `Commutation-ripple THD ${(((f.currentTHD ?? 0)) * 100).toFixed(0)}% (ref ${((base.currentTHD ?? 0) * 100).toFixed(0)}%)` },
        { ok: c1 > 3, text: `Once-per-rev current component ${(c1).toFixed(1)}× reference` },
        { ok: Math.abs(f.currentSkew ?? 0) > Math.abs(base.currentSkew ?? 0) + 0.3, text: `Current waveform asymmetry (skew ${(f.currentSkew ?? 0).toFixed(2)})` },
      ],
    };
  }

  // ── Overload: current above rating, thermal rise, speed droop ────────────
  {
    const pu = f.currentPU ?? 0;
    const T = f.temperature ?? 25;
    const droop = ctx.rpmSet > 1 ? (ctx.rpmSet - f.rpm) / ctx.rpmSet : 0;
    const score = clamp01(0.6 * sig(18 * (pu - 1.12)) + 0.25 * sig(0.25 * (T - 80)) + 0.15 * sig(80 * (droop - 0.045)));
    out.overload = {
      score: score < 0.3 ? score * 0.5 : score,
      magnitude: clamp01((pu - 1) / 0.8),
      evidence: [
        { ok: pu > 1.05, text: `Armature current ${(pu * 100).toFixed(0)}% of rated` },
        { ok: T > 75, text: `Winding/housing temperature ${T.toFixed(1)} °C` },
        { ok: droop > 0.04, text: `Speed deviation ${(droop * 100).toFixed(1)}% below set-point` },
        { ok: rmsR > 1.2, text: `Torque-ripple vibration ${pct(rmsR)}` },
      ],
    };
  }

  // ── Looseness: 0.5× sub-harmonic + harmonic comb ─────────────────────────
  {
    const sub = f.a05 / Math.max(f.a1, 1e-4);
    const subR = safeRatio(f.a05, base.a05, 0.003);
    const score = sig(3 * (Math.log2(subR) - 1.6)) * sig(8 * (sub - 0.15)) * (0.8 + 0.2 * clamp01((f.harmonicCount - 2) / 3));
    out.looseness = {
      score,
      magnitude: clamp01((f.a05 - base.a05) / 0.12),
      evidence: [
        { ok: sub > 0.15, text: `0.5× sub-harmonic ${(f.a05 * 1000).toFixed(0)} mg (${(sub * 100).toFixed(0)}% of 1×)` },
        { ok: f.harmonicCount >= 4, text: `Harmonic comb: ${f.harmonicCount} shaft orders above noise floor` },
        { ok: subR > 3, text: `Sub-harmonic ${subR.toFixed(1)}× reference` },
        { ok: f.crestFactor > base.crestFactor * 1.2, text: `Rattle impacts raise crest factor to ${f.crestFactor.toFixed(2)}` },
      ],
    };
  }

  return out;
}

export const SEVERITY_LEVELS = [
  { max: 0.33, label: "MILD" },
  { max: 0.66, label: "MODERATE" },
  { max: 1.01, label: "SEVERE" },
];
export const severityLabel = (m) => SEVERITY_LEVELS.find((l) => m < l.max)?.label ?? "SEVERE";
