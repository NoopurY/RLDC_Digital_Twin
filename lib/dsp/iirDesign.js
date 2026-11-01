// IIR digital filter design for the DSP Analysis "Digital Filtering" module.
//
//   1. Analog low-pass prototype (Ω_c = 1 rad/s): Butterworth or Chebyshev Type-I,
//      as zeros / poles / gain (ZPK).
//   2. Analog frequency transformation:  LP→LP, LP→HP, LP→BP.
//   3. Analog → digital transformation:
//        • Bilinear:          s = 2·fs·(1 − z⁻¹)/(1 + z⁻¹), with frequency pre-warping
//                             Ω = 2·fs·tan(ω/2).  Realised as cascaded 2nd-order sections.
//        • Impulse invariant: h[n] = T·h_a(nT); each analog pole p maps to z = e^{pT}.
//                             H(z) = Σ T·r_k / (1 − e^{p_k T} z⁻¹).  Realised in parallel form.
//
// Pure module (no UI, no engine state).  Kept separate from lib/dsp/filters.js,
// which feeds the live simulator pipeline.

// ── tiny complex arithmetic ────────────────────────────────────────────────
const C = (re, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const sub = (a, b) => C(a.re - b.re, a.im - b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const scale = (a, k) => C(a.re * k, a.im * k);
const abs = (a) => Math.hypot(a.re, a.im);
const cexp = (a) => scale(C(Math.cos(a.im), Math.sin(a.im)), Math.exp(a.re));
const csqrt = (a) => {
  const r = abs(a);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
  return C(re, im);
};
const prod = (arr, f = (x) => x) => arr.reduce((acc, x) => mul(acc, f(x)), C(1));

export const FAMILIES = { butterworth: "Butterworth", chebyshev: "Chebyshev Type-I" };
export const RESPONSES = { lowpass: "Low-pass", highpass: "High-pass", bandpass: "Band-pass" };
export const METHODS = { bilinear: "Bilinear transformation", impulse: "Impulse invariant transformation" };

// ── 1. analog prototype ───────────────────────────────────────────────────
export function prototype(family, n, rippleDb = 1) {
  const poles = [];
  let k;
  if (family === "chebyshev") {
    const eps = Math.sqrt(10 ** (rippleDb / 10) - 1);
    const v0 = Math.asinh(1 / eps) / n;
    for (let i = 1; i <= n; i++) {
      const th = (Math.PI * (2 * i - 1)) / (2 * n);
      poles.push(C(-Math.sinh(v0) * Math.sin(th), Math.cosh(v0) * Math.cos(th)));
    }
    k = prod(poles, (p) => scale(p, -1)).re;
    if (n % 2 === 0) k /= Math.sqrt(1 + eps * eps); // even order: DC sits on the ripple trough
  } else {
    for (let i = 1; i <= n; i++) {
      const th = (Math.PI * (2 * i + n - 1)) / (2 * n);
      poles.push(C(Math.cos(th), Math.sin(th)));
    }
    k = 1;
  }
  return { zeros: [], poles, k };
}

// ── 2. analog frequency transformations (rad/s) ─────────────────────────
function lp2lp({ zeros, poles, k }, wo) {
  return { zeros: zeros.map((z) => scale(z, wo)), poles: poles.map((p) => scale(p, wo)), k: k * wo ** (poles.length - zeros.length) };
}
function lp2hp({ zeros, poles, k }, wo) {
  const kk = k * div(prod(zeros, (z) => scale(z, -1)), prod(poles, (p) => scale(p, -1))).re;
  const z = [...zeros.map((x) => div(C(wo), x)), ...Array(poles.length - zeros.length).fill(C(0))];
  return { zeros: z, poles: poles.map((p) => div(C(wo), p)), k: kk };
}
function lp2bp({ zeros, poles, k }, wo, bw) {
  const out = [];
  for (const p of poles) {
    const pl = scale(p, bw / 2);
    const r = csqrt(sub(mul(pl, pl), C(wo * wo)));
    out.push(add(pl, r), sub(pl, r));
  }
  const z = Array(poles.length - zeros.length).fill(C(0));
  return { zeros: z, poles: out, k: k * bw ** (poles.length - zeros.length) };
}

// ── helpers: group roots into real second-order polynomials ──────────────
/** Pair conjugate roots → real quadratics [1, -2Re, |r|²]; leftover real roots → [1, -r]. */
function realPolys(roots) {
  const rest = roots.map((r) => ({ ...r }));
  const out = [];
  const used = new Array(rest.length).fill(false);
  for (let i = 0; i < rest.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const r = rest[i];
    if (Math.abs(r.im) > 1e-9) {
      // find its conjugate
      let j = -1;
      for (let q = i + 1; q < rest.length; q++) if (!used[q] && Math.abs(rest[q].re - r.re) < 1e-7 && Math.abs(rest[q].im + r.im) < 1e-7) j = q;
      if (j >= 0) used[j] = true;
      out.push({ c: [1, -2 * r.re, r.re * r.re + r.im * r.im], order: 2, root: r });
    } else out.push({ c: [1, -r.re], order: 1, root: r });
  }
  return out;
}

const polyMul = (a, b) => {
  const out = new Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => (out[i + j] += x * y)));
  return out;
};
const polyAdd = (a, b) => {
  const n = Math.max(a.length, b.length);
  return Array.from({ length: n }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0));
};

