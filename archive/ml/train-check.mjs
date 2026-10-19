// Trains the Random Forest on a generated dataset and prints held-out metrics.
import { generateDataset, DEFAULT_SWEEP } from "../lib/simulation/dataset.js";
import { trainForest, forestPredictProba, evaluate, stratifiedSplit } from "../lib/diagnosis/randomForest.js";

const t0 = Date.now();
const ds = generateDataset({ ...DEFAULT_SWEEP, windowsPerCombo: 2 });
const t1 = Date.now();
const { train, test } = stratifiedSplit(ds.y, 0.3);
const model = trainForest(train.map((i) => ds.X[i]), train.map((i) => ds.y[i]), ds.classes.length, { nTrees: 40 });
const t2 = Date.now();
const pred = test.map((i) => { const p = forestPredictProba(model, ds.X[i]); return p.indexOf(Math.max(...p)); });
const ev = evaluate(test.map((i) => ds.y[i]), pred, ds.classes);
console.log(`rows ${ds.rows.length}, gen ${t1 - t0} ms, train ${t2 - t1} ms, size ${(JSON.stringify(model).length / 1024).toFixed(0)} KB`);
console.log(`accuracy ${(ev.accuracy * 100).toFixed(1)}%  macroF1 ${(ev.macroF1 * 100).toFixed(1)}%`);
ev.perClass.forEach((c) => console.log(c.name.padEnd(13), (c.precision * 100).toFixed(0), (c.recall * 100).toFixed(0), c.support));
console.log(ev.confusion.map((r) => r.join("\t")).join("\n"));
