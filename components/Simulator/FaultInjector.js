"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Zap, TrendingUp, RotateCcw, ChevronDown } from "lucide-react";
import { engine } from "@/lib/engine/twinEngine";
import { FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { Slider, Btn, Segmented, cx } from "@/components/ui/primitives";

const CHOICES = ["healthy", ...FAULT_TYPES, "combined"];
const NAMES = { healthy: "Healthy", combined: "Combined fault", ...Object.fromEntries(FAULT_TYPES.map((f) => [f, FAULT_INFO[f].label])) };

/**
 * INJECT FAULT: choose a fault, set one severity, apply it now or let it evolve.
 * Everything downstream (motor animation, signals, FFT, diagnosis, health)
 * reacts because it all reads the same engine state.
 */
export default function FaultInjector({ s, focus }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("imbalance");
  const [sev, setSev] = useState(35);
  const [mode, setMode] = useState("now");
  const [evo, setEvo] = useState({ from: 5, to: 85, duration: 60 });
  const [mix, setMix] = useState({ imbalance: 35, bearing: 20, misalignment: 10, electrical: 0, overload: 0, looseness: 0 });
  const d = s.latest?.diagnosis;
  const detected = new Set(d && d.label !== "healthy" ? [d.primary, ...(d.active ?? [])] : []);
  const active = FAULT_TYPES.filter((f) => s.faultTargets[f] > 0.005 || s.faults[f] > 0.005);
  const ev = s.evolution;

  const apply = () => {
    if (choice === "healthy") return engine.clearFaults();
    if (choice === "combined") {
      const f = Object.fromEntries(Object.entries(mix).map(([k, v]) => [k, v / 100]));
      return engine.setFaults(f, `Combined fault: ${Object.entries(mix).filter(([, v]) => v > 0).map(([k, v]) => `${FAULT_INFO[k].short} ${v}%`).join(", ")}`);
    }
    if (mode === "evolve") return engine.startEvolution({ fault: choice, from: evo.from / 100, to: evo.to / 100, duration: evo.duration });
    engine.setFault(choice, sev / 100);
  };

  return (
    <div className={cx(focus && "focus-zone")}>
      <div className="flex flex-wrap items-center gap-3">
        <Btn variant="danger" size="lg" icon={Zap} onClick={() => setOpen(!open)}>
          Inject fault
          <ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} />
        </Btn>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {active.length === 0 ? (
            <span className="text-[13px] text-muted">No fault injected — the motor is in its healthy configuration.</span>
          ) : (
            active.map((f) => (
              <span key={f} className="num text-[13px] text-ink">
                {FAULT_INFO[f].label} <span className="text-crimson">{(s.faults[f] * 100).toFixed(0)}%</span>
                <span className={cx("ml-1.5 font-mono text-[10px] tracking-[0.1em]", detected.has(f) ? "text-crimson" : "text-dim")}>{detected.has(f) ? "DETECTED" : "NOT YET DETECTED"}</span>
              </span>
            ))
          )}
          {ev && (
            <span className="num text-[12px] text-amber">
              evolving {FAULT_INFO[ev.fault].label.toLowerCase()} · {(ev.progress * ev.duration).toFixed(0)} / {ev.duration} s
              <button onClick={() => engine.stopEvolution()} className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-ink">
                stop
              </button>
            </span>
          )}
          {active.length > 0 && (
            <button onClick={() => engine.clearFaults()} className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted hover:text-ink">
              <RotateCcw size={11} /> Restore healthy
            </button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }} className="overflow-hidden">
            <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {CHOICES.map((c) => (
                    <button
                      key={c}
                      onClick={() => setChoice(c)}
                      className={cx(
                        "rounded-[2px] border px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors",
                        choice === c ? "border-ink bg-ink text-panel" : "border-line-2 text-muted hover:border-ink/40 hover:text-ink"
                      )}
                    >
                      {NAMES[c]}
                    </button>
                  ))}
                </div>
                <div className="mt-3 max-w-xl">
                  {choice === "healthy" && <p className="text-[13px] text-muted">Remove all faults. Severities ramp back to zero over about a second.</p>}
                  {choice === "combined" && <p className="text-[13px] text-muted">Several faults at once. Each keeps its own signature; the diagnosis reports every fault whose evidence passes the threshold.</p>}
                  {FAULT_INFO[choice] && (
                    <>
                      <p className="text-[13px] leading-relaxed text-ink">{FAULT_INFO[choice].description}</p>
                      <p className="mt-1 text-[12px] text-muted">
                        <span className="label-xs mr-1.5">Expected signature</span>
                        {FAULT_INFO[choice].signature}
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div>
                {choice === "combined" ? (
                  <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                    {FAULT_TYPES.map((f) => (
                      <Slider key={f} compact label={FAULT_INFO[f].label} value={mix[f]} min={0} max={100} unit="%" accent="crimson" onChange={(v) => setMix({ ...mix, [f]: v })} />
                    ))}
                  </div>
                ) : choice !== "healthy" ? (
                  <>
                    <Segmented
                      size="md"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "now", label: "Inject now" },
                        { value: "evolve", label: "Fault evolution" },
                      ]}
                    />
                    <div className="mt-3">
                      {mode === "now" ? (
                        <Slider label="Severity" value={sev} min={0} max={100} unit="%" accent="crimson" onChange={setSev} />
                      ) : (
                        <div className="grid grid-cols-3 gap-4">
                          <Slider compact label="Start" value={evo.from} min={0} max={100} unit="%" accent="crimson" onChange={(v) => setEvo({ ...evo, from: Math.min(v, evo.to) })} />
                          <Slider compact label="End" value={evo.to} min={0} max={100} unit="%" accent="crimson" onChange={(v) => setEvo({ ...evo, to: Math.max(v, evo.from) })} />
                          <Slider compact label="Duration" value={evo.duration} min={10} max={180} step={5} unit="s" onChange={(v) => setEvo({ ...evo, duration: v })} />
                        </div>
                      )}
                    </div>
                  </>
                ) : null}
                <Btn className="mt-4" variant={choice === "healthy" ? "primary" : "danger"} icon={mode === "evolve" && choice !== "combined" && choice !== "healthy" ? TrendingUp : Zap} onClick={apply}>
                  {choice === "healthy" ? "Restore healthy" : choice === "combined" ? "Inject combined fault" : mode === "evolve" ? "Start evolution" : `Inject ${sev}%`}
                </Btn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