// ── 3a. bilinear transformation ─────────────────────────────────────────
function bilinearZpk({ zeros, poles, k }, fs) {
  const fs2 = 2 * fs;
  const mapz = (s) => div(add(C(fs2), s), sub(C(fs2), s));
  const zd = [...zeros.map(mapz), ...Array(poles.length - zeros.length).fill(C(-1))];
  const pd = poles.map(mapz);
  const kd = k * div(prod(zeros, (z) => sub(C(fs2), z)), prod(poles, (p) => sub(C(fs2), p))).re;
  return { zeros: zd, poles: pd, k: kd };
}

/** Digital ZPK → cascaded second-order sections {b:[3], a:[3]} (gain on the first). */
function zpkToSos({ zeros, poles, k }) {
  const P = realPolys(poles);
  const Z = realPolys(zeros);
  // merge first-order polynomials so each section is ≤ 2nd order
  const pack = (list) => {
    const quads = list.filter((x) => x.order === 2).map((x) => x.c);
    const lin = list.filter((x) => x.order === 1).map((x) => x.c);
    while (lin.length >= 2) quads.push(polyMul(lin.pop(), lin.pop()));
    if (lin.length) quads.push([...lin.pop(), 0]);
    return quads;
  };
  const a = pack(P);
  const b = pack(Z);
  while (b.length < a.length) b.push([1, 0, 0]);
  const sections = a.map((ai, i) => ({ b: b[i] ? [...b[i]] : [1, 0, 0], a: ai }));
  sections[0].b = sections[0].b.map((v) => v * k);
  return sections;
}

// ── 3b. impulse invariant transformation ────────────────────────────────
function impulseInvariant({ zeros, poles, k }, fs) {
  const T = 1 / fs;
  // residues of H(s) = k·Π(s − z)/Π(s − p)  (simple poles)
  const res = poles.map((p, i) =>
    scale(div(prod(zeros, (z) => sub(p, z)), prod(poles.filter((_, j) => j !== i), (q) => sub(p, q))), k)
  );
  // Combine each conjugate pair:  T·[r/(1 − a z⁻¹) + r*/(1 − a* z⁻¹)]
  const sections = [];
  const used = new Array(poles.length).fill(false);
  for (let i = 0; i < poles.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const a = cexp(scale(poles[i], T));
    const r = scale(res[i], T);
    if (Math.abs(poles[i].im) > 1e-9) {
      for (let j = i + 1; j < poles.length; j++)
        if (!used[j] && Math.abs(poles[j].re - poles[i].re) < 1e-7 && Math.abs(poles[j].im + poles[i].im) < 1e-7) used[j] = true;
      // 2Re{r} − 2Re{r·a*} z⁻¹  over  1 − 2Re{a} z⁻¹ + |a|² z⁻²
      sections.push({ b: [2 * r.re, -2 * (r.re * a.re + r.im * a.im), 0], a: [1, -2 * a.re, a.re * a.re + a.im * a.im] });
    } else sections.push({ b: [r.re, 0, 0], a: [1, -a.re, 0] });
  }
  return sections;
}

