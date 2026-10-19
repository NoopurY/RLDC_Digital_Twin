"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Layers, Flame, Tag, X } from "lucide-react";
import { useTwin } from "@/lib/engine/useTwin";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { MOTOR, bearingOrders } from "@/lib/simulation/motorModel";
import { cx } from "@/components/ui/primitives";

const MotorScene = dynamic(() => import("./MotorScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-canvas">
      <div className="label-xs blink">initialising twin renderer…</div>
    </div>
  ),
});

const VIEWS = [
  { key: "iso", label: "ISO" },
  { key: "side", label: "SIDE" },
  { key: "drive", label: "DRIVE" },
  { key: "top", label: "TOP" },
  { key: "inside", label: "INSIDE" },
];

const ORD = bearingOrders();

const COMPONENTS = {
  stator: {
    title: "Stator · field poles",
    body: "Four salient poles with copper field coils set up the main flux. Coil heating follows armature current and the thermal model.",
    faults: ["overload", "electrical"],
    metrics: (s) => [["Temperature", s.latest?.temperature, "°C", 1], ["Current", s.latest?.current, "A", 2]],
  },
  armature: {
    title: "Armature (rotor)",
    body: `Laminated core with ${MOTOR.commutatorSegments} slot coils. Uneven mass distribution → once-per-rev centrifugal force (imbalance). A shorted coil (highlighted) distorts the current.`,
    faults: ["imbalance", "electrical"],
    metrics: (s) => [["1× amplitude", s.latest ? s.latest.features.a1 * 1000 : null, "mg", 0], ["Shaft freq.", s.latest?.features.shaftFrequency, "Hz", 2]],
  },
  commutator: {
    title: "Commutator + brushes",
    body: `Mechanical rectifier: ${MOTOR.commutatorSegments} segments reverse coil current, producing ripple at ${MOTOR.commutatorSegments}×f_rot. Electrical faults create sidebands and brush sparking.`,
    faults: ["electrical"],
    metrics: (s) => [["Sideband ratio", s.latest?.features.sidebandRatio, "", 3], ["Ripple THD", s.latest ? s.latest.features.currentTHD * 100 : null, "%", 1]],
  },
  bearingDE: {
    title: "Rolling bearing · drive end",
    body: `${MOTOR.bearing.balls} balls, d/D = ${MOTOR.bearing.dOverD}. An outer-race spall is struck at BPFO = ${ORD.bpfo.toFixed(2)}×f_rot, ringing the structure.`,
    faults: ["bearing"],
    metrics: (s) => [["Kurtosis", s.latest?.features.kurtosis, "", 2], ["BPFO SNR", s.latest?.features.bpfoSNR, "×", 1], ["BPFO", (s.latest?.features.shaftFrequency ?? 0) * ORD.bpfo, "Hz", 1]],
  },
  coupling: {
    title: "Flexible coupling",
    body: "Jaw coupling with elastomer spider. Shaft misalignment loads it twice per revolution → strong 2× vibration. Green laser = motor axis, crimson = load axis.",
    faults: ["misalignment"],
    metrics: (s) => [["2× amplitude", s.latest ? s.latest.features.a2 * 1000 : null, "mg", 0], ["2×/1×", s.latest ? s.latest.features.a2 / Math.max(s.latest.features.a1, 1e-6) : null, "", 2]],
  },
  load: {
    title: "Dynamometer load",
    body: "Flywheel with brake caliper sets shaft torque. Caliper glows with load; overload drives current, heat and speed droop.",
    faults: ["overload"],
    metrics: (s) => [["Torque", s.latest?.op?.loadTorque, "N·m", 2], ["Efficiency", s.latest?.op ? s.latest.op.efficiency * 100 : null, "%", 1]],
  },
  mount: {
    title: "Mounting · hold-down bolts",
    body: "A loose bolt / soft foot makes support stiffness non-linear: the frame rocks at ½× and the spectrum shows a harmonic comb.",
    faults: ["looseness"],
    metrics: (s) => [["0.5× amplitude", s.latest ? s.latest.features.a05 * 1000 : null, "mg", 0], ["Harmonics", s.latest?.features.harmonicCount, "", 0]],
  },
  sensor: {
    title: "ACC-1 accelerometer",
    body: "Piezo accelerometer on the drive-end shield, sampled at f_s. Its samples feed the filter → FFT/STFT → features → diagnosis chain.",
    faults: [],
    metrics: (s) => [["RMS", s.latest ? s.latest.features.rms * 1000 : null, "mg", 0], ["f_s", s.dsp.fs, "Hz", 0]],
  },
};

