// Server-side headless simulation: runs the same generator → DSP → diagnosis
// chain as the browser twin.  Used by What-If analysis and scenario comparison.
// Body: { runs: [{ params, faults, dsp?, seed? }, ...] }  or a single run object.
import { NextResponse } from "next/server";
import { runHeadless } from "@/lib/simulation/headless";
import { DEFAULT_DSP } from "@/lib/dsp/pipeline";

export const dynamic = "force-dynamic";

const clampRun = (r) => ({
  params: r.params ?? {},
  faults: r.faults ?? {},
  dsp: { ...DEFAULT_DSP, ...(r.dsp ?? {}), filter: { ...DEFAULT_DSP.filter, ...(r.dsp?.filter ?? {}) } },
  seed: Number.isFinite(r.seed) ? r.seed : 1,
  windows: Math.min(6, Math.max(1, r.windows ?? 3)),
});

export async function POST(req) {
  try {
    const body = await req.json();
    const runs = (Array.isArray(body.runs) ? body.runs : [body]).slice(0, 4).map(clampRun);
    const t0 = Date.now();
    const results = runs.map((r) => runHeadless(r));
    return NextResponse.json({ results, computeMs: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
