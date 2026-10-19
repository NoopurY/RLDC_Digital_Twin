import mongoose from "mongoose";

const ScenarioSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: String,
    motorParameters: { type: Object, required: true },
    faults: { type: Object, required: true },
    evolution: { type: Object }, // optional { fault, from, to, duration }
    duration: { type: Number, default: 30 },
    seed: { type: Number, default: 1 },
  },
  { timestamps: true }
);

export default mongoose.models.Scenario || mongoose.model("Scenario", ScenarioSchema);
