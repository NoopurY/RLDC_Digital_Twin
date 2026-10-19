// Plain-language explanations attached to diagnoses: what the signature means
// physically and the recommended maintenance action.  Wording is deliberately
// model-based — the twin works on synthetic signals.

export const FAULT_EXPLANATIONS = {
  healthy: {
    meaning: "Vibration and current match the twin's healthy reference at this operating point.",
    action: "No action. Continue monitoring.",
  },
  imbalance: {
    meaning: "Uneven rotor mass creates a centrifugal force F = m·e·ω² that rotates with the shaft, so energy concentrates at 1× shaft frequency and grows with speed².",
    action: "Schedule dynamic balancing of the rotor; check for lost balance weights or build-up on the fan.",
  },
  bearing: {
    meaning: "Rolling elements strike an outer-race defect at BPFO, producing short impacts that ring the structure — impulsive waveform, high kurtosis and BPFO lines in the envelope spectrum.",
    action: "Plan bearing replacement; verify lubrication and monitor envelope BPFO amplitude for growth.",
  },
  misalignment: {
    meaning: "An angular/parallel offset loads the coupling twice per revolution, so 2× (and 3×) shaft orders rise relative to 1×.",
    action: "Re-align motor and load shafts (laser alignment); inspect coupling insert wear.",
  },
  electrical: {
    meaning: "A shorted armature coil distorts the commutation ripple once per revolution, producing sidebands around N·f_rot and extra current for the same torque.",
    action: "Inspect commutator and brushes; test armature winding insulation and coil resistance.",
  },
  overload: {
    meaning: "Shaft torque exceeds rating: current rises, I²R losses heat the windings and the speed controller droops.",
    action: "Reduce the driven load or re-rate the drive; check for mechanical binding in the load.",
  },
  looseness: {
    meaning: "A loose hold-down bolt makes the support stiffness non-linear: the frame rocks at ½× and the spectrum shows a comb of shaft harmonics.",
    action: "Re-torque mounting bolts and check for soft foot before further running.",
  },
  combined: {
    meaning: "More than one fault signature is present simultaneously.",
    action: "Address the most severe fault first; re-run diagnosis after each repair.",
  },
};

/** Maintenance recommendation from health and diagnosed severity (mirrors engine alert logic). */
export function maintenanceAdvice(health, diagnosis) {
  const sev = diagnosis && diagnosis.label !== "healthy" ? diagnosis.severity : null;
  if (health == null) return null;
  if (health < 40) return { level: "critical", text: "IMMEDIATE ACTION" };
  if (health < 60 || sev === "SEVERE" || (sev === "MODERATE" && health < 75)) return { level: "maintenance", text: "MAINTENANCE RECOMMENDED" };
  if (health < 80) return { level: "watch", text: "CONDITION WATCH" };
  return { level: "ok", text: "NORMAL OPERATION" };
}
