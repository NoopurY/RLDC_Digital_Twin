// Procedural motor audio (Web Audio API), driven by the live twin state.
//
//   commutator whine  ← N_seg × f_rot, level ∝ armature current
//   rotational hum    ← 2 × f_rot
//   fan / air noise   ← band-passed noise, centre & level rise with speed
//   imbalance         ← once-per-revolution amplitude throb (LFO at f_rot)
//   misalignment      ← 2× growl
//   bearing           ← ringing impacts repeating at BPFO
//   electrical        ← whine modulated at f_rot + distortion
//   looseness         ← rattle impacts once per revolution + ½× throb
//   overload          ← louder, distorted whine (current ↑)
// All parameters glide (setTargetAtTime) so transitions are smooth.

import { engine } from "./twinEngine.js";
import { MOTOR, bearingOrders } from "../simulation/motorModel.js";

const ORD = bearingOrders();
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function noiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    d[i] = (s / 0x7fffffff) * 2 - 1;
  }
  return b;
}

/** 1-second loop of `count` decaying rings; playbackRate rescales the repetition rate. */
function impactBuffer(ctx, count, ringHz, decayS, seed = 7) {
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, sr, sr);
  const d = b.getChannelData(0);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < count; k++) {
    const t0 = Math.floor(((k + (rnd() - 0.5) * 0.06) / count) * sr);
    const amp = 0.6 + 0.4 * rnd();
    const n = Math.floor(decayS * 7 * sr);
    for (let i = 0; i < n; i++) {
      const idx = (t0 + i + sr) % sr;
      const t = i / sr;
      d[idx] += amp * Math.exp(-t / decayS) * Math.sin(2 * Math.PI * ringHz * t);
    }
  }
  return b;
}

function distortionCurve(amount = 30) {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return c;
}

class MotorSound {
  enabled = false;
  volume = 0.7;
  listeners = new Set();

  _build() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    // Body bus with an amplitude LFO (imbalance throb / looseness ½× throb).
    const body = ctx.createGain();
    body.gain.value = 1;
    body.connect(master);
    const throb = ctx.createOscillator();
    throb.type = "sine";
    const throbDepth = ctx.createGain();
    throbDepth.gain.value = 0;
    throb.connect(throbDepth).connect(body.gain);
    throb.start();
    this.body = body;
    this.throb = throb;
    this.throbDepth = throbDepth;

    // Commutator whine: sawtooth → low-pass, with AM (electrical) and a distortion send.
    const whine = ctx.createOscillator();
    whine.type = "sawtooth";
    const whineLP = ctx.createBiquadFilter();
    whineLP.type = "lowpass";
    whineLP.frequency.value = 1400;
    const whineG = ctx.createGain();
    whineG.gain.value = 0;
    const am = ctx.createOscillator();
    am.type = "sine";
    const amDepth = ctx.createGain();
    amDepth.gain.value = 0;
    am.connect(amDepth).connect(whineG.gain);
    am.start();
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortionCurve(40);
    const distG = ctx.createGain();
    distG.gain.value = 0;
    whine.connect(whineLP);
    whineLP.connect(whineG).connect(body);
    whineLP.connect(shaper).connect(distG).connect(body);
    whine.start();
    Object.assign(this, { whine, whineLP, whineG, am, amDepth, distG });

    // Rotational hum (2×) and misalignment growl (2× square, low-passed).
    const hum = ctx.createOscillator();
    hum.type = "triangle";
    const humG = ctx.createGain();
    humG.gain.value = 0;
    hum.connect(humG).connect(body);
    hum.start();
    const growl = ctx.createOscillator();
    growl.type = "square";
    const growlLP = ctx.createBiquadFilter();
    growlLP.type = "lowpass";
    growlLP.frequency.value = 380;
    const growlG = ctx.createGain();
    growlG.gain.value = 0;
    growl.connect(growlLP).connect(growlG).connect(body);
    growl.start();
    Object.assign(this, { hum, humG, growl, growlG });

