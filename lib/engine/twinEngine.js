// Live digital-twin engine (browser singleton).
//
// Runs independently of React: a timer produces samples in real time into ring
// buffers, a slower analysis loop runs filter → FFT/STFT → features →
// diagnosis → health, and subscribers receive an immutable snapshot after each
// analysis.  Charts and the 3D twin read buffers directly inside
// requestAnimationFrame, so high-rate data never causes React re-renders.

import { DEFAULT_PARAMS, EMPTY_FAULTS, FAULT_TYPES, MOTOR, rpmOf } from "../simulation/motorModel.js";
import { FAULT_INFO } from "../simulation/faultModels.js";
import { computeBaseline, averageFeatures, downsampleSpectrum } from "../simulation/headless.js";
import { DEFAULT_DSP, processWindow } from "../dsp/pipeline.js";
import { RollingSpectrogram } from "../dsp/stft.js";
import { featureVector } from "../dsp/features.js";
import { RuleClassifier, CLASS_LABELS } from "../diagnosis/classifier.js";
import { computeHealth, healthBand } from "../diagnosis/healthScore.js";
import { estimateTrend } from "../diagnosis/prognosis.js";
import { SimulationSource } from "./sources.js";

const CAP = 1 << 16;
const PAD = 512;
const ANALYSIS_HZ = 8;
const FAULT_SLEW = 0.8; // severity units per simulated second — faults ramp in/out instead of jumping
const BLOCK_S = 0.05;

const clone = (o) => JSON.parse(JSON.stringify(o));

class TwinEngine {
  constructor() {
    this.params = { ...DEFAULT_PARAMS };
    this.faults = { ...EMPTY_FAULTS }; // effective (what the generator uses)
    this.faultTargets = { ...EMPTY_FAULTS }; // requested by the user
    this.dsp = clone(DEFAULT_DSP);
    this.seed = 1;
    this.classifier = RuleClassifier;
    this.listeners = new Set();
    this.running = true; // simulation clock
    this.motorOn = true; // motor power (STOP spins the rotor down through the physics)
    this.started = false;
    this.speed = 1;
    this.sessionId = null;
    this.external = null;
    this.snapshot = null;
    this._timer = null;
    this.reset();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this._last = performance.now();
    this._timer = setInterval(() => this._loop(), 30);
    this._createSession();
  }

  reset(seed = this.seed) {
    this.seed = seed;
    const fs = this.external ? this.external.fs : this.dsp.fs;
    this.source = this.external ?? new SimulationSource({ seed, fs, params: this.params, faults: this.faults });
    this.vib = new Float32Array(CAP);
    this.cur = new Float32Array(CAP);
    this.total = 0;
    this.simTime = 0;
    this._acc = 0;
    this._lastAnalysis = 0;
    this._lastHist = -1;
    this.history = [];
    this._lastStepT = -Infinity;
    this.events = [];
    this.alerts = [];
    this.latest = null;
    this.baseline = null;
    this._baselineKey = null;
    this._healthEma = null;
    this._labelState = { label: null, candidate: null, count: 0 };
    this.evolution = null;
    this.recording = null;
    this.spectrogram = new RollingSpectrogram({ columns: 200, nperseg: this.dsp.stft.nperseg, overlap: this.dsp.stft.overlap });
    this.faults = { ...(this.faultTargets ?? this.faults) };
    this.visual = { theta: 0, lastGen: 0 };
    this._log("system", `Twin reset (seed ${seed}, fs ${fs} Hz)`);
    this._emit(true);
  }

  setRunning(on) {
    this.running = on;
    this._last = performance.now();
    this._emit(true);
  }

  // ── controls ───────────────────────────────────────────────────────────────
  /** Remember when the user made a step change (used to keep step responses out of the trend fit). */
  _markStep() {
    this._lastStepT = this.simTime;
  }

  setMotorOn(on) {
    if (this.motorOn === on) return;
    this._markStep();
    this.motorOn = on;
    this._log("system", on ? "Motor started" : "Motor stopped");
    this._emit(true);
  }

