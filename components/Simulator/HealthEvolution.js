"use client";
import TrendChart from "@/components/Charts/TrendChart";
import { Section } from "@/components/ui/primitives";
import { fmtTime } from "@/lib/utils/format";

/**
 * Health index over simulation time with the injected fault severity overlaid,
 * so "severity ↑ → health ↓" is visible directly, plus a model-based trend.
 */
export default function HealthEvolution({ s, focus }) {
  const trend = s.trend;
  const fit = trend?.fit && trend.status !== "insufficient" ? trend.fit : null;
  const data = s.history.map((p) => ({ ...p, sev: (p.severity ?? 0) * 100 }));
  const reached = (v) => (v == null ? "—" : v === 0 ? "reached" : `≈ ${fmtTime(v)}`);
  return (
    <Section title="Health evolution" kicker="simulated degradation · last 15 min of simulation time" focus={focus === "health"}>
      <TrendChart
        data={data}
        height={220}
        yDomain={[0, 100]}
        fit={fit}
        extendSeconds={fit && trend.status === "degrading" ? Math.min(90, Math.max(10, trend.toDegraded || 30)) : 0}
        version={`${s.history.length}|${s.history.at(-1)?.t}`}
        series={[
          { key: "health", label: "Health index", color: "#2F5D46", width: 2, fmt: (v) => v?.toFixed(0) },
          { key: "sev", label: "Max fault severity %", color: "#A8402F", width: 1.2, dash: [4, 3], fmt: (v) => v?.toFixed(0) },
        ]}
        bands={[
          { from: 0, to: 40, color: "rgba(168,64,47,0.07)" },
          { from: 40, to: 80, color: "rgba(198,149,43,0.06)" },
        ]}
      />
      <div className="num mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted">
        <span>
          trend <span className={trend?.status === "degrading" ? "text-crimson" : "text-ink"}>{!trend || trend.status === "insufficient" ? "collecting" : trend.status}</span>
        </span>
        {trend?.slopePerMin != null && (
          <span>
            slope <span className="text-ink">{trend.slopePerMin.toFixed(1)}</span> pts/min (R² {trend.r2.toFixed(2)})
          </span>
        )}
        {trend?.status === "degrading" && (
          <>
            <span>
              to DEGRADED (40) <span className="text-ink">{reached(trend.toDegraded)}</span>
            </span>
            <span>
              to FAILURE RISK (20) <span className="text-ink">{reached(trend.toFailure)}</span>
            </span>
          </>
        )}
      </div>
      <p className="mt-1 text-[11px] text-dim">
        Model-based estimate: a least-squares line through up to 45 s of simulated health since the last manual change, extrapolated — not a validated failure prediction.
      </p>
    </Section>
  );
}
