"use client";
import { memo } from "react";

export const cx = (...c) => c.filter(Boolean).join(" ");

/**
 * A titled region separated by a hairline rule — deliberately not a card.
 * `focus` outlines the region while the professor demo is explaining it.
 */
export function Section({ title, kicker, actions, children, className, focus, id }) {
  return (
    <section id={id} className={cx("min-w-0", focus && "focus-zone", className)}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-ink/15 pb-2">
          {title && <h2 className="display text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">{title}</h2>}
          {kicker && <span className="text-[11.5px] text-muted">{kicker}</span>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Backwards-compatible alias used by a few technical views. */
export function Panel({ title, sub, actions, children, className, bodyClass, focus, id }) {
  return (
    <Section title={title} kicker={sub} actions={actions} className={className} focus={focus} id={id}>
      <div className={bodyClass}>{children}</div>
    </Section>
  );
}

export const Slider = memo(function Slider({ label, value, min, max, step = 1, unit = "", onChange, format, accent = "kinetic", disabled, hint, compact }) {
  const pct = ((value - min) / (max - min)) * 100;
  const acc = { crimson: "var(--color-crimson)", copper: "var(--color-copper)", amber: "var(--color-amber)" }[accent] ?? "var(--color-kinetic)";
  return (
    <label className={cx("block", disabled && "opacity-50")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs">{label}</span>
        <span className={cx("num text-ink", compact ? "text-[13px]" : "text-[15px]")}>
          {format ? format(value) : value}
          {unit && <span className="ml-0.5 text-[10px] text-dim">{unit}</span>}
        </span>
      </div>
      <input
        type="range"
        className="rng"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--pct": `${pct}%`, "--acc": acc }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <div className="num text-[10px] text-dim">{hint}</div>}
    </label>
  );
});

export function Btn({ children, variant = "ghost", size = "md", className, icon: Icon, ...rest }) {
  const v = {
    primary: "bg-kinetic text-panel border-kinetic hover:bg-kinetic/90",
    danger: "bg-crimson text-panel border-crimson hover:bg-crimson/90",
    copper: "bg-copper text-panel border-copper hover:bg-copper/90",
    ghost: "bg-transparent text-ink border-line-2 hover:border-ink/40",
  }[variant];
  const s = { sm: "h-7 px-2.5 text-[10.5px] gap-1.5", md: "h-8 px-3 text-[11px] gap-2", lg: "h-11 px-5 text-[12.5px] gap-2.5" }[size];
  return (
    <button
      className={cx("inline-flex select-none items-center justify-center rounded-[2px] border font-mono font-medium uppercase tracking-[0.1em] transition-colors disabled:pointer-events-none disabled:opacity-40", v, s, className)}
      {...rest}
    >
      {Icon && <Icon size={size === "lg" ? 15 : 13} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function Chip({ children, tone = "muted", className }) {
  const t = {
    ok: "text-kinetic border-kinetic/40",
    bad: "text-crimson border-crimson/50",
    warn: "text-amber border-amber/50",
    copper: "text-copper border-copper/50",
    muted: "text-muted border-line-2",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.1em]", t, className)}>{children}</span>;
}

export function Segmented({ options, value, onChange, size = "sm" }) {
  return (
    <div className="inline-flex border-b border-line">
      {options.map((o) => {
        const val = typeof o === "object" ? o.value : o;
        const lab = typeof o === "object" ? o.label : o;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            className={cx(
              "-mb-px border-b-2 font-mono uppercase tracking-[0.1em] transition-colors",
              size === "sm" ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-[11px]",
              value === val ? "border-kinetic text-ink" : "border-transparent text-muted hover:text-ink"
            )}
          >
            {lab}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-[11.5px] text-muted hover:text-ink">
      <span className={cx("relative h-[14px] w-[26px] rounded-full border transition-colors", checked ? "border-kinetic bg-kinetic/20" : "border-line-2 bg-panel")}>
        <span className={cx("absolute top-[2px] h-[8px] w-[8px] rounded-full transition-all", checked ? "left-[14px] bg-kinetic" : "left-[2px] bg-dim")} />
      </span>
      {label}
    </button>
  );
}

export function Field({ label, children, className }) {
  return (
    <label className={cx("flex flex-col gap-1", className)}>
      <span className="label-xs">{label}</span>
      {children}
    </label>
  );
}

/** Empty state that always offers the next meaningful action. */
export function EmptyState({ title, children, action }) {
  return (
    <div className="flex flex-col items-start gap-2 py-8">
      <div className="display text-[15px] font-semibold uppercase tracking-[0.08em] text-ink">{title}</div>
      <div className="max-w-md text-[13px] text-muted">{children}</div>
      {action}
    </div>
  );
}

export function Readout({ label, value, unit, tone, sub, size = "md", className }) {
  const color = { bad: "text-crimson", ok: "text-kinetic", warn: "text-amber", copper: "text-copper" }[tone] ?? "text-ink";
  const fs = size === "lg" ? "text-[30px]" : size === "sm" ? "text-[15px]" : "text-[20px]";
  return (
    <div className={cx("min-w-0", className)}>
      <div className="label-xs truncate">{label}</div>
      <div className={cx("num leading-tight", fs, color)}>
        {value}
        {unit && <span className="ml-1 text-[11px] text-dim">{unit}</span>}
      </div>
      {sub && <div className="num truncate text-[10.5px] text-dim">{sub}</div>}
    </div>
  );
}

export function PageHeader({ kicker, title, children, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && <div className="label-xs !text-copper">{kicker}</div>}
        <h1 className="display mt-1 text-[28px] font-bold uppercase leading-none tracking-tight text-ink">{title}</h1>
        {children && <p className="mt-2 max-w-3xl text-[13.5px] leading-relaxed text-muted">{children}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
