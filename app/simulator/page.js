"use client";
import { useTwin } from "@/lib/engine/useTwin";
import MotorTwin from "@/components/MotorTwin/MotorTwin";
import StatusLine from "@/components/Simulator/StatusLine";
import HealthReadout from "@/components/Simulator/HealthReadout";
import ControlStrip from "@/components/Simulator/ControlStrip";
import FaultInjector from "@/components/Simulator/FaultInjector";
import SignalDNA from "@/components/Simulator/SignalDNA";
import Diagnosis from "@/components/Simulator/Diagnosis";
import HealthEvolution from "@/components/Simulator/HealthEvolution";
import { cx } from "@/components/ui/primitives";

export default function SimulatorPage() {
  const s = useTwin();
  if (!s) return null;
  const focus = s.demo?.focus;
  return (
    <div className="space-y-8">
      <div>
        <h1 className="display text-[30px] font-bold uppercase leading-none tracking-tight">
          RLDC Motor <span className="text-copper">Digital Twin</span>
        </h1>
        <p className="mt-1.5 font-mono text-[11px] tracking-[0.22em] text-muted">SIMULATE → STRESS → ANALYZE → DIAGNOSE → PREDICT</p>
      </div>

      {/* Zone A — the motor, its health and its controls */}
      <div className="space-y-4">
        <StatusLine s={s} />
        <div className={cx("relative h-[420px] border border-ink/10 sm:h-[520px]", focus === "motor" && "focus-zone")}>
          <MotorTwin>
            <div className="absolute right-3 top-10 hidden sm:block">
              <HealthReadout s={s} focus={focus === "health"} />
            </div>
          </MotorTwin>
        </div>
        {/* phones: the readout sits below the motor instead of covering it */}
        <div className="sm:hidden">
          <HealthReadout s={s} focus={focus === "health"} />
        </div>
        <ControlStrip s={s} />
      </div>

      {/* Zone B — fault injection */}
      <FaultInjector s={s} focus={focus === "faults"} />

      {/* Zone C — the signal, three ways */}
      <SignalDNA s={s} focus={focus} />

      {/* Zone D — what the DSP concluded and how health is evolving */}
      <div className="grid gap-x-10 gap-y-8 xl:grid-cols-2">
        <Diagnosis s={s} focus={focus} />
        <HealthEvolution s={s} focus={focus} />
      </div>
    </div>
  );
}
