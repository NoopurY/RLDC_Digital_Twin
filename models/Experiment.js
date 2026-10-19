import mongoose from "mongoose";

// One recorded run of the twin.  Only summaries are stored — never the raw
// high-rate sample stream.
const ExperimentSchema = new mongoose.Schema(
  {
    scenarioName: { type: String, required: true },
    scenarioId: { type: String },
    sessionId: { type: String },
    seed: { type: Number },
    source: { type: String, enum: ["simulation", "external", "headless"], default: "simulation" },
    motorParameters: { type: Object, required: true },
    faults: { type: Object, required: true },
    dsp: { type: Object },
    simulationDuration: { type: Number, default: 0 },
    healthScore: Number,
    healthBand: String,
    healthBreakdown: [{ key: String, label: String, value: Number }],
    diagnosis: String,
    primaryFault: String,
    confidence: Number,
    severity: String,
    classifier: String,
    evidence: [{ ok: Boolean, text: String }],
    features: { type: Object },
    featureVector: [Number],
    telemetry: { type: Object },
    healthTrend: [{ t: Number, health: Number, rms: Number, temp: Number }],
    spectrum: { df: Number, mag: [Number] },
    notes: String,
  },
  { timestamps: true }
);

export default mongoose.models.Experiment || mongoose.model("Experiment", ExperimentSchema);
