// Professor demo: a scripted ~90 s presentation driven by simulation time.
// Every effect shown is produced by the real engine — the script only moves
// the same controls a user would.  `focus` names the simulator zone to highlight.

import { engine } from "./twinEngine.js";
import { EMPTY_FAULTS } from "../simulation/motorModel.js";

export const DEMO_STEPS = [
  {
    at: 0,
    title: "Stage 1 · Healthy motor",
    caption: "1500 rpm, 30 % load, no faults. Smooth rotation and low vibration — the twin builds its healthy reference.",
    focus: "motor",
    run: (e) => {
      e.setParams({ rpm: 1500, load: 30, voltage: 230, noise: 8, age: 3.2, baseVibration: 20, ambientTemp: 25 });
      e.setDsp({ filter: { enabled: false } });
      e.setFaults(EMPTY_FAULTS, "Demo: healthy start", { instant: true });
      e.setMotorOn(true);
    },
  },
  {
    at: 9,
    title: "Stage 2 · Inject 25 % rotor imbalance",
    caption: "An uneven mass on the rotor adds a once-per-revolution centrifugal force F = m·e·ω².",
    focus: "faults",
    run: (e) => e.setFault("imbalance", 0.25),
  },
  {
    at: 16,
    title: "Stage 3 · The waveform changes",
    caption: "The vibration waveform becomes a dominant sinusoid at the shaft frequency.",
    focus: "time",
  },
  {
    at: 24,
    title: "Stage 4 · The FFT peak grows",
    caption: "f_rot = RPM / 60 ≈ 25 Hz. The 1× peak rises far above the healthy reference.",
    focus: "fft",
  },
  {
    at: 32,
    title: "Stage 5 · Diagnosis",
    caption: "The rule engine compares extracted features with the healthy reference and shows why it concluded rotor imbalance.",
    focus: "diagnosis",
  },
  {
    at: 41,
    title: "Stage 6 · Increase severity to 70 %",
    caption: "Same fault, larger unbalance mass — every downstream quantity follows.",
    focus: "faults",
    run: (e) => e.setFault("imbalance", 0.7),
  },
  {
    at: 49,
    title: "Stage 7 · Health drops",
    caption: "The vibration contribution to the health score grows with RMS relative to the reference.",
    focus: "health",
  },
  {
    at: 57,
    title: "Stage 8 · Degradation simulation",
    caption: "A bearing defect now develops from 5 % to 60 % over 20 s. Watch impacts appear in the spectrogram.",
    focus: "spectrogram",
    run: (e) => e.startEvolution({ fault: "bearing", from: 0.05, to: 0.6, duration: 20 }),
  },
  {
    at: 79,
    title: "Stage 9 · Maintenance recommended",
    caption: "Combined imbalance and bearing damage — the twin recommends maintenance. No motor was damaged to get here.",
    focus: "diagnosis",
  },
  { at: 90, end: true },
];

export function startDemo() {
  engine.reset(7);
  engine.setRunning(true);
  engine.demo = { active: true, step: -1, t0: engine.simTime, title: "", caption: "", focus: null, progress: 0, total: DEMO_STEPS.at(-1).at };
  engine._demoTick = demoTick;
  demoTick();
}

export function stopDemo() {
  engine.demo = null;
  engine._demoTick = null;
  engine._emit();
}

function demoTick() {
  const d = engine.demo;
  if (!d?.active) return;
  const t = engine.simTime - d.t0;
  d.elapsed = t;
  d.progress = Math.min(1, t / d.total);
  let changed = false;
  while (d.step + 1 < DEMO_STEPS.length && t >= DEMO_STEPS[d.step + 1].at) {
    d.step++;
    const s = DEMO_STEPS[d.step];
    if (s.end) {
      d.active = false;
      d.finished = true;
      d.title = "Demo complete";
      d.caption = "Open DSP Analysis, Experiments or Compare to go deeper.";
      d.focus = null;
      changed = true;
      break;
    }
    s.run?.(engine);
    d.title = s.title;
    d.caption = s.caption;
    d.focus = s.focus;
    changed = true;
  }
  if (changed) engine._emit();
}
