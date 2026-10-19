"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Copy, Trash2, GitCompare, Plus, X, FileJson } from "lucide-react";
import { engine } from "@/lib/engine/useTwin";
import { api, runScenarioOnEngine } from "@/lib/api/client";
import { CLASS_LABELS } from "@/lib/diagnosis/classifier";
import { DEFAULT_PARAMS, EMPTY_FAULTS, FAULT_TYPES } from "@/lib/simulation/motorModel";
import { FAULT_INFO } from "@/lib/simulation/faultModels";
import TrendChart from "@/components/Charts/TrendChart";
import MiniSpectrum from "@/components/Charts/MiniSpectrum";
import { PageHeader, Section, Slider, Btn, Field, EmptyState, Toggle, cx } from "@/components/ui/primitives";
import { timeAgo, downloadText } from "@/lib/utils/format";

const faultSummary = (faults) =>
  Object.entries(faults ?? {})
    .filter(([, v]) => v > 0.005)
    .map(([k, v]) => `${FAULT_INFO[k]?.label ?? k} · ${(v * 100).toFixed(0)}%`)
    .join(", ") || "No faults";

const healthTone = (h) => (h >= 80 ? "text-kinetic" : h >= 40 ? "text-amber" : "text-crimson");

export default function ExperimentsPage() {
  const router = useRouter();
  const [exps, setExps] = useState(null);
  const [scens, setScens] = useState(null);
  const [storage, setStorage] = useState(null);
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState([]);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const [e, sc] = await Promise.all([api.experiments.list(), api.scenarios.list()]);
      setExps(e.items);
      setScens(sc.items);
      setStorage(e.storage);
      setErr(null);
    } catch (x) {
      setErr(x.message);
      setExps([]);
      setScens([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const togglePick = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));
  const replay = (e) => {
    runScenarioOnEngine(engine, { name: e.scenarioName, motorParameters: e.motorParameters, faults: e.faults, seed: e.seed ?? 1 }, { record: false });
    router.push("/simulator");
  };

  return (
    <div className="space-y-12">
      <PageHeader kicker="Experiments" title="Saved simulations">
        Experiments are summaries of recorded runs — configuration, features, diagnosis, health trend and spectrum; raw samples are never stored. Scenarios are reusable
        configurations you can run again with the same seed.
        {storage && <span className="text-dim"> Stored in {storage === "mongo" ? "MongoDB" : "a local file (set MONGODB_URI to use MongoDB)"}.</span>}
      </PageHeader>
      {err && <p className="text-[13px] text-crimson">{err}</p>}

      <div className="grid gap-x-12 gap-y-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Section
          title="Experiment timeline"
          kicker={exps?.length > 1 ? (pick.length ? `${pick.length} of 2 selected for comparison` : "tick two to compare") : undefined}
          actions={
            pick.length === 2 && (
              <Btn size="sm" variant="primary" icon={GitCompare} onClick={() => router.push(`/compare?a=${pick[0]}&b=${pick[1]}`)}>
                Compare selected
              </Btn>
            )
          }
        >
          {exps && exps.length === 0 ? (
            <EmptyState title="No experiments yet" action={<Btn variant="primary" onClick={() => router.push("/simulator")}>Start simulation</Btn>}>
              Run your first motor simulation, then press “Save experiment” to record it.
            </EmptyState>
          ) : (
            <ol className="relative ml-1 border-l border-ink/15 pl-5">
              {(exps ?? []).map((e) => (
                <li key={e.id} className="relative pb-5">
                  <span className={cx("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-canvas", e.diagnosis === "healthy" ? "bg-kinetic" : "bg-crimson")} />
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1.5 accent-[#2F5D46]" checked={pick.includes(e.id)} onChange={() => togglePick(e.id)} aria-label={`Select ${e.scenarioName} for comparison`} />
                    <button onClick={() => setOpen(e)} className="min-w-0 flex-1 text-left">
                      <div className={cx("display truncate text-[14px] font-semibold uppercase tracking-[0.04em]", open?.id === e.id ? "text-copper" : "text-ink")}>{e.scenarioName}</div>
                      <div className="text-[12.5px] text-muted">
                        {CLASS_LABELS[e.diagnosis] ?? e.diagnosis}
                        {e.diagnosis !== "healthy" && ` · ${e.confidence?.toFixed(0)}%`} · {faultSummary(e.faults)}
                      </div>
                      <div className="num text-[11.5px] text-dim">
                        Health <span className={healthTone(e.healthScore)}>{e.healthScore?.toFixed(0)}</span> · {e.motorParameters?.rpm} rpm · {e.simulationDuration} s · {timeAgo(e.createdAt)}
                      </div>
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {open ? (
          <ExperimentDetail
            e={open}
            onClose={() => setOpen(null)}
            onReplay={() => replay(open)}
            onDelete={async () => {
              if (!confirm(`Delete “${open.scenarioName}”?`)) return;
              await api.experiments.remove(open.id);
              setOpen(null);
              setPick((p) => p.filter((x) => x !== open.id));
              load();
            }}
          />
        ) : (
          <Scenarios scens={scens} reload={load} />
        )}
      </div>
    </div>
  );
}

function ExperimentDetail({ e, onClose, onReplay, onDelete }) {
  const f = e.features ?? {};
  return (
    <Section
      title={e.scenarioName}
      kicker={`${new Date(e.createdAt).toLocaleString()} · ${e.source}`}
      actions={
        <>
          <Btn size="sm" icon={Play} onClick={onReplay}>
            Replay in simulator
          </Btn>
          <button onClick={() => downloadText(`experiment_${e.id}.json`, JSON.stringify(e, null, 2), "application/json")} className="text-muted hover:text-ink" title="Download JSON" aria-label="Download JSON">
            <FileJson size={15} />
          </button>
          <button onClick={onDelete} className="text-muted hover:text-crimson" title="Delete" aria-label="Delete experiment">
            <Trash2 size={15} />
          </button>
          <button onClick={onClose} className="text-muted hover:text-ink" title="Close" aria-label="Close">
            <X size={16} />
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <div>
          <div className="label-xs">Diagnosis</div>
          <div className={cx("display text-[20px] font-bold uppercase", e.diagnosis === "healthy" ? "text-kinetic" : "text-crimson")}>{CLASS_LABELS[e.diagnosis] ?? e.diagnosis}</div>
        </div>
        <div>
          <div className="label-xs">Confidence</div>
          <div className="num text-[20px]">{e.confidence?.toFixed(1)}%</div>
        </div>
        <div>
          <div className="label-xs">Health</div>
          <div className={cx("num text-[20px]", healthTone(e.healthScore))}>{e.healthScore?.toFixed(0)}</div>
        </div>
      </div>
      <p className="num mt-2 text-[12px] text-muted">
        {Object.entries(e.motorParameters)
          .map(([k, v]) => `${k} ${typeof v === "number" ? +v.toFixed(1) : v}`)
          .join(" · ")}{" "}
        — {faultSummary(e.faults)}
      </p>
      <div className="label-xs mt-4">Why</div>
      <ul className="mt-1 space-y-0.5">
        {e.evidence?.map((x, i) => (
          <li key={i} className={cx("text-[12.5px]", x.ok ? "text-ink" : "text-dim")}>
            {x.ok ? "✓" : "–"} {x.text}
          </li>
        ))}
      </ul>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="label-xs mb-1">Health during the recording</div>
          <TrendChart data={e.healthTrend} height={140} yDomain={[0, 100]} series={[{ key: "health", label: "Health", color: "#2F5D46", fmt: (v) => v?.toFixed(0) }]} version={e.id} />
        </div>
        <div>
          <div className="label-xs mb-1">Spectrum summary (256 points)</div>
          <MiniSpectrum spectra={[{ spec: e.spectrum, color: "#A8402F", label: "vibration" }]} height={140} />
        </div>
      </div>
      <div className="num mt-4 grid grid-cols-3 gap-3 text-[12px] sm:grid-cols-6">
        {[
          ["RMS", f.rms * 1000, "mg"],
          ["Kurtosis", f.kurtosis, ""],
          ["Crest", f.crestFactor, ""],
          ["1×", f.a1 * 1000, "mg"],
          ["2×/1×", f.a2 / Math.max(f.a1, 1e-6), ""],
          ["HF energy", f.bandEnergyHigh * 100, "%"],
        ].map(([k, v, u]) => (
          <div key={k}>
            <div className="label-xs">{k}</div>
            <div>
              {Number.isFinite(v) ? v.toFixed(v > 10 ? 0 : 2) : "—"} <span className="text-dim">{u}</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const blankScenario = () => ({ name: "", motorParameters: { ...DEFAULT_PARAMS }, faults: { ...EMPTY_FAULTS }, evolution: null, duration: 30, seed: 1 });

function Scenarios({ scens, reload }) {
  const router = useRouter();
  const [form, setForm] = useState(null);
  const [editId, setEditId] = useState(null);
  const [pick, setPick] = useState([]);
  const [cmp, setCmp] = useState(null);

  const save = async () => {
    if (!form.name.trim()) return;
    if (editId) await api.scenarios.update(editId, form);
    else await api.scenarios.create(form);
    setForm(null);
    setEditId(null);
    reload();
  };
  const run = (sc) => {
    runScenarioOnEngine(engine, sc);
    router.push("/simulator");
  };
  const compare = async () => {
    const [a, b] = pick.map((id) => scens.find((x) => x.id === id));
    setCmp({ a, b });
    const r = await api.simulate([a, b].map((sc) => ({ params: sc.motorParameters, faults: sc.faults, seed: sc.seed })));
    setCmp({ a, b, results: r.results });
  };
  const setP = (k, v) => setForm((f) => ({ ...f, motorParameters: { ...f.motorParameters, [k]: v } }));

  return (
    <Section
      title="Scenarios"
      kicker="reusable configurations"
      actions={
        <>
          {pick.length === 2 && (
            <Btn size="sm" icon={GitCompare} onClick={compare}>
              Compare
            </Btn>
          )}
          {!form && (
            <Btn size="sm" icon={Plus} onClick={() => (setForm(blankScenario()), setEditId(null))}>
              New scenario
            </Btn>
          )}
        </>
      }
    >
      {form && (
        <div className="mb-6 border-b border-line pb-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_110px_90px]">
            <Field label="Name">
              <input className="inp" autoFocus value={form.name} placeholder="e.g. Severe bearing failure" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Duration (s)">
              <input className="inp" type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: Number(e.target.value) || 30 })} />
            </Field>
            <Field label="Seed">
              <input className="inp" type="number" value={form.seed} onChange={(e) => setForm({ ...form, seed: Number(e.target.value) || 1 })} />
            </Field>
          </div>
          <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <Slider compact label="RPM" value={form.motorParameters.rpm} min={0} max={3000} step={10} accent="copper" onChange={(v) => setP("rpm", v)} />
            <Slider compact label="Load" value={form.motorParameters.load} min={0} max={100} unit="%" onChange={(v) => setP("load", v)} />
            <Slider compact label="Noise" value={form.motorParameters.noise} min={0} max={100} unit="%" onChange={(v) => setP("noise", v)} />
            <Slider compact label="Age" value={form.motorParameters.age} min={0} max={20} step={0.1} unit="yr" format={(v) => v.toFixed(1)} onChange={(v) => setP("age", v)} />
            {FAULT_TYPES.map((k) => (
              <Slider
                compact
                key={k}
                label={FAULT_INFO[k].label}
                value={Math.round(form.faults[k] * 100)}
                min={0}
                max={100}
                unit="%"
                accent="crimson"
                onChange={(v) => setForm((f) => ({ ...f, faults: { ...f.faults, [k]: v / 100 } }))}
              />
            ))}
          </div>
          <div className="mt-3">
            <Toggle
              checked={!!form.evolution}
              onChange={(on) => setForm({ ...form, evolution: on ? { fault: "bearing", from: 0.05, to: 0.85, duration: Math.min(60, form.duration) } : null })}
              label="Include fault evolution"
            />
            {form.evolution && (
              <div className="mt-2 grid gap-3 sm:grid-cols-4">
                <select className="sel self-end" value={form.evolution.fault} onChange={(e) => setForm({ ...form, evolution: { ...form.evolution, fault: e.target.value } })} aria-label="Evolving fault">
                  {FAULT_TYPES.map((k) => (
                    <option key={k} value={k}>
                      {FAULT_INFO[k].label}
                    </option>
                  ))}
                </select>
                <Slider compact label="From" value={Math.round(form.evolution.from * 100)} min={0} max={100} unit="%" accent="crimson" onChange={(v) => setForm({ ...form, evolution: { ...form.evolution, from: v / 100 } })} />
                <Slider compact label="To" value={Math.round(form.evolution.to * 100)} min={0} max={100} unit="%" accent="crimson" onChange={(v) => setForm({ ...form, evolution: { ...form.evolution, to: v / 100 } })} />
                <Slider compact label="Over" value={form.evolution.duration} min={5} max={300} step={5} unit="s" onChange={(v) => setForm({ ...form, evolution: { ...form.evolution, duration: v } })} />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <Btn variant="primary" onClick={save} disabled={!form.name.trim()}>
              {editId ? "Update scenario" : "Save scenario"}
            </Btn>
            <Btn onClick={() => (setForm(null), setEditId(null))}>Cancel</Btn>
          </div>
        </div>
      )}

      {scens && scens.length === 0 && !form ? (
        <EmptyState title="No scenarios yet" action={<Btn variant="primary" icon={Plus} onClick={() => setForm(blankScenario())}>Create a scenario</Btn>}>
          A scenario stores an operating point, a fault mix and a seed so the same experiment can be reproduced exactly.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {(scens ?? []).map((sc) => (
            <li key={sc.id} className="flex items-start gap-3 py-3">
              <input
                type="checkbox"
                className="mt-1.5 accent-[#2F5D46]"
                checked={pick.includes(sc.id)}
                onChange={() => setPick((p) => (p.includes(sc.id) ? p.filter((x) => x !== sc.id) : [...p.slice(-1), sc.id]))}
                aria-label={`Select ${sc.name}`}
              />
              <button
                className="min-w-0 flex-1 text-left"
                title="Edit scenario"
                onClick={() => {
                  const { id, createdAt, updatedAt, ...rest } = sc;
                  setForm({ ...blankScenario(), ...rest, faults: { ...EMPTY_FAULTS, ...rest.faults } });
                  setEditId(id);
                }}
              >
                <div className="display truncate text-[14px] font-semibold uppercase tracking-[0.04em]">{sc.name}</div>
                <div className="text-[12.5px] text-muted">{faultSummary(sc.faults)}</div>
                <div className="num text-[11.5px] text-dim">
                  {sc.motorParameters.rpm} rpm · {sc.motorParameters.load}% load · {sc.duration} s · seed {sc.seed}
                  {sc.evolution ? ` · evolves ${FAULT_INFO[sc.evolution.fault].label.toLowerCase()}` : ""}
                </div>
              </button>
              <div className="flex shrink-0 gap-1">
                <IconBtn title="Run and record" icon={Play} onClick={() => run(sc)} tone="text-kinetic" />
                <IconBtn
                  title="Duplicate"
                  icon={Copy}
                  onClick={async () => {
                    const { id, createdAt, updatedAt, ...rest } = sc;
                    await api.scenarios.create({ ...rest, name: `${sc.name} (copy)` });
                    reload();
                  }}
                />
                <IconBtn
                  title="Delete"
                  icon={Trash2}
                  tone="hover:text-crimson"
                  onClick={async () => {
                    if (!confirm(`Delete scenario “${sc.name}”?`)) return;
                    await api.scenarios.remove(sc.id);
                    reload();
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {cmp && (
        <div className="mt-6 border-t border-line pt-4">
          <div className="label-xs mb-2">
            {cmp.a.name} vs {cmp.b.name} · headless steady state
          </div>
          {!cmp.results ? (
            <p className="text-[12.5px] text-muted">Simulating…</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {[
                  ["Diagnosis", (r) => CLASS_LABELS[r.diagnosis.label]],
                  ["Health", (r) => r.health.score.toFixed(0)],
                  ["Speed", (r) => `${r.telemetry.rpm.toFixed(0)} rpm`],
                  ["Temperature", (r) => `${r.telemetry.temperature.toFixed(1)} °C`],
                  ["RMS", (r) => `${(r.features.rms * 1000).toFixed(0)} mg`],
                  ["Kurtosis", (r) => r.features.kurtosis.toFixed(2)],
                ].map(([k, g]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 text-muted">{k}</td>
                    {cmp.results.map((r, i) => (
                      <td key={i} className="num text-right text-ink">
                        {g(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Section>
  );
}

function IconBtn({ icon: Icon, onClick, title, tone = "" }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className={cx("p-1.5 text-dim hover:text-ink", tone)}>
      <Icon size={14} />
    </button>
  );
}
