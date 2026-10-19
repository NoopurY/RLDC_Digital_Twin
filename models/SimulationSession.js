import mongoose from "mongoose";

// A live twin session: configuration + a down-sampled health history.
const SimulationSessionSchema = new mongoose.Schema(
  {
    seed: Number,
    inputMode: String,
    startedAt: Date,
    simTime: Number,
    motorParameters: Object,
    faults: Object,
    dsp: Object,
    faultEvents: [{ t: Number, type: String, message: String }],
    healthHistory: [{ t: Number, health: Number, rms: Number, temp: Number, rpm: Number, label: String }],
    lastDiagnosis: Object,
  },
  { timestamps: true }
);

export default mongoose.models.SimulationSession || mongoose.model("SimulationSession", SimulationSessionSchema);
