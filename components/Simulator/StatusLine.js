"use client";
import { useState } from "react";
import { Power, Circle, Square } from "lucide-react";
import { engine } from "@/lib/engine/twinEngine";
import { useLiveValue } from "@/lib/utils/useTween";
import { CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { cx } from "@/components/ui/primitives";

/**
 * The single place where the motor's run-state is summarised:
 *   RUNNING · 1484 RPM · 30 % LOAD · 34 °C · 3.06 A · HEALTHY
 * plus the two run-level actions: start/stop the motor, save an experiment.
 */
export default function StatusLine({ s }) {
  const rpm = useLiveValue(() => engine.liveRpm, { rate: 10 });
  const L = s.latest;
  const h = L?.health;
  const d = L?.diagnosis;
  const state = !s.motorOn ? (rpm > 20 ? "STOPPING" : "STOPPED") : s.params.rpm > 0 && rpm < s.params.rpm * 0.9 ? "STARTING" : "RUNNING";
  const band = h?.band?.label;
  const bandTone = !h ? "text-dim" : h.score >= 80 ? "text-kinetic" : h.score >= 40 ? "text-amber" : "text-crimson";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink/15 pb-3">
      <button
        onClick={() => engine.setMotorOn(!s.motorOn)}
        className={cx(
          "inline-flex h-9 items-center gap-2 rounded-[2px] border px-3.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em]",
          s.motorOn ? "border-ink/30 text-ink hover:border-crimson hover:text-crimson" : "border-kinetic bg-kinetic text-panel hover:bg-kinetic/90"
        )}
      >
        <Power size={14} /> {s.motorOn ? "Stop motor" : "Start motor"}
      </button>
      <div className="num flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className={cx("font-medium", state === "RUNNING" ? "text-kinetic" : "text-amber")}>
          <span className={cx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", state === "RUNNING" ? "bg-kinetic" : "bg-amber blink")} />
          {state}
        </span>
        <span>
          <span className="text-[22px] text-copper">{rpm.toFixed(0)}</span> RPM
        </span>
        <span>
          <span className="text-ink">{s.params.load}</span> % LOAD
        </span>
        <span>
          <span className="text-ink">{L?.temperature?.toFixed(1) ?? "—"}</span> °C
        </span>
        <span>
          <span className="text-ink">{L?.current?.toFixed(2) ?? "—"}</span> A
        </span>
        {band && <span className={cx("font-medium", bandTone)}>{band}</span>}
        {d && d.label !== "healthy" && <span className="text-crimson">· {CLASS_LABELS[d.label].toUpperCase()}</span>}
      </div>
      <div className="ml-auto">
        <SaveExperiment s={s} />
      </div>
    </div>
  );
}

function SaveExperiment({ s }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dur, setDur] = useState(10);
  const [saved, setSaved] = useState(null);
  const rec = s.recording;
  const suggest = () => {
    const act = Object.entries(s.faults).filter(([, v]) => v > 0.005);
    return act.length ? act.map(([k, v]) => `${CLASS_LABELS[k]} ${(v * 100).toFixed(0)}%`).join(" + ") : `Healthy · ${s.params.rpm} rpm`;
  };
  if (rec)
    return (
      <div className="num flex items-center gap-2 text-[12px] text-crimson">
        <Circle size={9} className="blink fill-crimson" />
        Recording “{rec.name}” · {Math.max(0, rec.duration - rec.elapsed).toFixed(0)} s
        <button onClick={() => engine.cancelRecording()} className="text-muted hover:text-ink" aria-label="Stop recording">
          <Square size={12} />
        </button>
      </div>
    );
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted hover:text-ink">
        <Circle size={10} className="text-crimson" /> Save experiment
        {saved && <span className="ml-1 normal-case tracking-normal text-kinetic">· saved</span>}
      </button>
    );
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setOpen(false);
        const item = await engine.startRecording({ name: name.trim() || suggest(), duration: dur });
        setSaved(item);
        setName("");
      }}
    >
      <input autoFocus className="inp w-56" placeholder={suggest()} value={name} onChange={(e) => setName(e.target.value)} />
      <select className="sel" value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label="Recording length">
        {[5, 10, 20, 30, 60].map((d) => (
          <option key={d} value={d}>
            record {d} s
          </option>
        ))}
      </select>
      <button type="submit" className="font-mono text-[11px] uppercase tracking-[0.12em] text-crimson hover:underline">
        Record
      </button>
      <button type="button" onClick={() => setOpen(false)} className="font-mono text-[11px] uppercase tracking-[0.12em] text-dim hover:text-ink">
        Cancel
      </button>
    </form>
  );
}
