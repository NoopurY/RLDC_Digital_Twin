"use client";
import { engine } from "@/lib/engine/twinEngine";
import { Slider } from "@/components/ui/primitives";

/** The five operating-point controls, laid out as one instrument strip under the motor. */
export default function ControlStrip({ s }) {
  const p = s.params;
  const set = (k) => (v) => engine.setParams({ [k]: v });
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
      <Slider label="Speed" value={p.rpm} min={0} max={3000} step={10} unit="rpm" accent="copper" onChange={set("rpm")} hint={`f_rot = ${(p.rpm / 60).toFixed(1)} Hz`} />
      <Slider label="Load" value={p.load} min={0} max={100} unit="%" onChange={set("load")} />
      <Slider label="Voltage" value={p.voltage} min={180} max={260} unit="V" onChange={set("voltage")} hint={s.latest?.op?.saturated ? "speed limited by supply" : undefined} />
      <Slider label="Sensor noise" value={p.noise} min={0} max={100} unit="%" onChange={set("noise")} />
      <Slider label="Motor age" value={p.age} min={0} max={20} step={0.1} unit="yr" onChange={set("age")} format={(v) => v.toFixed(1)} />
    </div>
  );
}