// ── frequency responses ────────────────────────────────────────────────
function sectionH(s, w) {
  const e1 = C(Math.cos(-w), Math.sin(-w));
  const e2 = C(Math.cos(-2 * w), Math.sin(-2 * w));
  const num = add(add(C(s.b[0]), scale(e1, s.b[1])), scale(e2, s.b[2]));
  const den = add(add(C(s.a[0]), scale(e1, s.a[1])), scale(e2, s.a[2]));
  return div(num, den);
}
/** Complex H(e^{jω}) of a designed filter at digital frequency ω (rad/sample). */
export function responseAt(design, w) {
  if (design.structure === "parallel") return design.sections.reduce((acc, s) => add(acc, sectionH(s, w)), C(0));
  return design.sections.reduce((acc, s) => mul(acc, sectionH(s, w)), C(1));
}
export function magnitude(design, freqsHz) {
  return freqsHz.map((f) => abs(responseAt(design, (2 * Math.PI * f) / design.fs)));
}
/** Analog prototype response |H(jΩ)| after frequency transformation (for reference gains). */
function analogMag({ zeros, poles, k }, W) {
  const s = C(0, W);
  return Math.abs(k) * abs(div(prod(zeros, (z) => sub(s, z)), prod(poles, (p) => sub(s, p))));
}

// ── validation ─────────────────────────────────────────────────────────
export function validate({ family, response, method, order, fs, fc, fLow, fHigh }) {
  const nyq = fs / 2;
  const errs = [];
  if (![2, 4, 6].includes(order)) errs.push("Order must be 2, 4 or 6.");
  if (!(fs > 0)) errs.push("Sampling frequency must be positive.");
  if (response === "bandpass") {
    if (!(fLow > 0 && fHigh > fLow)) errs.push("Band-pass needs 0 < f_low < f_high.");
    if (fHigh >= nyq) errs.push(`Upper cut-off must be below the Nyquist frequency fs/2 = ${nyq} Hz.`);
  } else {
    if (!(fc > 0)) errs.push("Cut-off frequency must be positive.");
    if (fc >= nyq) errs.push(`Cut-off must be below the Nyquist frequency fs/2 = ${nyq} Hz.`);
  }
  if (method === "impulse" && response === "highpass")
    errs.push("Impulse invariance cannot design a high-pass filter: H(s) is not band-limited, so its sampled impulse response aliases heavily. Use the bilinear transformation.");
  if (!FAMILIES[family]) errs.push("Unknown filter family.");
  return errs;
}

/**
 * Design a digital IIR filter.
 * @returns {{ok, errors, sections, structure, b, a, poles, zeros, maxPole, fs, ...}}
 */
