// Classifier layer.  A classifier is any object with
//   classify(features, baseline, ctx) → { label, scores, confidence, evidence, source }
// The transparent, deterministic rule engine is used.  Because the engine only
// depends on this interface (engine.setClassifier), a trained model could be
// swapped in later without touching the rest of the pipeline (see archive/ml).

import { evaluateRules, severityLabel } from "./faultRules.js";
import { FAULT_INFO } from "../simulation/faultModels.js";

export const CLASSES = ["healthy", "imbalance", "bearing", "misalignment", "electrical", "overload", "looseness"];

export const CLASS_LABELS = {
  healthy: "Healthy",
  combined: "Combined Fault",
  ...Object.fromEntries(Object.entries(FAULT_INFO).map(([k, v]) => [k, v.label])),
};

const HEALTHY_THRESHOLD = 0.42;
const COMBINED_THRESHOLD = 0.55;

/** Rank fault scores and build the diagnosis object. */
function assemble(scores, rules, source, extra = {}) {
  const ranked = Object.entries(scores)
    .filter(([k]) => k !== "healthy")
    .sort((a, b) => b[1] - a[1]);
  const [topKey, top] = ranked[0];
  const second = ranked[1]?.[1] ?? 0;
  const active = ranked.filter(([, s]) => s >= COMBINED_THRESHOLD).map(([k]) => k);

  if (top < HEALTHY_THRESHOLD) {
    return {
      label: "healthy",
      primary: "healthy",
      confidence: source === "rules" ? 100 * (1 - top) : 100 * (scores.healthy ?? 1 - top),
      scores,
      active: [],
      severity: "NONE",
      // For a healthy verdict, a check mark means "indicator within normal range".
      evidence: [
        { ok: true, text: `No fault indicator above threshold (max ${(top * 100).toFixed(0)}% — ${CLASS_LABELS[topKey]})` },
        { ...rules.imbalance.evidence[0], ok: !rules.imbalance.evidence[0].ok },
        { ...rules.bearing.evidence[0], ok: !rules.bearing.evidence[0].ok },
        { ...rules.misalignment.evidence[0], ok: !rules.misalignment.evidence[0].ok },
        { ...rules.overload.evidence[0], ok: !rules.overload.evidence[0].ok },
      ],
      source,
      ...extra,
    };
  }
  const label = active.length >= 2 ? "combined" : topKey;
  const confidence = 100 * top * (0.75 + 0.25 * (1 - second / Math.max(top, 1e-6)));
  return {
    label,
    primary: topKey,
    confidence: label === "combined" ? 100 * (active.reduce((s, k) => s + scores[k], 0) / active.length) : confidence,
    scores,
    active,
    severity: severityLabel(rules[topKey].magnitude),
    evidence: rules[topKey].evidence,
    secondary: active.filter((k) => k !== topKey).map((k) => ({ key: k, evidence: rules[k].evidence })),
    source,
    ...extra,
  };
}

export const RuleClassifier = {
  id: "rules",
  name: "Rule engine (deterministic)",
  classify(features, baseline, ctx) {
    const rules = evaluateRules(features, baseline, ctx);
    const scores = Object.fromEntries(Object.entries(rules).map(([k, r]) => [k, r.score]));
    return { ...assemble(scores, rules, "rules"), rules };
  },
};
