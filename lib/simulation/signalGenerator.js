// Signal generation engine: turns the motor state + fault severities into
// sampled sensor channels (accelerometer in g, armature current in A).
//
//   vibration = base rotational signal + Σ fault components + harmonics + noise
//
// The rotor angle is integrated sample-by-sample from the (dynamically
// changing) shaft speed, so every order-related component stays phase-coherent
// when speed changes.  All randomness is seeded → fully reproducible.

import { createRng, createNoiseModel } from "./noiseModel.js";
import { generateHealthySignal, FAULT_GENERATORS } from "./faultModels.js";
import { stepMotorState, createMotorState, rpmOf, FAULT_TYPES, MOTOR } from "./motorModel.js";

const FOUR_PI = 4 * Math.PI;

export class SignalGenerator {
  constructor({ seed = 1, fs = 2048, params, faults, steady = false } = {}) {
    this.seed = seed;
    this.fs = fs;
    this.rng = createRng(seed);
    this.vibNoise = createNoiseModel(createRng(seed ^ 0x9e3779b9));
    this.curNoise = createNoiseModel(createRng(seed ^ 0x85ebca6b));
    this.faultState = Object.fromEntries(FAULT_TYPES.map((f) => [f, {}]));
    this.state = createMotorState(params, faults, { steady });
    this.theta = 0;
    this.t = 0; // simulation time (s)
    this.sampleIndex = 0;
    this.op = null;
  }

  /**
   * Generate n samples. The quasi-static motor state is stepped once per block
   * (blocks are ≤ 50 ms) and shaft speed is linearly interpolated inside it.
   */
  generate(n, params, faults, out) {
    const fs = this.fs;
    const dtBlock = n / fs;
    const omega0 = this.state.omega;
    const op = stepMotorState(this.state, params, faults, dtBlock);
    this.op = op;
    const omega1 = this.state.omega;
    const vib = out?.vib ?? new Float32Array(n);
    const cur = out?.cur ?? new Float32Array(n);
    const c = { theta: 0, frot: 0, t: 0, fs, op, params, rng: this.rng, state: null };

    const noiseSigma = 0.004 + (params.noise / 100) * 0.22 + params.age * 0.0015;
    const curSigma = 0.002 * MOTOR.ratedCurrent + (params.noise / 100) * 0.02 * MOTOR.ratedCurrent;
    const background = (params.baseVibration / 100) * 0.03;
    const active = FAULT_TYPES.filter((f) => faults[f] > 0.0005);

    for (let i = 0; i < n; i++) {
      const omega = omega0 + ((omega1 - omega0) * (i + 0.5)) / n;
      const frot = omega / (2 * Math.PI);
      // Small (±0.15 %) speed jitter from the speed loop.
      this.theta += (omega / fs) * (1 + 0.0015 * Math.sin(this.t * 2.1));
      if (this.theta >= FOUR_PI) this.theta -= FOUR_PI;
      c.theta = this.theta;
      c.frot = frot;
      c.t = this.t;

      const h = generateHealthySignal(c);
      let v = h.vib;
      let a = h.cur;
      for (let k = 0; k < active.length; k++) {
        const f = active[k];
        c.state = this.faultState[f];
        const r = FAULT_GENERATORS[f](c, faults[f]);
        v += r.vib;
        a += r.cur;
      }
      // Background (foundation) vibration: low-frequency structural sway.
      v += background * Math.sin(2 * Math.PI * 7.3 * this.t + 0.2) * (0.6 + 0.4 * Math.sin(0.37 * this.t));
      v += this.vibNoise.sample(noiseSigma);
      a += this.curNoise.sample(curSigma);

      vib[i] = v;
      cur[i] = a;
      this.t += 1 / fs;
      this.sampleIndex++;
    }
    return { vib, cur, op, rpm: rpmOf(this.state.omega), temp: this.state.temp };
  }

  get rpm() {
    return rpmOf(this.state.omega);
  }
  get temp() {
    return this.state.temp;
  }
  get frot() {
    return this.state.omega / (2 * Math.PI);
  }
}