/**
 * The 3D twin with its view controls and part inspector.  Readings (speed,
 * temperature, health) are intentionally NOT repeated here — the simulator's
 * status line and health readout own them.  `children` render as an overlay.
 */
export default function MotorTwin({ mode = "full", className, children }) {
  const s = useTwin();
  const hero = mode === "hero";
  const [view, setView] = useState({ cutaway: true, thermal: false, labels: true, signal: hero });
  const [viewKey, setViewKey] = useState({ key: hero ? "hero" : "iso", n: 0 });
  const [selected, setSelected] = useState(null);
  const d = s?.latest?.diagnosis;
  const detected = new Set(d && d.label !== "healthy" ? [d.primary, ...(d.active ?? [])] : []);
  const comp = selected ? COMPONENTS[selected === "signal" ? "sensor" : selected] : null;

  useEffect(() => {
    if (window.innerWidth < 640) setView((v) => ({ ...v, labels: false }));
  }, []);

  const toggle = (k) => setView((v) => ({ ...v, [k]: !v[k] }));

  return (
    <div className={cx("relative h-full w-full overflow-hidden", className)}>
      <MotorScene view={view} viewKey={viewKey} interactive={!hero} labels={!hero && view.labels} selected={selected} onSelect={setSelected} effects />
      {!hero && s && (
        <>
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            {[
              ["cutaway", Layers, "Cut-away"],
              ["thermal", Flame, "Thermal"],
              ["labels", Tag, "Parts"],
            ].map(([k, Icon, t]) => (
              <button
                key={k}
                onClick={() => toggle(k)}
                className={cx("flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em]", view[k] ? "text-ink" : "text-dim hover:text-muted")}
              >
                <Icon size={12} className={view[k] ? "text-copper" : ""} />
                {t}
              </button>
            ))}
            <span className="h-3 w-px bg-ink/20" />
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setViewKey({ key: v.key, n: Date.now() })}
                className={cx("font-mono text-[10px] tracking-[0.1em]", viewKey.key === v.key ? "text-ink underline decoration-copper decoration-2 underline-offset-4" : "text-dim hover:text-muted")}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9.5px] tracking-[0.1em] text-dim">ROTATION SHOWN ×1/12 · SYNTHETIC SIGNALS AT TRUE SPEED</div>
          {comp && (
            <div className="absolute bottom-8 left-3 w-[300px] border border-ink/20 bg-panel/95 p-3 shadow-sm">
              <div className="flex items-start justify-between">
                <div className="display text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">{comp.title}</div>
                <button onClick={() => setSelected(null)} className="text-dim hover:text-ink" aria-label="Close inspector">
                  <X size={14} />
                </button>
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{comp.body}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {comp.metrics(s).map(([k, v, u, dd]) => (
                  <div key={k} className="flex items-baseline justify-between gap-2 border-b border-line py-0.5">
                    <span className="text-[10.5px] text-dim">{k}</span>
                    <span className="num text-[11.5px] text-ink">
                      {v == null || !Number.isFinite(v) ? "—" : v.toFixed(dd)}
                      <span className="ml-0.5 text-[9px] text-dim">{u}</span>
                    </span>
                  </div>
                ))}
              </div>
              {comp.faults.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {comp.faults.map((f) => (
                    <span key={f} className={cx("border px-1.5 py-[1px] font-mono text-[9.5px]", detected.has(f) ? "border-crimson/60 text-crimson" : "border-line-2 text-dim")}>
                      {FAULT_INFO[f].label}
                      {detected.has(f) ? " · detected" : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {children}
        </>
      )}
    </div>
  );
}
