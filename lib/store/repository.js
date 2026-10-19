// Storage repository.  Uses MongoDB (Mongoose) when MONGODB_URI is set and
// reachable; otherwise falls back to a local JSON file so the twin runs fully
// offline.  API routes only talk to this module.
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { connectMongo, mongoConfigured } from "../mongodb/connection.js";
import Experiment from "../../models/Experiment.js";
import Scenario from "../../models/Scenario.js";
import SimulationSession from "../../models/SimulationSession.js";

const MODELS = { experiments: Experiment, scenarios: Scenario, sessions: SimulationSession };
const FILE = path.join(process.cwd(), ".data", "store.json");

let lastError = null;

async function backend() {
  if (!mongoConfigured()) return "file";
  try {
    await connectMongo();
    lastError = null;
    return "mongo";
  } catch (e) {
    lastError = e.message;
    return "file";
  }
}

export async function storageStatus() {
  const mode = await backend();
  return { mode, configured: mongoConfigured(), error: lastError };
}

// ── file backend ─────────────────────────────────────────────────────────────
const g = globalThis;
async function readFile() {
  if (g.__twinStore) return g.__twinStore;
  try {
    g.__twinStore = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    g.__twinStore = { experiments: [], scenarios: [], sessions: [] };
  }
  return g.__twinStore;
}
async function writeFile() {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(g.__twinStore));
}

const clean = (doc) => {
  if (!doc) return doc;
  const o = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const { _id, __v, ...rest } = o;
  return { id: String(_id ?? o.id), ...rest };
};

export async function list(col, { limit = 200, fields } = {}) {
  const mode = await backend();
  if (mode === "mongo") {
    const q = MODELS[col].find({}).sort({ createdAt: -1 }).limit(limit);
    if (fields) q.select(fields);
    return (await q.lean()).map(clean);
  }
  const db = await readFile();
  return [...db[col]].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)).slice(0, limit);
}

export async function get(col, id) {
  const mode = await backend();
  if (mode === "mongo") {
    try {
      return clean(await MODELS[col].findById(id).lean());
    } catch {
      return null;
    }
  }
  const db = await readFile();
  return db[col].find((d) => d.id === id) ?? null;
}

export async function create(col, data) {
  const mode = await backend();
  if (mode === "mongo") return clean(await MODELS[col].create(data));
  const db = await readFile();
  const now = new Date().toISOString();
  const doc = { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  db[col].push(doc);
  if (db[col].length > 500) db[col].shift();
  await writeFile();
  return doc;
}

export async function update(col, id, data) {
  const mode = await backend();
  if (mode === "mongo") {
    try {
      return clean(await MODELS[col].findByIdAndUpdate(id, data, { new: true }).lean());
    } catch {
      return null;
    }
  }
  const db = await readFile();
  const i = db[col].findIndex((d) => d.id === id);
  if (i < 0) return null;
  db[col][i] = { ...db[col][i], ...data, id, updatedAt: new Date().toISOString() };
  await writeFile();
  return db[col][i];
}

export async function remove(col, id) {
  const mode = await backend();
  if (mode === "mongo") {
    try {
      return Boolean(await MODELS[col].findByIdAndDelete(id));
    } catch {
      return false;
    }
  }
  const db = await readFile();
  const n = db[col].length;
  db[col] = db[col].filter((d) => d.id !== id);
  await writeFile();
  return db[col].length < n;
}
