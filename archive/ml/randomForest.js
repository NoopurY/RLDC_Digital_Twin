// A compact Random Forest (bagged CART trees, Gini impurity, random feature
// subsets per split).  Trained in a Web Worker on the synthetic dataset; the
// model serialises to plain JSON.

import { createRng } from "../simulation/noiseModel.js";

function gini(counts, total) {
  let g = 1;
  for (let i = 0; i < counts.length; i++) {
    const p = counts[i] / total;
    g -= p * p;
  }
  return g;
}

function buildTree(X, y, idx, nClasses, opts, rng, depth, importance) {
  const counts = new Array(nClasses).fill(0);
  for (const i of idx) counts[y[i]]++;
  const n = idx.length;
  const leaf = () => ({ leaf: counts.map((c) => c / n) });
  if (depth >= opts.maxDepth || n < 2 * opts.minLeaf || counts.some((c) => c === n)) return leaf();

  const p = X[0].length;
  const parentG = gini(counts, n);
  let best = null;
  // Random subset of features (without replacement)
  const feats = [];
  const pool = Array.from({ length: p }, (_, i) => i);
  for (let k = 0; k < opts.mtry; k++) {
    const j = Math.floor(rng.next() * pool.length);
    feats.push(pool.splice(j, 1)[0]);
  }
  for (const f of feats) {
    const sorted = idx.slice().sort((a, b) => X[a][f] - X[b][f]);
    const left = new Array(nClasses).fill(0);
    const right = counts.slice();
    for (let i = 0; i < n - 1; i++) {
      const c = y[sorted[i]];
      left[c]++;
      right[c]--;
      const v = X[sorted[i]][f];
      const vn = X[sorted[i + 1]][f];
      if (v === vn) continue;
      const nl = i + 1;
      const nr = n - nl;
      if (nl < opts.minLeaf || nr < opts.minLeaf) continue;
      const g = (nl / n) * gini(left, nl) + (nr / n) * gini(right, nr);
      if (!best || g < best.g) best = { g, f, thr: (v + vn) / 2 };
    }
  }
  if (!best || parentG - best.g < 1e-9) return leaf();
  importance[best.f] += (parentG - best.g) * n;
  const L = [];
  const R = [];
  for (const i of idx) (X[i][best.f] <= best.thr ? L : R).push(i);
  return {
    f: best.f,
    t: best.thr,
    l: buildTree(X, y, L, nClasses, opts, rng, depth + 1, importance),
    r: buildTree(X, y, R, nClasses, opts, rng, depth + 1, importance),
  };
}

export function trainForest(X, y, nClasses, { nTrees = 40, maxDepth = 12, minLeaf = 2, mtry, seed = 7, onProgress } = {}) {
  const rng = createRng(seed);
  const p = X[0].length;
  const opts = { maxDepth, minLeaf, mtry: mtry ?? Math.max(1, Math.round(Math.sqrt(p))) };
  const importance = new Array(p).fill(0);
  const trees = [];
  for (let t = 0; t < nTrees; t++) {
    const idx = Array.from({ length: X.length }, () => Math.floor(rng.next() * X.length));
    trees.push(buildTree(X, y, idx, nClasses, opts, rng, 0, importance));
    onProgress?.((t + 1) / nTrees);
  }
  const s = importance.reduce((a, b) => a + b, 0) || 1;
  return { trees, nClasses, importance: importance.map((v) => v / s) };
}

function treePredict(node, x) {
  while (!node.leaf) node = x[node.f] <= node.t ? node.l : node.r;
  return node.leaf;
}

/** Average class-probability vector across trees. */
export function forestPredictProba(model, x) {
  const p = new Array(model.nClasses).fill(0);
  for (const tree of model.trees) {
    const leaf = treePredict(tree, x);
    for (let c = 0; c < p.length; c++) p[c] += leaf[c];
  }
  return p.map((v) => v / model.trees.length);
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export function evaluate(yTrue, yPred, classes) {
  const k = classes.length;
  const cm = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < yTrue.length; i++) cm[yTrue[i]][yPred[i]]++;
  const perClass = classes.map((name, c) => {
    const tp = cm[c][c];
    const fp = cm.reduce((s, row, r) => s + (r !== c ? row[c] : 0), 0);
    const fn = cm[c].reduce((s, v, j) => s + (j !== c ? v : 0), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { name, precision, recall, f1, support: tp + fn };
  });
  const correct = cm.reduce((s, row, i) => s + row[i], 0);
  const avg = (key) => perClass.reduce((s, c) => s + c[key], 0) / k;
  return {
    accuracy: correct / Math.max(1, yTrue.length),
    macroPrecision: avg("precision"),
    macroRecall: avg("recall"),
    macroF1: avg("f1"),
    confusion: cm,
    perClass,
    nTest: yTrue.length,
  };
}

/** Stratified train/test split. */
export function stratifiedSplit(y, testFrac, seed = 11) {
  const rng = createRng(seed);
  const byClass = new Map();
  y.forEach((c, i) => {
    if (!byClass.has(c)) byClass.set(c, []);
    byClass.get(c).push(i);
  });
  const train = [];
  const test = [];
  for (const idx of byClass.values()) {
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const nTest = Math.round(idx.length * testFrac);
    test.push(...idx.slice(0, nTest));
    train.push(...idx.slice(nTest));
  }
  return { train, test };
}
