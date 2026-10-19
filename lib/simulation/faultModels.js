// Physics-inspired fault signal models.
//
// Each generator returns its contribution for ONE sample:
//   { vib: acceleration in g, cur: armature current in A }
// The sample context `c` carries the rotor angle θ (continuous, wrapped to 4π so
// sub-harmonics stay phase-continuous), shaft frequency, the operating point and
// a per-fault persistent state object.  Severities are 0…1.

import { MOTOR, bearingOrders } from "./motorModel.js";

const TWO_PI = 2 * Math.PI;
const ORDERS = bearingOrders();

/** Centrifugal force scales with ω²; normalise to 25 Hz (1500 rpm). */
const speedSq = (frot) => (frot / 25) ** 2;
const speedLin = (frot) => 0.35 + 0.65 * (frot / 25);

/**
 * Healthy machine: residual unbalance at 1×, a weak 2× from stiffness
 * asymmetry, commutator torque ripple, and the DC armature current with its
 * commutation ripple at N_seg × f_rot.
 */
export function generateHealthySignal(c) {
  const { theta, frot, op, params } = c;
  const residual = 0.03 * (1 + 0.06 * params.age) * (0.6 + 0.8 * (params.baseVibration / 100));
  const iPu = op.current / MOTOR.ratedCurrent;
  const vib =
    residual * speedSq(frot) * Math.sin(theta) +
    0.012 * speedLin(frot) * Math.sin(2 * theta + 0.4) +
    0.01 * iPu * Math.sin(MOTOR.commutatorSegments * theta);
  const ripple =
    0.03 * op.current * Math.sin(MOTOR.commutatorSegments * theta) +
    0.008 * op.current * Math.sin(2 * MOTOR.commutatorSegments * theta + 0.6);
  return { vib, cur: op.current + ripple };
}

/**
 * Rotor imbalance: x(t) = s·A·(ω/ω₀)²·sin(2πf_rot·t + φ).
 * A dominant, purely synchronous 1× component whose amplitude grows with ω².
 * It also produces a small once-per-revolution torque modulation in current.
 */
export function generateImbalanceSignal(c, s) {
  const { theta, frot, op } = c;
  return {
    vib: s * 0.6 * speedSq(frot) * Math.sin(theta + 0.7),
    cur: s * 0.012 * op.current * Math.sin(theta + 0.7),
  };
}

/**
 * Shaft misalignment: coupling forces generate strong 2× (and 3×) orders.
 * The 2× component grows linearly with severity, 3× grows super-linearly.
 */
export function generateMisalignmentSignal(c, s) {
  const { theta, frot } = c;
  const k = speedLin(frot);
  return {
    vib:
      k *
      (s * 0.12 * Math.sin(theta + 1.1) +
        s * 0.42 * Math.sin(2 * theta + 0.3) +
        s ** 1.5 * 0.2 * Math.sin(3 * theta + 2.0) +
        s ** 2 * 0.07 * Math.sin(4 * theta + 0.9)),
    cur: 0,
  };
}

/**
 * Outer-race bearing defect: every time a rolling element passes the defect an
 * impact excites a structural resonance → exponentially-decaying ringing.
 * Impacts repeat at BPFO = (N_b/2)(1 − d/D·cosβ)·f_rot with ±1.5 % slip jitter.
 * Result: impulsive signal (high kurtosis & crest factor), energy at the
 * resonance band, and BPFO lines in the envelope spectrum.
 */
export function generateBearingFaultSignal(c, s) {
  const { t, frot, fs, rng, state, op } = c;
  if (frot < 0.5) return { vib: 0, cur: 0 };
  const fres = Math.min(1800, 0.3 * fs);
  const period = 1 / (ORDERS.bpfo * frot);
  if (state.nextImpact === undefined || state.nextImpact < t - 1) state.nextImpact = t + period;
  if (t >= state.nextImpact) {
    state.lastImpact = state.nextImpact;
    state.impactAmp = s * 2.4 * speedLin(frot) * (0.8 + 0.4 * rng.next());
    state.nextImpact += period * (1 + 0.015 * rng.gaussian());
  }
  let vib = 0;
  if (state.lastImpact !== undefined) {
    const dt = t - state.lastImpact;
    const tau = 0.0022;
    if (dt < 8 * tau) vib = state.impactAmp * Math.exp(-dt / tau) * Math.sin(TWO_PI * fres * dt);
  }
  // Broadband wear noise and a small friction-torque fluctuation in current.
  vib += s * 0.04 * rng.gaussian();
  return { vib, cur: s * 0.02 * op.current * rng.gaussian() };
}

/**
 * Electrical fault (shorted armature coil / damaged commutator bar):
 *  - commutation ripple amplitude modulated once per revolution → sidebands N·f_rot ± f_rot
 *  - a current notch each revolution when the faulty coil commutates → asymmetry & low-order harmonics
 *  - higher commutation harmonics → harmonic distortion
 *  - torque pulsation leaks into vibration at 1× and N×.
 */
