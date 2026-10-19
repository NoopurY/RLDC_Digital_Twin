// Shared RLDC motor constants, parameter defaults and fault list.

export const MOTOR = {
  ratedVoltage: 230, // V (DC bus)
  ratedSpeed: 1500, // rpm
  maxSpeed: 3000, // rpm
  Ra25: 2.0, // Ω armature resistance at 25 °C
  La: 0.015, // H armature inductance
  Ke: 0.68, // V·s/rad back-EMF constant (= K_t in SI)
  ratedTorque: 6.0, // N·m at 100 % load
  alphaCu: 0.00393, // 1/°C copper temperature coefficient
  Rth: 0.15, // °C/W housing-to-ambient thermal resistance
  thermalTau: 22, // s — time-compressed thermal time constant (real machines: tens of minutes)
  mechTau: 0.35, // s — speed loop / inertia time constant
  droop: 0.03, // per-unit speed droop at rated current
  commutatorSegments: 12,
  bearing: { balls: 9, dOverD: 0.24, contactDeg: 0 },
};

MOTOR.ratedCurrent = MOTOR.ratedTorque / MOTOR.Ke; // ≈ 8.8 A

/** Bearing defect frequencies as multiples of shaft frequency. */
export function bearingOrders(b = MOTOR.bearing) {
  const c = b.dOverD * Math.cos((b.contactDeg * Math.PI) / 180);
  return {
    bpfo: (b.balls / 2) * (1 - c), // outer race
    bpfi: (b.balls / 2) * (1 + c), // inner race
    ftf: 0.5 * (1 - c), // cage
  };
}

export const DEFAULT_PARAMS = {
  rpm: 1500,
  load: 30, // %
  voltage: 230, // V
  ambientTemp: 25, // °C
  noise: 8, // %
  age: 3.2, // years
  baseVibration: 20, // % background/foundation excitation
};

export const FAULT_TYPES = [
  "imbalance",
  "bearing",
  "misalignment",
  "electrical",
  "overload",
  "looseness",
];

export const EMPTY_FAULTS = Object.fromEntries(FAULT_TYPES.map((f) => [f, 0]));


export const rpmOf = (omega) => (omega * 60) / (2 * Math.PI);
