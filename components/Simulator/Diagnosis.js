"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus } from "lucide-react";
import { CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { FAULT_EXPLANATIONS } from "@/lib/diagnosis/explanations";
import { FAULT_TYPES } from "@/lib/simulation/motorModel";
import { Section, cx } from "@/components/ui/primitives";

/** Explainable diagnosis: verdict, confidence, severity and the evidence behind it. */
export default function Diagnosis({ s, focus }) {
  const d = s.latest?.diagnosis;
  const [showScores, setShowScores] = useState(false);
  const healthy = d?.label === "healthy";
  const expl = d && FAULT_EXPLANATIONS[d.label === "combined" ? "combined" : d.label];
  return (
    <Section
      title="Diagnosis"
      kicker="transparent rule engine vs the twin's healthy reference"
      focus={focus === "diagnosis"}
      actions={s.latest?.settling ? <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber">speed settling · verdict held</span> : null}
    >
      {!d ? (
        <p className="text-[13px] text-muted">Building the healthy reference for this operating point…</p>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={d.label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
            {healthy ? (
              <>
                <div className="display text-[26px] font-bold uppercase leading-tight text-kinetic">No fault detected</div>
                <p className="mt-1 text-[13px] text-muted">Motor is operating normally. {expl.meaning}</p>
              </>
            ) : (
              <>
                <div className="display text-[26px] font-bold uppercase leading-tight text-crimson">
                  {d.label === "combined" ? d.active.map((k) => CLASS_LABELS[k]).join(" + ") : CLASS_LABELS[d.label]}
                </div>
                <div className="mt-2 flex gap-8">
                  <div>
                    <div className="label-xs">Confidence</div>
                    <div className="num text-[24px] text-ink">{d.confidence.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="label-xs">Severity</div>
                    <div className={cx("num text-[24px]", d.severity === "SEVERE" ? "text-crimson" : d.severity === "MODERATE" ? "text-amber" : "text-ink")}>{d.severity}</div>
                  </div>
                </div>
              </>
            )}
            <div className="label-xs mt-4">{healthy ? "Checks" : "Why?"}</div>
            <ul className="mt-1 space-y-1">
              {d.evidence.map((e, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
                  {e.ok ? <Check size={14} className="mt-[1px] shrink-0 text-kinetic" /> : <Minus size={14} className="mt-[1px] shrink-0 text-dim" />}
                  <span className={e.ok ? "text-ink" : "text-dim"}>{e.text}</span>
                </li>
              ))}
            </ul>
            {!healthy && expl && (
              <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                <div>
                  <div className="label-xs">What it means</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{expl.meaning}</p>
                </div>
                <div>
                  <div className="label-xs">Recommended action</div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink">{expl.action}</p>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
      {d?.scores && (
        <div className="mt-4">
          <button onClick={() => setShowScores(!showScores)} className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted hover:text-ink">
            {showScores ? "Hide" : "Show"} rule scores for every fault
          </button>
          {showScores && (
            <div className="mt-2 space-y-1">
              {FAULT_TYPES.map((k) => {
                const v = d.scores[k] ?? 0;
                return (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-36 truncate text-[12px] text-muted">{CLASS_LABELS[k]}</span>
                    <span className="relative h-[4px] flex-1 bg-line">
                      <span className={cx("absolute inset-y-0 left-0 transition-[width] duration-300", v > 0.55 ? "bg-crimson" : v > 0.42 ? "bg-amber" : "bg-kinetic")} style={{ width: `${Math.max(1, v * 100)}%` }} />
                      <span className="absolute -inset-y-1 w-px bg-ink/40" style={{ left: "42%" }} title="detection threshold" />
                    </span>
                    <span className="num w-8 text-right text-[11px] text-ink">{(v * 100).toFixed(0)}</span>
                  </div>
                );
              })}
              <div className="text-[10.5px] text-dim">Tick = 42 % detection threshold.</div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
