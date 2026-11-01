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
