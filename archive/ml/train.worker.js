// Web Worker: dataset generation → stratified split → Random Forest training →
// held-out evaluation of BOTH the forest and the rule engine.  Runs off the UI
// thread so the live twin keeps animating.
import { generateDataset } from "../simulation/dataset.js";
import { trainForest, forestPredictProba, evaluate, stratifiedSplit } from "../diagnosis/randomForest.js";
import { RuleClassifier, CLASSES } from "../diagnosis/classifier.js";
import { computeBaseline } from "../simulation/headless.js";
import { ML_FEATURE_KEYS } from "../dsp/features.js";

self.onmessage = (e) => {
  const { sweep, nTrees, maxDepth, testFrac, evalRules } = e.data;
  try {
    const t0 = performance.now();
    const ds = generateDataset(sweep, { onProgress: (p) => self.postMessage({ type: "progress", stage: "Generating signals & features", p }) });
    const t1 = performance.now();
    const { train, test } = stratifiedSplit(ds.y, testFrac, sweep.seed + 1);
    const model = trainForest(
      train.map((i) => ds.X[i]),
      train.map((i) => ds.y[i]),
      CLASSES.length,
      { nTrees, maxDepth, seed: sweep.seed + 2, onProgress: (p) => self.postMessage({ type: "progress", stage: "Training random forest", p }) }
    );
    const t2 = performance.now();
    const yTrue = test.map((i) => ds.y[i]);
    const yPred = test.map((i) => {
      const p = forestPredictProba(model, ds.X[i]);
      return p.indexOf(Math.max(...p));
    });
    const forest = evaluate(yTrue, yPred, CLASSES);

    let rules = null;
    if (evalRules) {
      const cache = new Map();
      const pred = test.map((i, n) => {
        const { params, features } = ds.P[i];
        const key = JSON.stringify(params);
        if (!cache.has(key)) cache.set(key, computeBaseline(params));
        const d = RuleClassifier.classify(features, cache.get(key), { rpmSet: params.rpm, ambient: params.ambientTemp });
        if (n % 10 === 0) self.postMessage({ type: "progress", stage: "Evaluating rule engine", p: n / test.length });
        return CLASSES.indexOf(d.label === "combined" ? d.primary : d.label);
      });
      rules = evaluate(yTrue, pred, CLASSES);
    }
    self.postMessage({
      type: "done",
      model,
      forest,
      rules,
      classes: CLASSES,
      featureKeys: ML_FEATURE_KEYS,
      rows: ds.rows,
      nTrain: train.length,
      nTest: test.length,
      timing: { generate: t1 - t0, train: t2 - t1, total: performance.now() - t0 },
      config: { sweep, nTrees, maxDepth, testFrac },
    });
  } catch (err) {
    self.postMessage({ type: "error", message: err.message });
  }
};