  /** Parameters actually fed to the physics (speed set-point is 0 while the motor is off). */
  get effectiveParams() {
    return this.motorOn ? this.params : { ...this.params, rpm: 0 };
  }

  setParams(patch) {
    this._markStep();
    this.params = { ...this.params, ...patch };
    this._emit(true);
  }

  setFault(type, severity, { log = true } = {}) {
    const prev = this.faultTargets[type];
    const s = Math.max(0, Math.min(1, severity));
    this._markStep();
    this.faultTargets = { ...this.faultTargets, [type]: s };
    if (this.evolution?.fault === type) this.evolution = null;
    if (log && Math.abs(prev - s) > 0.001) {
      this._log(s > 0 ? "fault" : "clear", s > 0 ? `Injected ${FAULT_INFO[type].label} @ ${(s * 100).toFixed(0)}%` : `Cleared ${FAULT_INFO[type].label}`);
    }
    this._emit(true);
  }

  setFaults(faults, message, { instant = false } = {}) {
    this.faultTargets = { ...EMPTY_FAULTS, ...faults };
    this._markStep();
    if (instant) this.faults = { ...this.faultTargets };
    this.evolution = null;
    if (message) this._log("fault", message);
    this._emit(true);
  }

  clearFaults() {
    this.setFaults(EMPTY_FAULTS, "All faults cleared");
  }

  setDsp(patch) {
    const next = { ...this.dsp, ...patch, filter: { ...this.dsp.filter, ...(patch.filter ?? {}) }, stft: { ...this.dsp.stft, ...(patch.stft ?? {}) } };
    const fsChanged = next.fs !== this.dsp.fs;
    const stftChanged = next.stft.nperseg !== this.dsp.stft.nperseg || next.stft.overlap !== this.dsp.stft.overlap;
    this.dsp = next;
    if (fsChanged && !this.external) {
      this._log("system", `Sampling rate → ${next.fs} Hz`);
      this.reset(this.seed);
      return;
    }
    if (stftChanged || fsChanged) this.spectrogram = new RollingSpectrogram({ columns: 200, nperseg: next.stft.nperseg, overlap: next.stft.overlap });
    this._emit(true);
  }

  setClassifier(classifier) {
    this.classifier = classifier ?? RuleClassifier;
    this._log("system", `Classifier → ${this.classifier.name}`);
    this._emit(true);
  }

  startEvolution({ fault, from, to, duration }) {
    this.faults = { ...this.faults, [fault]: from };
    this.faultTargets = { ...this.faultTargets, [fault]: from };
    this.evolution = { fault, from, to, duration, t0: this.simTime, progress: 0 };
    this._log("fault", `Fault evolution: ${FAULT_INFO[fault].label} ${(from * 100).toFixed(0)}% → ${(to * 100).toFixed(0)}% over ${duration}s`);
    this._emit(true);
  }

  stopEvolution() {
    if (!this.evolution) return;
    this._log("system", "Fault evolution stopped");
    this.evolution = null;
    this._emit(true);
  }

  /** Switch between the simulation source and an external (recorded/streamed) source. */
  useExternalSource(source) {
    this.external = source;
    this.inputLabel = source?.name ?? null;
    if (source) this.dsp = { ...this.dsp, fs: source.fs, fftSize: Math.min(this.dsp.fftSize, 2 ** Math.floor(Math.log2(Math.max(256, source.vib?.length ?? 4096)))) };
    this._log("system", source ? `Input → external signal (${source.name ?? "stream"}, ${source.fs} Hz)` : "Input → simulation");
    this.reset(this.seed);
  }

  /** For external inputs: freeze the current features as the healthy reference. */
  captureBaseline() {
    const src = this.latestRaw ?? this.latest;
    if (!src) return;
    this.baseline = { ...src.features };
    this._baselineKey = "captured";
    this._log("system", "Healthy reference captured from current signal");
  }

