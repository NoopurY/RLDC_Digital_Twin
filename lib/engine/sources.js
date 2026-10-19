// Input sources.  The DSP/diagnosis chain does not care where samples come
// from — anything implementing   read(n) → { vib, cur|null, rpm, temperature }
// can drive it.  Simulation is the primary source; external sources let real
// sampled data (CSV today, ESP32 over WebSerial/WebSocket later) flow through
// exactly the same pipeline without redesign.

import { SignalGenerator } from "../simulation/signalGenerator.js";

export class SimulationSource {
  kind = "simulation";
  constructor({ seed, fs, params, faults }) {
    this.gen = new SignalGenerator({ seed, fs, params, faults });
  }
  get fs() {
    return this.gen.fs;
  }
  read(n, params, faults) {
    const r = this.gen.generate(n, params, faults);
    return { vib: r.vib, cur: r.cur, rpm: r.rpm, temperature: r.temp, op: r.op, frot: this.gen.frot, t: this.gen.t };
  }
  get theta() {
    return this.gen.theta;
  }
}

/** Replays a recorded signal (e.g. an uploaded CSV) in a loop at its native rate. */
export class RecordedSource {
  kind = "external";
  constructor({ vib, cur = null, fs, rpm, name = "recording" }) {
    this.vib = Float32Array.from(vib);
    this.cur = cur ? Float32Array.from(cur) : null;
    this.fs = fs;
    this.rpm = rpm;
    this.name = name;
    this.pos = 0;
    this.t = 0;
  }
  read(n) {
    const vib = new Float32Array(n);
    const cur = this.cur ? new Float32Array(n) : null;
    for (let i = 0; i < n; i++) {
      vib[i] = this.vib[this.pos];
      if (cur) cur[i] = this.cur[this.pos];
      this.pos = (this.pos + 1) % this.vib.length;
    }
    this.t += n / this.fs;
    return { vib, cur, rpm: this.rpm, temperature: null, op: null, frot: this.rpm / 60, t: this.t };
  }
}

/**
 * Push-based source for live hardware: an ESP32 gateway (WebSerial,
 * WebSocket, …) calls push() with sample blocks; the engine pulls them.
 * Underruns yield silence (zeros) rather than blocking the UI.
 */
export class StreamSource {
  kind = "external";
  constructor({ fs, rpm = 1500, capacity = 1 << 15 }) {
    this.fs = fs;
    this.rpm = rpm;
    this.buf = new Float32Array(capacity);
    this.cbuf = new Float32Array(capacity);
    this.w = 0;
    this.r = 0;
    this.t = 0;
  }
  push(vib, cur) {
    for (let i = 0; i < vib.length; i++) {
      this.buf[this.w % this.buf.length] = vib[i];
      this.cbuf[this.w % this.buf.length] = cur?.[i] ?? 0;
      this.w++;
    }
  }
  read(n) {
    const vib = new Float32Array(n);
    const cur = new Float32Array(n);
    for (let i = 0; i < n && this.r < this.w; i++, this.r++) {
      vib[i] = this.buf[this.r % this.buf.length];
      cur[i] = this.cbuf[this.r % this.buf.length];
    }
    this.t += n / this.fs;
    return { vib, cur, rpm: this.rpm, temperature: null, op: null, frot: this.rpm / 60, t: this.t };
  }
}

/** Parse CSV text: first numeric column = vibration, optional second = current. */
export function parseSignalCSV(text) {
  const vib = [];
  const cur = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(/[,;\t ]+/).map(Number);
    if (!cols.length || !Number.isFinite(cols[0])) continue;
    vib.push(cols[0]);
    if (Number.isFinite(cols[1])) cur.push(cols[1]);
  }
  return { vib, cur: cur.length === vib.length ? cur : null };
}
