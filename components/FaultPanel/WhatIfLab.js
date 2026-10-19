"use client";
import { useState } from "react";
import { Play, ArrowRight } from "lucide-react";
import { FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import { CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { Section, Btn, Field, Slider, cx } from "@/components/ui/primitives";

const VARIABLES = [
  { key: "load", label: "Load", unit: "%", min: 0, max: 100, step: 1 },
  { key: "rpm", label: "Speed", unit: "rpm", min: 0, max: 3000, step: 10 },
  { key: "voltage", label: "Supply voltage", unit: "V", min: 180, max: 260, step: 1 },
  { key: "ambientTemp", label: "Ambient temperature", unit: "°C", min: 0, max: 50, step: 1 },
  { key: "age", label: "Motor age", unit: "yr", min: 0, max: 20, step: 0.5 },
  ...FAULT_TYPES.map((f) => ({ key: `fault:${f}`, label: `${FAULT_INFO[f].label} severity`, unit: "%", min: 0, max: 100, step: 1 })),
];

const ROWS = [
  ["Speed", (r) => r.telemetry.rpm, 0, "rpm", "lower-bad"],
  ["Armature current", (r) => r.telemetry.current, 2, "A", "higher-bad"],
  ["Temperature (steady)", (r) => r.telemetry.temperature, 1, "°C", "higher-bad"],
  ["Vibration RMS", (r) => r.features.rms * 1000, 0, "mg", "higher-bad"],
  ["1× amplitude", (r) => r.features.a1 * 1000, 0, "mg", "higher-bad"],
  ["Kurtosis", (r) => r.features.kurtosis, 2, "", "higher-bad"],
  ["Efficiency", (r) => r.telemetry.efficiency * 100, 1, "%", "lower-bad"],
  ["Health score", (r) => r.health.score, 0, "", "lower-bad"],
];

/**
 * Engineering decision support: run the CURRENT configuration and a modified
 * one through the server-side headless twin (/api/simulation) at steady state
 * and compare the outcomes.
 */
export default function WhatIfLab({ s, focus }) {
  const [varKey, setVarKey] = useState("load");
  const def = VARIABLES.find((v) => v.key === varKey);
  const current = varKey.startsWith("fault:") ? Math.round(s.faults[varKey.slice(6)] * 100) : s.params[varKey];
  const [target, setTarget] = useState(80);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    const base = { params: s.params, faults: s.faults, dsp: s.dsp, seed: 11 };
    const alt = varKey.startsWith("fault:")
      ? { ...base, faults: { ...s.faults, [varKey.slice(6)]: target / 100 } }
      : { ...base, params: { ...s.params, [varKey]: target } };
    try {
      const r = await fetch("/api/simulation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runs: [base, alt] }) });
      const json = await r.json();
      if (!r.ok) throw new Error(json.error);
      setRes({ ...json, label: `${def.label}: ${current}${def.unit} → ${target}${def.unit}` });
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  return (
    <Section title="What-if" kicker="ask the twin: what happens if one condition changes? (steady state, server-side headless run)" focus={focus}>
      <div className="grid gap-3 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2.5">
          <Field label="Change variable">
            <select
              className="sel"
              value={varKey}
              onChange={(e) => {
                setVarKey(e.target.value);
                const d = VARIABLES.find((v) => v.key === e.target.value);
                setTarget(Math.round((d.min + d.max) * 0.7));
              }}
            >
              {VARIABLES.map((v) => (
                <option key={v.key} value={v.key}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-center gap-2 text-[12px]">
            <span className="text-muted">Current</span>
            <span className="num text-ink">
              {typeof current === "number" ? +current.toFixed(1) : current}
              {def.unit}
            </span>
            <ArrowRight size={12} className="text-crimson" />
            <span className="text-muted">What if</span>
            <span className="num text-crimson">
              {target}
              {def.unit}
            </span>
          </div>
          <Slider label="What-if value" value={target} min={def.min} max={def.max} step={def.step} unit={def.unit} accent="crimson" onChange={setTarget} />
          <Btn variant="primary" className="w-full" icon={Play} onClick={run} disabled={busy}>
            {busy ? "Simulating…" : "Run what-if"}
          </Btn>
          {err && <div className="text-[11px] text-crimson">{err}</div>}
          <div className="text-[10.5px] leading-relaxed text-dim">
            Both runs use the same seed and the full generator → DSP → diagnosis chain, with the thermal state solved to steady state.
          </div>
        </div>
        <div className="min-w-0">
          {!res ? (
            <p className="text-[13px] text-muted">
              Choose a condition on the left — e.g. load 30 % → 80 %, or bearing severity → 70 % — and run. The twin solves both cases to steady state and shows what changes.
            </p>
          ) : (
            <div>
              <div className="mb-2 text-[12px] text-muted">{res.label}</div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="label-xs text-left">
                    <th className="py-1 font-normal" />
                    <th className="text-right font-normal">Current</th>
                    <th className="text-right font-normal">vs What-if</th>
                    <th className="text-right font-normal">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([k, get, d, u, sense]) => {
                    const a = get(res.results[0]);
                    const b = get(res.results[1]);
                    const delta = b - a;
                    const worse = Math.abs(delta) > 1e-9 && (sense === "higher-bad" ? delta > 0 : delta < 0);
                    return (
                      <tr key={k} className="border-t border-line/60">
                        <td className="py-1.5 text-muted">{k}</td>
                        <td className="num text-right text-ink/90">
                          {a.toFixed(d)}
                          <span className="ml-0.5 text-[9.5px] text-dim">{u}</span>
                        </td>
                        <td className="num text-right text-ink">
                          {b.toFixed(d)}
                          <span className="ml-0.5 text-[9.5px] text-dim">{u}</span>
                        </td>
                        <td className={cx("num text-right", Math.abs(delta) < 10 ** -d ? "text-dim" : worse ? "text-crimson" : "text-kinetic")}>
                          {delta >= 0 ? "+" : ""}
                          {delta.toFixed(d)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-line/60">
                    <td className="py-1.5 text-muted">Diagnosis</td>
                    {res.results.map((r, i) => (
                      <td key={i} className={cx("text-right text-[11.5px]", r.diagnosis.label === "healthy" ? "text-kinetic" : "text-crimson")}>
                        {CLASS_LABELS[r.diagnosis.label]}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              </table>
              <div className="mt-1.5 text-right text-[10px] text-dim">computed in {res.computeMs} ms on the server</div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
