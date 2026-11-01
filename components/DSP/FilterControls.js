"use client";
import { FAMILIES, RESPONSES, METHODS } from "@/lib/dsp/iirDesign";
import { Segmented, Field } from "@/components/ui/primitives";

/** Input for a frequency in Hz (empty or invalid text is passed on so validation can report it). */
export function HzInput({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div className="flex items-baseline gap-1">
        <input className="inp w-full" type="number" min={0} step="any" value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))} />
        <span className="num text-[11px] text-dim">Hz</span>
      </div>
    </Field>
  );
}

/**
 * IIR filter configuration: family, response, transformation, order, ripple and cut-off(s).
 * `hide` lists fields to omit (e.g. ["method"] when a comparison varies it).
 */
export default function FilterControls({ cfg, onChange, hide = [] }) {
  const show = (k) => !hide.includes(k);
  return (
    <div className="space-y-4">
      {show("family") && (
        <Field label="Approximation">
          <Segmented size="md" value={cfg.family} onChange={(v) => onChange({ family: v })} options={Object.entries(FAMILIES).map(([value, label]) => ({ value, label }))} />
        </Field>
      )}
      {show("response") && (
        <Field label="Response">
          <Segmented size="md" value={cfg.response} onChange={(v) => onChange({ response: v })} options={Object.entries(RESPONSES).map(([value, label]) => ({ value, label }))} />
        </Field>
      )}
      {show("method") && (
        <Field label="Analog → digital transformation">
          <Segmented
            size="md"
            value={cfg.method}
            onChange={(v) => onChange({ method: v })}
            options={Object.keys(METHODS).map((value) => ({ value, label: value === "bilinear" ? "Bilinear" : "Impulse invariant" }))}
          />
        </Field>
      )}
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {show("order") && (
          <Field label="Order N">
            <Segmented size="md" value={cfg.order} onChange={(v) => onChange({ order: v })} options={[2, 4, 6].map((v) => ({ value: v, label: String(v) }))} />
          </Field>
        )}
        {show("ripple") && cfg.family === "chebyshev" && (
          <Field label="Passband ripple">
            <Segmented size="md" value={cfg.ripple} onChange={(v) => onChange({ ripple: v })} options={[0.5, 1, 2, 3].map((v) => ({ value: v, label: `${v} dB` }))} />
          </Field>
        )}
      </div>
      {show("cutoff") &&
        (cfg.response === "bandpass" ? (
          <div className="grid grid-cols-2 gap-3">
            <HzInput label="Lower cut-off f₁" value={cfg.fLow} onChange={(v) => onChange({ fLow: v })} />
            <HzInput label="Upper cut-off f₂" value={cfg.fHigh} onChange={(v) => onChange({ fHigh: v })} />
          </div>
        ) : (
          <HzInput label="Cut-off frequency f_c" value={cfg.fc} onChange={(v) => onChange({ fc: v })} />
        ))}
    </div>
  );
}
