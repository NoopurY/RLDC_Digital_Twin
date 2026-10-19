"use client";
import { useTween } from "@/lib/utils/useTween";
import { maintenanceAdvice } from "@/lib/diagnosis/explanations";
import { cx } from "@/components/ui/primitives";

/** The one prominent health visualisation: score, band and its contributing penalties. */
export default function HealthReadout({ s, focus }) {
  const h = s.latest?.health;
  const score = useTween(h?.score ?? null, { rate: 4 });
  const tone = !h ? "text-dim" : h.score >= 80 ? "text-kinetic" : h.score >= 40 ? "text-amber" : "text-crimson";
  const bar = !h ? "bg-dim" : h.score >= 80 ? "bg-kinetic" : h.score >= 40 ? "bg-amber" : "bg-crimson";
  const advice = maintenanceAdvice(h?.score, s.latest?.diagnosis);
  const items = (h?.items ?? []).filter((i) => i.value < -0.5);
  return (
    <div className={cx("w-full border border-ink/15 bg-panel/92 p-3 backdrop-blur-sm sm:w-[230px]", focus && "focus-zone")}>
      <div className="label-xs">Motor health</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className={cx("num text-[44px] font-medium leading-none", tone)}>{score == null ? "—" : score.toFixed(0)}</span>
        <span className="num text-[13px] text-dim">/ 100</span>
      </div>
      <div className="mt-1 h-[3px] bg-line">
        <div className={cx("h-full transition-[width] duration-500", bar)} style={{ width: `${score ?? 0}%` }} />
      </div>
      <div className={cx("mt-1.5 font-mono text-[11px] font-medium tracking-[0.14em]", tone)}>{h ? h.band.label : "CALIBRATING"}</div>
      {items.length > 0 && (
        <div className="mt-2 space-y-[3px] border-t border-line pt-2">
          {items.map((it) => (
            <div key={it.key} className="flex items-baseline justify-between gap-2" title={it.formula}>
              <span className="truncate text-[11px] text-muted">{it.label.split(" (")[0]}</span>
              <span className="num text-[12px] text-crimson">{it.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
      )}
      {advice && advice.level !== "ok" && (
        <div className={cx("mt-2 font-mono text-[10.5px] tracking-[0.1em]", advice.level === "watch" ? "text-amber" : "text-crimson")}>{advice.text}</div>
      )}
    </div>
  );
}
