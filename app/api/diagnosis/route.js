// Stateless diagnosis service: features (+ optional baseline) → rule-engine
// diagnosis and health score.  Lets an external acquisition front-end (e.g. an
// ESP32 gateway computing features on-device) reuse the same decision layer.
import { NextResponse } from "next/server";
import { RuleClassifier } from "@/lib/diagnosis/classifier";
import { computeHealth } from "@/lib/diagnosis/healthScore";
import { computeBaseline } from "@/lib/simulation/headless";
import { DEFAULT_PARAMS } from "@/lib/simulation/motorModel";

export const dynamic = "force-dynamic";

const REQUIRED = [
  "rms", "peak", "crestFactor", "kurtosis", "dominantFrequency", "shaftFrequency", "a05", "a1", "a2", "a3",
  "harmonicRatio", "harmonicCount", "bandEnergyHigh", "bpfoSNR", "rpm", "fs", "n",
];

export async function POST(req) {
  try {
    const { features: raw, baseline, params } = await req.json();
    const missing = REQUIRED.filter((k) => typeof raw?.[k] !== "number");
    if (missing.length) throw new Error(`features missing numeric fields: ${missing.join(", ")}`);
    // Current-signature features are optional (vibration-only acquisition).
    const features = { sidebandRatio: 0, currentTHD: 0, current1x: 0, currentSkew: 0, currentPU: 0, ...raw };
    const p = { ...DEFAULT_PARAMS, ...(params ?? {}) };
    const base = baseline ?? computeBaseline(p);
    const d = RuleClassifier.classify(features, base, { rpmSet: p.rpm, ambient: p.ambientTemp });
    const h = computeHealth(features, base);
    const { rules, ...diagnosis } = d;
    return NextResponse.json({ diagnosis, health: { score: h.score, band: h.band.label, items: h.items } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
