"use client";
import { useEffect, useRef, useState } from "react";
import { BrainCircuit, Play, Download, Rocket, Undo2, Grid3x3, ListChecks, BarChart3, Database } from "lucide-react";
import { useTwin, engine } from "@/lib/engine/useTwin";
import { createForestClassifier, RuleClassifier, CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { DEFAULT_SWEEP, toCSV } from "@/lib/simulation/dataset";
import { downloadText } from "@/lib/utils/format";
import { Panel, PageHeader, Btn, Slider, Chip, Segmented, Field, EmptyState, cx } from "@/components/ui/primitives";

// Survives client-side navigation; also mirrored to localStorage.
const store = globalThis.__modelStore ?? (globalThis.__modelStore = { result: null });

export default function ModelPage() {
  const s = useTwin();
  const [cfg, setCfg] = useState({ windows: 3, sevMin: 20, sevMax: 100, nTrees: 40, maxDepth: 12, testFrac: 30, evalRules: true, seed: 2024 });
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(store.result);
  const [which, setWhich] = useState("forest");
  const worker = useRef(null);

  useEffect(() => {
    if (store.result) return;
    try {
      const saved = localStorage.getItem("rldc-model-result");
      if (saved) {
        store.result = JSON.parse(saved);
        setResult(store.result);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    worker.current?.terminate();
    const w = new Worker(new URL("../../lib/workers/train.worker.js", import.meta.url), { type: "module" });
    worker.current = w;
    setProgress({ stage: "Starting", p: 0 });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") setProgress({ stage: m.stage, p: m.p });
      else if (m.type === "error") setProgress({ stage: `Error: ${m.message}`, p: 0, error: true });
      else if (m.type === "done") {
        const r = { ...m, trainedAt: new Date().toISOString() };
        store.result = r;
        setResult(r);
        setProgress(null);
        try {
          localStorage.setItem("rldc-model-result", JSON.stringify({ ...r, rows: undefined }));
        } catch {
          /* quota — model still usable this session */
        }
        w.terminate();
      }
    };
    w.postMessage({
      sweep: { ...DEFAULT_SWEEP, windowsPerCombo: cfg.windows, severityRange: [cfg.sevMin / 100, cfg.sevMax / 100], seed: cfg.seed },
      nTrees: cfg.nTrees,
      maxDepth: cfg.maxDepth,
      testFrac: cfg.testFrac / 100,
      evalRules: cfg.evalRules,
    });
  };

  const nRows = DEFAULT_SWEEP.rpms.length * DEFAULT_SWEEP.loads.length * 7 * cfg.windows;
  const ev = result ? (which === "rules" && result.rules ? result.rules : result.forest) : null;
  const deployed = s?.classifier.id === "forest";

  return (
    <div>
      <PageHeader
        kicker="Classifier layer"
        title="Model performance"
        actions={
          result && (
            <>
              {deployed ? (
                <Btn icon={Undo2} onClick={() => engine.setClassifier(RuleClassifier)}>
                  Revert to rule engine
                </Btn>
              ) : (
                <Btn variant="primary" icon={Rocket} onClick={() => engine.setClassifier(createForestClassifier(result.model))}>
                  Deploy forest to live twin
                </Btn>
              )}
            </>
          )
        }
      >
        A Random Forest is trained on a synthetic dataset produced by the same signal generator and DSP chain as the live twin, then evaluated on a stratified held-out
        split. Every number on this page is computed from that evaluation — nothing is hard-coded. Because train and test data come from the same simulator, these
        metrics measure separability of the simulated fault signatures, not field accuracy on a physical motor.
      </PageHeader>

      <div className="grid gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Panel title="Dataset & training" icon={Database}>
            <div className="space-y-2.5">
              <div className="text-[11.5px] leading-relaxed text-muted">
                Sweep: {DEFAULT_SWEEP.rpms.length} speeds ({DEFAULT_SWEEP.rpms.join(", ")} rpm) × {DEFAULT_SWEEP.loads.length} loads × 7 classes. Voltage, ambient, noise, age
                and base vibration are randomised per window.
              </div>
              <Slider label="Windows per combination" value={cfg.windows} min={1} max={8} onChange={(v) => setCfg({ ...cfg, windows: v })} hint={`${nRows} rows`} />
              <Slider label="Min fault severity" value={cfg.sevMin} min={2} max={90} unit="%" accent="crimson" onChange={(v) => setCfg({ ...cfg, sevMin: Math.min(v, cfg.sevMax - 5) })} />
              <Slider label="Max fault severity" value={cfg.sevMax} min={10} max={100} unit="%" accent="crimson" onChange={(v) => setCfg({ ...cfg, sevMax: Math.max(v, cfg.sevMin + 5) })} />
              <Slider label="Trees" value={cfg.nTrees} min={5} max={120} step={5} onChange={(v) => setCfg({ ...cfg, nTrees: v })} />
              <Slider label="Max depth" value={cfg.maxDepth} min={2} max={20} onChange={(v) => setCfg({ ...cfg, maxDepth: v })} />
              <Slider label="Test split" value={cfg.testFrac} min={10} max={50} unit="%" onChange={(v) => setCfg({ ...cfg, testFrac: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Seed">
                  <input className="inp" type="number" value={cfg.seed} onChange={(e) => setCfg({ ...cfg, seed: Number(e.target.value) || 1 })} />
                </Field>
                <Field label="Rule-engine eval">
                  <select className="sel" value={cfg.evalRules ? "y" : "n"} onChange={(e) => setCfg({ ...cfg, evalRules: e.target.value === "y" })}>
                    <option value="y">Also evaluate</option>
                    <option value="n">Skip</option>
                  </select>
                </Field>
              </div>
              <Btn variant="primary" className="w-full" icon={Play} onClick={run} disabled={!!progress && !progress.error}>
                Generate dataset & train
              </Btn>
              {progress && (
                <div>
                  <div className={cx("text-[11px]", progress.error ? "text-crimson" : "text-muted")}>{progress.stage}…</div>
                  <div className="mt-1 h-[3px] bg-line">
                    <div className="h-full bg-kinetic transition-[width]" style={{ width: `${progress.p * 100}%` }} />
                  </div>
                </div>
              )}
              {result && (
                <div className="space-y-1 border-t border-line pt-2 text-[11px] text-muted">
                  <div className="num">
                    {result.nTrain} train / {result.nTest} test rows · {result.model.trees.length} trees
                  </div>
                  <div className="num">
                    generate {(result.timing.generate / 1000).toFixed(1)}s · train {(result.timing.train / 1000).toFixed(2)}s
                  </div>
                  {result.rows && (
                    <Btn size="sm" icon={Download} onClick={() => downloadText("rldc_synthetic_dataset.csv", toCSV(result.rows), "text/csv")}>
                      Download dataset CSV
                    </Btn>
                  )}
                </div>
              )}
            </div>
          </Panel>
          {result && <Importance result={result} />}
        </div>

        <div className="min-w-0 space-y-3">
          {!result ? (
            <Panel>
              <EmptyState icon={BrainCircuit} title="No model evaluated yet">
                Generate a dataset and train the forest. Metrics appear here only after an actual evaluation run.
              </EmptyState>
            </Panel>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  size="md"
                  value={which}
                  onChange={setWhich}
                  options={[{ value: "forest", label: "Random forest" }, ...(result.rules ? [{ value: "rules", label: "Rule engine" }] : [])]}
                />
                <span className="text-[11px] text-dim">Same held-out test set ({result.nTest} windows) · trained {new Date(result.trainedAt).toLocaleTimeString()}</span>
                {deployed && <Chip tone="ok">Forest live in twin</Chip>}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ["Accuracy", ev.accuracy],
                  ["Macro precision", ev.macroPrecision],
                  ["Macro recall", ev.macroRecall],
                  ["Macro F1", ev.macroF1],
                ].map(([k, v]) => (
                  <div key={k} className="glass rounded-[5px] border border-line p-3">
                    <div className="label-xs">{k}</div>
                    <div className="num mt-1 text-[26px] text-ink">{(v * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 2xl:grid-cols-2">
                <Panel title="Confusion matrix" icon={Grid3x3} sub="rows = true · columns = predicted">
                  <Confusion cm={ev.confusion} classes={result.classes} />
                </Panel>
                <Panel title="Per-class performance" icon={ListChecks}>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="label-xs text-left">
                        <th className="py-1 font-normal">Class</th>
                        <th className="font-normal">Precision</th>
                        <th className="font-normal">Recall</th>
                        <th className="font-normal">F1</th>
                        <th className="text-right font-normal">n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ev.perClass.map((c) => (
                        <tr key={c.name} className="border-t border-line/60">
                          <td className="py-1.5 text-ink/90">{CLASS_LABELS[c.name]}</td>
                          {[c.precision, c.recall, c.f1].map((v, i) => (
                            <td key={i} className="num">
                              <div className="flex items-center gap-2">
                                <span className="w-11">{(v * 100).toFixed(1)}</span>
                                <span className="h-[4px] w-14 bg-canvas-deep">
                                  <span className={cx("block h-full", v > 0.9 ? "bg-kinetic" : v > 0.7 ? "bg-amber" : "bg-crimson")} style={{ width: `${v * 100}%` }} />
                                </span>
                              </div>
                            </td>
                          ))}
                          <td className="num text-right text-dim">{c.support}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Confusion({ cm, classes }) {
  const max = Math.max(...cm.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[3px] text-[11px]">
        <thead>
          <tr>
            <th />
            {classes.map((c) => (
              <th key={c} className="h-16 align-bottom font-normal">
                <div className="mx-auto w-4 origin-bottom-left translate-x-3 -rotate-45 whitespace-nowrap text-left text-[10px] text-muted">{CLASS_LABELS[c]}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cm.map((row, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap pr-2 text-right text-[10.5px] text-muted">{CLASS_LABELS[classes[i]]}</td>
              {row.map((v, j) => {
                const a = v / max;
                const diag = i === j;
                return (
                  <td
                    key={j}
                    className="num h-9 w-11 rounded-[2px] text-center"
                    style={{
                      background: v === 0 ? "#EFE9DC" : diag ? `rgba(107,122,46,${0.15 + 0.75 * a})` : `rgba(181,72,47,${0.2 + 0.7 * a})`,
                      color: v === 0 ? "#B5AD98" : "#2F3320",
                    }}
                    title={`true ${classes[i]} → predicted ${classes[j]}: ${v}`}
                  >
                    {v}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Importance({ result }) {
  const items = result.featureKeys.map((k, i) => [k, result.model.importance[i]]).sort((a, b) => b[1] - a[1]);
  const max = items[0][1] || 1;
  return (
    <Panel title="Feature importance" icon={BarChart3} sub="mean Gini decrease">
      <div className="space-y-1">
        {items.map(([k, v]) => (
          <div key={k} className="flex items-center gap-2">
            <span className="num w-[108px] truncate text-[10.5px] text-muted">{k}</span>
            <span className="h-[5px] flex-1 bg-canvas-deep">
              <span className="block h-full bg-kinetic/80" style={{ width: `${(v / max) * 100}%` }} />
            </span>
            <span className="num w-9 text-right text-[10px] text-dim">{(v * 100).toFixed(1)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