    // Fan / windage noise.
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx);
    air.loop = true;
    const airBP = ctx.createBiquadFilter();
    airBP.type = "bandpass";
    airBP.Q.value = 0.6;
    const airG = ctx.createGain();
    airG.gain.value = 0;
    air.connect(airBP).connect(airG).connect(body);
    air.start();
    Object.assign(this, { airBP, airG });

    // Bearing impacts (100 rings / s base, rescaled to BPFO) and looseness rattle (20 / s base).
    const brg = ctx.createBufferSource();
    brg.buffer = impactBuffer(ctx, 100, 3200, 0.0012, 3);
    brg.loop = true;
    const brgG = ctx.createGain();
    brgG.gain.value = 0;
    brg.connect(brgG).connect(master);
    brg.start();
    const rattle = ctx.createBufferSource();
    rattle.buffer = impactBuffer(ctx, 20, 650, 0.004, 9);
    rattle.loop = true;
    const rattleG = ctx.createGain();
    rattleG.gain.value = 0;
    rattle.connect(rattleG).connect(master);
    rattle.start();
    Object.assign(this, { brg, brgG, rattle, rattleG });
  }

  async setEnabled(on) {
    this.enabled = on;
    try {
      localStorage.setItem("rldc-sound", on ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (on) {
      if (!this.ctx) this._build();
      if (this.ctx.state === "suspended") await this.ctx.resume();
      clearInterval(this._timer);
      this._timer = setInterval(() => this.update(), 50);
      this.update();
    } else if (this.ctx) {
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      clearInterval(this._timer);
      setTimeout(() => !this.enabled && this.ctx?.suspend(), 400);
    }
    this.listeners.forEach((l) => l());
  }

  setVolume(v) {
    this.volume = v;
    this.update();
    this.listeners.forEach((l) => l());
  }

  update() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const glide = (param, v, tc = 0.08) => param.setTargetAtTime(v, now, tc);
    const running = engine.running;
    const rpm = running ? engine.liveRpm : 0;
    const frot = Math.max(0.01, rpm / 60);
    const sp = clamp01(rpm / 1500);
    const f = engine.external ? {} : engine.faults;
    const op = engine.latest?.op;
    const iPu = op ? op.current / MOTOR.ratedCurrent : 0.3;
    const on = rpm > 20 ? 1 : 0;

    glide(this.master.gain, on * this.volume * 0.55, 0.15);

    // whine
    glide(this.whine.frequency, MOTOR.commutatorSegments * frot);
    glide(this.whineLP.frequency, 900 + 1400 * sp);
    const whineLevel = 0.05 * (0.35 + iPu) * Math.min(1, rpm / 600);
    glide(this.whineG.gain, whineLevel);
    glide(this.am.frequency, frot);
    glide(this.amDepth.gain, whineLevel * 0.9 * (f.electrical ?? 0));
    glide(this.distG.gain, 0.03 * clamp01((f.electrical ?? 0) * 1.2 + Math.max(0, iPu - 1) * 1.5));

    // hum + misalignment growl
    glide(this.hum.frequency, 2 * frot);
    glide(this.humG.gain, 0.08 * Math.min(1, rpm / 400));
    glide(this.growl.frequency, 2 * frot);
    glide(this.growlG.gain, 0.06 * (f.misalignment ?? 0));

    // air
    glide(this.airBP.frequency, 250 + rpm * 0.55);
    glide(this.airG.gain, 0.09 * Math.min(1.6, (rpm / 1500) ** 2));

    // imbalance throb at 1×, looseness throb at ½× (whichever dominates)
    const imb = f.imbalance ?? 0;
    const loose = f.looseness ?? 0;
    glide(this.throb.frequency, loose > imb ? frot / 2 : frot);
    glide(this.throbDepth.gain, 0.55 * Math.max(imb, loose));

    // bearing impacts at BPFO, looseness rattle at 1×
    glide(this.brg.playbackRate, Math.max(0.05, (ORD.bpfo * frot) / 100), 0.1);
    glide(this.brgG.gain, on * 0.22 * (f.bearing ?? 0));
    glide(this.rattle.playbackRate, Math.max(0.05, frot / 20), 0.1);
    glide(this.rattleG.gain, on * 0.2 * loose);
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

const g = typeof window !== "undefined" ? window : globalThis;
export const motorSound = g.__motorSound ?? (g.__motorSound = new MotorSound());
