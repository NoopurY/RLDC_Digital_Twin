// Estimated degradation trend from the simulated health history.
// A least-squares line over the recent window; if the trend is falling, the
// time at which it would cross the DEGRADED (40) and FAILURE-RISK (20) limits
// is extrapolated.  This is a trend estimate on simulated data — not an
// experimentally validated remaining-useful-life prediction.

import { linearFit } from "../dsp/statistics.js";

// `since`: time of the last manual step change (fault set, parameter change).
// A step is not degradation, so the fit only uses data recorded after it settled.
export function estimateTrend(history, { window = 45, minPoints = 15, since = -Infinity } = {}) {
  if (!history || history.length < minPoints) return { status: "insufficient", points: history?.length ?? 0 };
  const tEnd = history.at(-1).t;
  const pts = history.filter((p) => p.t >= Math.max(tEnd - window, since + 3));
  if (pts.length < minPoints) return { status: "insufficient", points: pts.length };
  const xs = pts.map((p) => p.t);
  const ys = pts.map((p) => p.health);
  const { a, b, r2 } = linearFit(xs, ys);
  const current = a + b * tEnd;
  // 0 = already crossed; null = not heading there.
  const cross = (level) => (b < -1e-3 ? (current > level ? (level - a) / b - tEnd : 0) : null);
  let status = "stable";
  if (b < -0.05) status = "degrading";
  else if (b > 0.05) status = "recovering";
  return {
    status,
    slopePerMin: b * 60,
    r2,
    current,
    toDegraded: cross(40),
    toFailure: cross(20),
    fit: { a, b, t0: xs[0], t1: tEnd },
  };
}