export function designIIR(cfg) {
  const { family, response, method, order, fs, ripple = 1 } = cfg;
  const errors = validate(cfg);
  if (errors.length) return { ok: false, errors };
  const T = 1 / fs;
  // Band-pass of digital order N uses a prototype of order N/2 (each pole becomes two).
  const n = response === "bandpass" ? order / 2 : order;
  const proto = prototype(family, n, ripple);
  // Analog edge frequencies: pre-warped for bilinear, plain for impulse invariance.
  const warp = (f) => (method === "bilinear" ? 2 * fs * Math.tan((Math.PI * f) / fs) : 2 * Math.PI * f);
  let analog;
  let refW; // analog reference frequency for gain normalisation (impulse invariance)
  if (response === "lowpass") {
    analog = lp2lp(proto, warp(cfg.fc));
    refW = 0;
  } else if (response === "highpass") {
    analog = lp2hp(proto, warp(cfg.fc));
  } else {
    const w1 = warp(cfg.fLow);
    const w2 = warp(cfg.fHigh);
    analog = lp2bp(proto, Math.sqrt(w1 * w2), w2 - w1);
    refW = Math.sqrt(w1 * w2);
  }

  let sections;
  let structure;
  let digital;
  if (method === "bilinear") {
    digital = bilinearZpk(analog, fs);
    sections = zpkToSos(digital);
    structure = "cascade";
  } else {
    sections = impulseInvariant(analog, fs);
    structure = "parallel";
    // h[n] = T·h_a(nT) gives the right shape; aliasing shifts the gain slightly, so the
    // passband reference gain is matched to the analog filter's.
    const design0 = { sections, structure, fs };
    const g = analogMag(analog, refW) / abs(responseAt(design0, refW * T));
    sections = sections.map((s) => ({ ...s, b: s.b.map((v) => v * g) }));
    digital = { poles: analog.poles.map((p) => cexp(scale(p, T))), zeros: [] };
  }

  // Overall H(z) = B(z)/A(z) as polynomials in z⁻¹
  let b;
  let a;
  if (structure === "cascade") {
    b = [1];
    a = [1];
    for (const s of sections) {
      b = polyMul(b, s.b);
      a = polyMul(a, s.a);
    }
  } else {
    a = sections.reduce((acc, s) => polyMul(acc, s.a), [1]);
    b = [0];
    sections.forEach((s, i) => {
      const others = sections.filter((_, j) => j !== i).reduce((acc, o) => polyMul(acc, o.a), [1]);
      b = polyAdd(b, polyMul(s.b, others));
    });
  }
  const trim = (p) => {
    const q = [...p];
    while (q.length > 1 && Math.abs(q.at(-1)) < 1e-14) q.pop();
    return q;
  };
  // Products of complex-conjugate factors leave round-off residue (~1e-16) where the exact value is 0.
  const clean = (p) => {
    const m = Math.max(...p.map(Math.abs));
    return p.map((v) => (Math.abs(v) < 1e-12 * m ? 0 : v));
  };
  b = trim(clean(b));
  a = trim(clean(a));
  const poles = digital.poles;
  const maxPole = Math.max(...poles.map(abs));
  return {
    ok: true,
    errors: [],
    cfg,
    fs,
    order,
    sections,
    structure,
    b,
    a,
    poles,
    zeros: digital.zeros ?? [],
    analogPoles: analog.poles,
    maxPole,
    stable: maxPole < 1,
  };
}

/**
 * Filter a signal with a designed IIR filter (Direct Form II Transposed per section).
 * Zero initial conditions; callers discard a warm-up segment so the start-up
 * transient is not shown.
 */
export function applyIIR(design, x) {
  const runSection = ({ b, a }, input) => {
    const y = new Float64Array(input.length);
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < input.length; i++) {
      const xi = input[i];
      const yi = b[0] * xi + z1;
      z1 = b[1] * xi - a[1] * yi + z2;
      z2 = b[2] * xi - a[2] * yi;
      y[i] = yi;
    }
    return y;
  };
  if (design.structure === "parallel") {
    const y = new Float64Array(x.length);
    for (const s of design.sections) {
      const ys = runSection(s, x);
      for (let i = 0; i < x.length; i++) y[i] += ys[i];
    }
    return y;
  }
  let y = Float64Array.from(x);
  for (const s of design.sections) y = runSection(s, y);
  return y;
}

/** Readable transfer function H(z) = Σ b_k z^-k / Σ a_k z^-k. */
export function formatHz(b, a, digits = 4) {
  const term = (c, k) => {
    const v = Math.abs(c) < 1e-3 && c !== 0 ? c.toExponential(digits - 1) : c.toFixed(digits);
    return k === 0 ? v : `${v}·z⁻${superscript(k)}`;
  };
  const series = (p) =>
    p
      .map((c, k) => term(c, k))
      .join(" + ")
      .replace(/\+ -/g, "− ");
  return { num: series(b), den: series(a) };
}
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const superscript = (k) => String(k).split("").map((d) => SUP[d]).join("").replace(/^¹$/, "¹");