  // ── recording / experiments ──────────────────────────────────────────────
  startRecording({ name, duration = 10, scenarioId = null, notes = "" }) {
    this.recording = { name, duration, scenarioId, notes, t0: this.simTime, feats: [], trend: [], diag: [] };
    this._log("record", `Recording "${name}" for ${duration}s`);
    this._emit(true);
    return new Promise((resolve) => (this.recording.resolve = resolve));
  }

  cancelRecording() {
    if (!this.recording) return;
    this.recording.resolve?.(null);
    this.recording = null;
    this._log("record", "Recording cancelled");
    this._emit(true);
  }

  async _finishRecording() {
    const rec = this.recording;
    this.recording = null;
    const L = this.latest;
    const features = averageFeatures(rec.feats);
    const tail = rec.trend.slice(-Math.max(3, Math.floor(rec.trend.length / 4)));
    const health = tail.reduce((s, p) => s + p.health, 0) / Math.max(1, tail.length);
    const d = L.diagnosis;
    const doc = {
      scenarioName: rec.name,
      scenarioId: rec.scenarioId,
      sessionId: this.sessionId,
      seed: this.seed,
      source: this.external ? "external" : "simulation",
      motorParameters: { ...this.params },
      faults: { ...this.faults },
      dsp: clone(this.dsp),
      simulationDuration: +(this.simTime - rec.t0).toFixed(2),
      healthScore: +health.toFixed(2),
      healthBand: healthBand(health).label,
      healthBreakdown: L.health.items.map(({ key, label, value }) => ({ key, label, value: +value.toFixed(2) })),
      diagnosis: d.label,
      primaryFault: d.primary,
      confidence: +d.confidence.toFixed(1),
      severity: d.severity,
      classifier: this.classifier.name,
      evidence: d.evidence,
      features: roundObj(features),
      featureVector: featureVector(features).map((v) => +v.toFixed(5)),
      telemetry: { rpm: L.rpm, temperature: L.temperature, current: L.current },
      healthTrend: rec.trend,
      spectrum: downsampleSpectrum(L.spectrum.mag, L.spectrum.df, 256),
      notes: rec.notes,
    };
    this._log("record", `Recording "${rec.name}" complete → saving`);
    try {
      const res = await fetch("/api/experiments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      this._log("record", `Experiment saved (${json.item.id.slice(-6)})`);
      rec.resolve?.(json.item);
    } catch (e) {
      this._log("error", `Save failed: ${e.message}`);
      rec.resolve?.(null);
    }
    this._emit(true);
  }

  // ── buffers ───────────────────────────────────────────────────────────────
  _write(vib, cur) {
    for (let i = 0; i < vib.length; i++) {
      const k = (this.total + i) & (CAP - 1);
      this.vib[k] = vib[i];
      this.cur[k] = cur ? cur[i] : 0;
    }
    this.total += vib.length;
  }

  /** Copy samples [start, start+len) by absolute index; null if overwritten. */
  getSegment(start, len, channel = "vib") {
    if (start < 0 || start + len > this.total || start < this.total - CAP) return null;
    const buf = channel === "cur" ? this.cur : this.vib;
    const out = new Float32Array(len);
    const s = start & (CAP - 1);
    const first = Math.min(len, CAP - s);
    out.set(buf.subarray(s, s + first), 0);
    if (first < len) out.set(buf.subarray(0, len - first), first);
    return out;
  }

  /** Last `len` samples. */
  tail(len, channel = "vib") {
    return this.getSegment(Math.max(0, this.total - len), Math.min(len, this.total), channel);
  }

  /** Signal value at "now" for animation (interpolated between generation blocks). */
  instantSample(channel = "vib") {
    const fs = this.dsp.fs;
    const lag = Math.round(fs * BLOCK_S * 1.5);
    const since = Math.min(BLOCK_S, (performance.now() - this.visual.lastGen) / 1000);
    const idx = Math.max(0, this.total - lag + Math.floor(since * fs));
    const buf = channel === "cur" ? this.cur : this.vib;
    return buf[idx & (CAP - 1)];
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  _loop() {
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!this.running) return;
    // Catch up after slow frames (up to 1 s) so simulation time tracks wall-clock time.
    dt = Math.min(dt, 1.0) * this.speed;
    const fs = this.source.fs;
    this._acc += dt * fs;
    let n = Math.floor(this._acc);
    this._acc -= n;
    const block = Math.round(fs * BLOCK_S);
    while (n > 0) {
      const m = Math.min(n, block);
      this._advanceEvolution();
      this._slewFaults(m / fs);
      const r = this.source.read(m, this.effectiveParams, this.faults);
      this._write(r.vib, r.cur);
      // STFT columns are produced as samples arrive → the spectrogram scrolls continuously
      this.spectrogram.update(this.total, (s0, l) => this.getSegment(s0, l, "vib"), fs);
      this._lastRead = r;
      this.simTime += m / fs;
      n -= m;
    }
    this.visual.lastGen = now;
    if (now - this._lastAnalysis >= 1000 / ANALYSIS_HZ) {
      this._lastAnalysis = now;
      this._analyze();
    }
    this._demoTick?.();
  }

  _slewFaults(dt) {
    const step = FAULT_SLEW * dt;
    let changed = false;
    const next = { ...this.faults };
    for (const k of FAULT_TYPES) {
      const d = this.faultTargets[k] - next[k];
      if (Math.abs(d) > 1e-6) {
        next[k] += Math.sign(d) * Math.min(Math.abs(d), step);
        changed = true;
      }
    }
    if (changed) this.faults = next;
  }

  /** Sample index representing "now" for smooth (frame-rate) display between generation blocks. */
  liveIndex(lagS = 0.06) {
    const fs = this.source.fs;
    const since = this.running ? Math.min(lagS, (performance.now() - this.visual.lastGen) / 1000) : 0;
    return Math.max(0, Math.min(this.total, Math.floor(this.total - lagS * fs + since * fs)));
  }

  /** Live shaft speed from the last generated block (updates at the generation rate, not the analysis rate). */
  get liveRpm() {
    return this._lastRead?.rpm ?? 0;
  }

  _advanceEvolution() {
    const ev = this.evolution;
    if (!ev) return;
    const p = Math.min(1, (this.simTime - ev.t0) / ev.duration);
    ev.progress = p;
    const v = ev.from + (ev.to - ev.from) * p;
    this.faults = { ...this.faults, [ev.fault]: v };
    this.faultTargets = { ...this.faultTargets, [ev.fault]: v };
    if (p >= 1) {
      this._log("fault", `Fault evolution complete: ${FAULT_INFO[ev.fault].label} at ${(ev.to * 100).toFixed(0)}%`);
      this.evolution = null;
    }
  }

  _ensureBaseline() {
    if (this.external) {
      if (!this.baseline && this.latestRaw) this.captureBaseline();
      return;
    }
    const p = this.params;
    const key = JSON.stringify([p.rpm, p.load, p.voltage, p.noise, p.age, p.baseVibration, p.ambientTemp, this.dsp.fs, this.dsp.fftSize, this.dsp.window, this.dsp.filter]);
    if (key === this._baselineKey) return;
    const now = performance.now();
    // Debounce while a slider is being dragged.
    if (this._baselinePending !== key) {
      this._baselinePending = key;
      this._baselineAt = now + 250;
      if (this.baseline) return;
    }
    if (this.baseline && now < this._baselineAt) return;
    this.baseline = computeBaseline(p, this.dsp);
    this._baselineKey = key;
  }

  _analyze() {
    const n = this.dsp.fftSize;
    if (this.total < n + PAD) return;
    const r = this._lastRead;
    const vibSegment = this.getSegment(this.total - n - PAD, n + PAD, "vib");
    const curSegment = this.external && !this.external.cur ? null : this.getSegment(this.total - n - PAD, n + PAD, "cur");
    const frot = r.frot;
    const result = processWindow({
      vibSegment,
      curSegment,
      dsp: this.dsp,
      frot,
      telemetry: { rpm: r.rpm, temperature: r.temperature, load: this.params.load },
    });
    this.latestRaw = result;
    this._ensureBaseline();
    // Speed-transient gate: while the shaft is accelerating, order components
    // smear across FFT bins, so diagnosis/health are held until speed settles.
    const targetRpm = r.op ? rpmOf(r.op.omegaTarget) : r.rpm;
    // Stopped or coasting motors hold the last verdict (orders are meaningless near 0 rpm).
    const settling = !this.external && (!this.motorOn || r.rpm < 120 || Math.abs(r.rpm - targetRpm) > Math.max(12, 0.012 * targetRpm));
    if (!this.baseline) {
      this.latest = { ...result };
      return;
    }
    const ctx = { rpmSet: this.external ? r.rpm : this.params.rpm, ambient: this.params.ambientTemp };
    const prev = this.latest?.diagnosis ? this.latest : null;
    if (settling && !prev) {
      this.latest = { ...result, settling: true, rpm: r.rpm, temperature: r.temperature, current: r.op?.current ?? null, op: r.op, t: this.simTime };
      this._emit();
      return;
    }
    const rawDiag = settling ? prev.diagnosis : this.classifier.classify(result.features, this.baseline, ctx);
    const health = settling ? prev.health : computeHealth(result.features, this.baseline);
    if (!settling) this._healthEma = this._healthEma == null ? health.score : this._healthEma + 0.35 * (health.score - this._healthEma);
    const diagnosis = settling ? rawDiag : this._stabilise(rawDiag);


    const op = r.op;
    this.latest = {
      ...result,
      diagnosis,
      health: { ...health, score: this._healthEma, raw: health.raw ?? health.score, band: healthBand(this._healthEma) },
      settling,
      rpm: r.rpm,
      temperature: r.temperature,
      current: op ? op.current : result.features.currentMean ?? null,
      op,
      t: this.simTime,
    };

    if (this.simTime - this._lastHist >= 1) {
      this._lastHist = this.simTime;
      const f = result.features;
      this.history.push({
        t: +this.simTime.toFixed(2),
        health: +this._healthEma.toFixed(2),
        rms: f.rms,
        temp: r.temperature,
        rpm: r.rpm,
        current: this.latest.current,
        dominantFrequency: f.dominantFrequency,
        kurtosis: f.kurtosis,
        a1: f.a1,
        label: diagnosis.label,
        severity: Math.max(...FAULT_TYPES.map((k) => this.faults[k])),
      });
      if (this.history.length > 900) this.history.shift();
      this.trend = estimateTrend(this.history, { since: this._lastStepT ?? -Infinity });
      this._checkAlerts();
    }

    if (this.recording) {
      this.recording.feats.push(result.features);
      if (this.simTime - (this.recording._lastT ?? -1) >= 0.5) {
        this.recording._lastT = this.simTime;
        this.recording.trend.push({ t: +(this.simTime - this.recording.t0).toFixed(2), health: +this._healthEma.toFixed(2), rms: +result.features.rms.toFixed(5), temp: r.temperature != null ? +r.temperature.toFixed(2) : null });
      }
      if (this.simTime - this.recording.t0 >= this.recording.duration) this._finishRecording();
    }
    this._emit();
  }

  /** Label hysteresis: a new verdict must persist for 2 analyses before it is shown. */
  _stabilise(d) {
    const st = this._labelState;
    if (st.label === null || d.label === st.label) {
      if (st.label !== d.label) this._log("diagnosis", `Diagnosis: ${CLASS_LABELS[d.label]}`);
      st.label = d.label;
      st.count = 0;
      return d;
    }
    if (st.candidate === d.label) st.count++;
    else {
      st.candidate = d.label;
      st.count = 1;
    }
    if (st.count >= 2) {
      st.label = d.label;
      st.count = 0;
      this._log("diagnosis", `Diagnosis: ${CLASS_LABELS[d.label]}${d.label !== "healthy" ? ` (${d.confidence.toFixed(0)}%)` : ""}`);
      return d;
    }
    return this.latest?.diagnosis ?? d;
  }

  /**
   * Maintenance logic: health thresholds, escalated by the diagnosed severity
   * (a SEVERE fault, or a MODERATE one with health < 75, warrants maintenance
   * even if the overall index is still above 60).
   */
  _checkAlerts() {
    const h = this._healthEma;
    const d = this.latest?.diagnosis;
    const sev = d && d.label !== "healthy" ? d.severity : null;
    let level = null;
    let why = "";
    if (h < 40) (level = "critical"), (why = "health below 40");
    else if (h < 60) (level = "maintenance"), (why = "health below 60");
    else if (sev === "SEVERE" || (sev === "MODERATE" && h < 75)) (level = "maintenance"), (why = `${sev.toLowerCase()} ${CLASS_LABELS[d.primary].toLowerCase()} diagnosed`);
    else if (h < 80) (level = "watch"), (why = "health below 80");
    if (level !== this._alertLevel) {
      this._alertLevel = level;
      if (level === "critical") this._log("alert", `IMMEDIATE ACTION — ${why}`);
      else if (level === "maintenance") this._log("alert", `MAINTENANCE RECOMMENDED — ${why}`);
      else if (level === "watch") this._log("alert", `Condition watch — ${why}`);
    }
    this.alertLevel = level;
  }

  // ── sessions (persisted summaries, never raw samples) ─────────────────────
  async _createSession() {
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seed: this.seed, inputMode: "simulation", startedAt: new Date(), motorParameters: this.params, faults: this.faults, dsp: this.dsp }),
      });
      const json = await res.json();
      this.sessionId = json.item?.id ?? null;
      this._sessionTimer = setInterval(() => this._syncSession(), 30000);
    } catch {
      /* storage unavailable: twin keeps running */
    }
  }

  async _syncSession() {
    if (!this.sessionId || !this.latest?.diagnosis) return;
    const hist = this.history.filter((_, i) => i % 5 === 0).slice(-200);
    try {
      await fetch(`/api/sessions/${this.sessionId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          simTime: this.simTime,
          motorParameters: this.params,
          faults: this.faults,
          dsp: this.dsp,
          inputMode: this.external ? "external" : "simulation",
          faultEvents: this.events.filter((e) => e.type === "fault" || e.type === "alert").slice(-50).map((e) => ({ t: e.t, type: e.type, message: e.message })),
          healthHistory: hist.map((h) => ({ t: h.t, health: h.health, rms: h.rms, temp: h.temp, rpm: h.rpm, label: h.label })),
          lastDiagnosis: { label: this.latest.diagnosis.label, confidence: this.latest.diagnosis.confidence, health: this._healthEma },
        }),
      });
    } catch {
      /* ignore */
    }
  }

  // ── pub/sub ───────────────────────────────────────────────────────────────
  _log(type, message) {
    this.events.push({ t: +this.simTime.toFixed(2), type, message, at: Date.now() });
    if (this.events.length > 200) this.events.shift();
  }

  _emit() {
    this.snapshot = {
      running: this.running,
      motorOn: this.motorOn,
      t: this.simTime,
      params: this.params,
      faults: this.faults,
      faultTargets: this.faultTargets,
      dsp: this.dsp,
      latest: this.latest,
      baseline: this.baseline,
      history: this.history,
      trend: this.trend,
      events: this.events,
      evolution: this.evolution ? { ...this.evolution } : null,
      recording: this.recording ? { name: this.recording.name, duration: this.recording.duration, elapsed: this.simTime - this.recording.t0 } : null,
      classifier: { id: this.classifier.id, name: this.classifier.name },
      inputMode: this.external ? "external" : "simulation",
      inputLabel: this.inputLabel,
      alertLevel: this.alertLevel,
      demo: this.demo ? { ...this.demo } : null,
      seed: this.seed,
      sessionId: this.sessionId,
      motor: MOTOR,
    };
    for (const l of this.listeners) l();
  }

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
}

function roundObj(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === "number" ? +v.toPrecision(6) : v;
  return out;
}

const g = typeof window !== "undefined" ? window : globalThis;
export const engine = g.__twinEngine ?? (g.__twinEngine = new TwinEngine());
export { FAULT_TYPES };
