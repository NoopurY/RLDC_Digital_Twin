// Thin browser client for the Next.js route handlers.
async function req(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers ?? {}) } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error ?? `${r.status} ${r.statusText}`);
  return json;
}

export const api = {
  experiments: {
    list: () => req("/api/experiments"),
    get: (id) => req(`/api/experiments/${id}`).then((j) => j.item),
    create: (doc) => req("/api/experiments", { method: "POST", body: JSON.stringify(doc) }).then((j) => j.item),
    remove: (id) => req(`/api/experiments/${id}`, { method: "DELETE" }),
  },
  scenarios: {
    list: () => req("/api/scenarios"),
    create: (doc) => req("/api/scenarios", { method: "POST", body: JSON.stringify(doc) }).then((j) => j.item),
    update: (id, doc) => req(`/api/scenarios/${id}`, { method: "PUT", body: JSON.stringify(doc) }).then((j) => j.item),
    remove: (id) => req(`/api/scenarios/${id}`, { method: "DELETE" }),
  },
  simulate: (runs) => req("/api/simulation", { method: "POST", body: JSON.stringify({ runs }) }),
};

/** Load a scenario into the live engine (reset with its seed) and record it as an experiment. */
export function runScenarioOnEngine(engine, sc, { record = true } = {}) {
  engine.reset(sc.seed ?? 1);
  engine.setParams(sc.motorParameters);
  engine.setFaults(sc.faults, `Scenario "${sc.name}" loaded`, { instant: true });
  if (sc.evolution?.fault) engine.startEvolution({ ...sc.evolution, from: sc.evolution.from ?? sc.faults[sc.evolution.fault] ?? 0 });
  engine.setRunning(true);
  if (record) return engine.startRecording({ name: sc.name, duration: sc.duration ?? 30, scenarioId: sc.id });
  return Promise.resolve(null);
}
