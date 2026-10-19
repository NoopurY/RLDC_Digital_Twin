"use client";
import { Table2 } from "lucide-react";
import { FEATURE_VECTOR_KEYS, featureVector } from "@/lib/dsp/features";
import { Panel, cx } from "@/components/ui/primitives";

const GROUPS = [
  {
    name: "Time domain",
    rows: [
      ["mean", "Mean", "g", 4],
      ["rms", "RMS", "g", 4],
      ["variance", "Variance", "g²", 5],
      ["std", "Std. deviation", "g", 4],
      ["peak", "Peak", "g", 4],
      ["peakToPeak", "Peak-to-peak", "g", 4],
      ["crestFactor", "Crest factor", "", 3],
      ["kurtosis", "Kurtosis", "", 3],
      ["skewness", "Skewness", "", 3],
    ],
  },
  {
    name: "Frequency domain",
    rows: [
      ["dominantFrequency", "Dominant frequency", "Hz", 2],
      ["shaftFrequency", "Shaft frequency (tach)", "Hz", 2],
      ["a05", "0.5× amplitude", "g", 4],
      ["a1", "1× amplitude", "g", 4],
      ["a2", "2× amplitude", "g", 4],
      ["a3", "3× amplitude", "g", 4],
      ["harmonicRatio", "Harmonic ratio (2×+3×)/1×", "", 3],
      ["harmonicCount", "Harmonic count", "", 0],
      ["spectralCentroid", "Spectral centroid", "Hz", 1],
      ["spectralBandwidth", "Spectral bandwidth", "Hz", 1],
      ["spectralEntropy", "Spectral entropy (norm.)", "", 3],
      ["bandEnergyLow", "Band energy · low", "frac", 3],
      ["bandEnergyMid", "Band energy · mid", "frac", 3],
      ["bandEnergyHigh", "Band energy · high", "frac", 3],
      ["bpfoSNR", "Envelope BPFO SNR", "×", 2],
    ],
  },
  {
    name: "Motor current (MCSA)",
    rows: [
      ["currentMean", "Mean current", "A", 3],
      ["currentRipple", "Ripple (std)", "A", 4],
      ["rippleRatio", "Ripple ratio", "", 4],
      ["sidebandRatio", "Commutation sideband ratio", "", 3],
      ["currentTHD", "Commutation ripple THD", "", 3],
      ["currentSkew", "Current skewness", "", 3],
    ],
  },
];

/** Every extracted feature next to the twin's healthy reference value. */
export default function FeatureTable({ s }) {
  const f = s.latest?.features;
  const b = s.baseline;
  return (
    <Panel title="Feature extraction" icon={Table2} sub="current window vs healthy reference">
      {!f ? (
        <div className="label-xs py-6 text-center">waiting for first window…</div>
      ) : (
        <>
          <div className="mb-3 rounded-[3px] border border-line bg-canvas-deep p-2.5">
            <div className="label-xs mb-1">Feature vector</div>
            <div className="num flex flex-wrap gap-x-1 text-[11.5px] leading-relaxed text-ink/90">
              <span className="text-dim">[</span>
              {featureVector(f).map((v, i) => (
                <span key={i} title={FEATURE_VECTOR_KEYS[i]}>
                  <span className="text-kinetic">{v.toPrecision(4)}</span>
                  {i < FEATURE_VECTOR_KEYS.length - 1 && <span className="text-dim">,</span>}
                </span>
              ))}
              <span className="text-dim">]</span>
            </div>
            <div className="num mt-0.5 text-[9.5px] text-dim">{FEATURE_VECTOR_KEYS.join(" · ")}</div>
          </div>
          <div className="grid gap-x-5 lg:grid-cols-3">
            {GROUPS.map((g) => (
              <table key={g.name} className="w-full self-start text-[11.5px]">
                <thead>
                  <tr>
                    <th colSpan={4} className="label-xs pb-1 text-left !text-ink/70">
                      {g.name}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(([k, lab, u, d]) => {
                    const v = f[k];
                    const r = b && Math.abs(b[k] ?? 0) > 1e-9 ? v / b[k] : null;
                    const hot = r != null && (r > 2 || r < 0.5) && !["mean", "skewness", "currentSkew", "shaftFrequency", "dominantFrequency"].includes(k);
                    return (
                      <tr key={k} className="border-t border-line/50">
                        <td className="py-[3px] pr-2 text-muted">{lab}</td>
                        <td className="num text-right text-ink">{v == null || !Number.isFinite(v) ? "—" : v.toFixed(d)}</td>
                        <td className="num w-10 pl-1 text-[9.5px] text-dim">{u}</td>
                        <td className={cx("num w-12 text-right text-[10.5px]", hot ? "text-crimson" : "text-dim")} title="ratio to healthy reference">
                          {r == null ? "" : `${r.toFixed(r > 10 ? 0 : 2)}×`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