export function generateElectricalFaultSignal(c, s) {
  const { theta, op } = c;
  const N = MOTOR.commutatorSegments;
  const I = op.current;
  const thetaRev = theta % TWO_PI;
  const d = thetaRev - Math.PI;
  const notch = Math.exp(-(d * d) / (2 * 0.16 * 0.16));
  const cur =
    s * 0.9 * Math.cos(theta) * 0.03 * I * Math.sin(N * theta) +
    -s * 0.28 * I * notch +
    s * 0.06 * I * Math.sin(2 * N * theta + 1.3) +
    s * 0.04 * I * Math.sin(3 * N * theta + 0.2);
  const iPu = I / MOTOR.ratedCurrent;
  const vib = iPu * (s * 0.09 * Math.sin(theta + 1.2) + s * 0.07 * Math.sin(N * theta + 0.5));
  return { vib, cur };
}

/**
 * Overload: the dominant effects (current ↑, temperature ↑, speed ↓) come from the
 * motor model.  Here the higher torque increases torque-ripple and structural
 * response (1×, 2× and commutation order scale with per-unit current).
 */
export function generateOverloadSignal(c, s) {
  const { theta, frot, op } = c;
  const excess = Math.max(0, op.current / MOTOR.ratedCurrent - 0.8);
  const k = s * (0.4 + excess);
  return {
    vib:
      k *
      speedLin(frot) *
      (0.022 * Math.sin(theta + 0.2) + 0.03 * Math.sin(2 * theta + 1.4) + 0.04 * Math.sin(MOTOR.commutatorSegments * theta)),
    cur: 0,
  };
}

/**
 * Mechanical looseness (soft foot / loose mounting bolts): the support stiffness is
 * non-linear, so the 1× response is clipped on one side → a comb of harmonics
 * (1×…6×), a 0.5× sub-harmonic, and rattling impacts once per revolution.
 */
export function generateLooseMountSignal(c, s) {
  const { theta, frot, rng, state, fs } = c;
  const k = speedLin(frot);
  const x = Math.sin(theta);
  const clipped = x > -0.25 ? x : -0.25 + 0.15 * (x + 0.25); // one-sided stiffening
  let vib = s * 0.45 * k * clipped + s * 0.16 * k * Math.sin(theta / 2 + 0.3);
  // Rattle: one impact per revolution near the peak of travel.
  const rev = Math.floor(theta / TWO_PI);
  if (state.lastRev !== rev && (theta % TWO_PI) > 1.4) {
    state.lastRev = rev;
    state.rattleT = c.t;
    state.rattleAmp = s * 0.6 * k * (0.6 + 0.8 * rng.next());
  }
  if (state.rattleT !== undefined) {
    const dt = c.t - state.rattleT;
    if (dt < 0.01) vib += state.rattleAmp * Math.exp(-dt / 0.0015) * Math.sin(2 * Math.PI * Math.min(380, 0.18 * fs) * dt);
  }
  return { vib, cur: 0 };
}

export const FAULT_GENERATORS = {
  imbalance: generateImbalanceSignal,
  bearing: generateBearingFaultSignal,
  misalignment: generateMisalignmentSignal,
  electrical: generateElectricalFaultSignal,
  overload: generateOverloadSignal,
  looseness: generateLooseMountSignal,
};

export const FAULT_INFO = {
  imbalance: {
    label: "Rotor Imbalance",
    short: "IMB",
    description: "Simulates uneven mass distribution on the rotating assembly.",
    signature: "Dominant 1× shaft-frequency peak growing with ω²",
  },
  bearing: {
    label: "Bearing Fault",
    short: "BRG",
    description: "Outer-race spall: rolling elements strike the defect and ring the structure.",
    signature: "Periodic impulses at BPFO, high kurtosis, resonance-band energy",
  },
  misalignment: {
    label: "Shaft Misalignment",
    short: "MIS",
    description: "Angular/parallel offset between motor shaft and driven load.",
    signature: "Strong 2× and 3× orders relative to 1×",
  },
  electrical: {
    label: "Electrical Fault",
    short: "ELE",
    description: "Shorted armature coil / damaged commutator bar distorts armature current.",
    signature: "Current ripple sidebands, per-revolution notch, harmonic distortion",
  },
  overload: {
    label: "Overload",
    short: "OVL",
    description: "Shaft load beyond rating: more current, heat and speed droop.",
    signature: "Current > rated, rising temperature, speed deviation",
  },
  looseness: {
    label: "Loose Mounting",
    short: "LSE",
    description: "Loose hold-down bolts / soft foot produce non-linear support response.",
    signature: "Harmonic comb 1×…6×, 0.5× sub-harmonic, rattling impacts",
  },
};
