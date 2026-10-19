// Mechanical model: shaft load, friction and the speed controller.
//
//   T_load = load·T_rated (+ overload excess) + misalignment coupling reaction
//   T_fric = (c0 + c1·ω)(1 + 0.035·age) + bearing & looseness drag
//   ω_target = min(ω_set·(1 − droop·I/I_rated),  (V·0.97 − I·R)/K_e)   (droop + supply saturation)
//   dω/dt  = (ω_target − ω)/τ_m

import { MOTOR } from "./motorParams.js";

/** Shaft load torque (N·m). An injected overload drives load beyond rating: 15 % → rated, 100 % → 190 %. */
export function loadTorque(params, faults) {
  const baseLoad = params.load / 100;
  const ovl = faults.overload;
  const w = Math.min(1, ovl / 0.15);
  const ramp = w * w * (3 - 2 * w); // smoothstep
  const loadFrac = ovl > 0 ? baseLoad + (Math.max(baseLoad, 1 + 0.9 * ovl) - baseLoad) * ramp : baseLoad;
  return loadFrac * MOTOR.ratedTorque + faults.misalignment * 0.45;
}

/** Friction / drag torque (N·m): speed-dependent, grows with age and mechanical faults. */
export function frictionTorque(params, faults, omega) {
  return (0.18 + 0.00045 * Math.abs(omega)) * (1 + 0.035 * params.age) + faults.bearing * 0.35 + faults.looseness * 0.05;
}

/** Speed controller: proportional droop with supply-voltage saturation. */
export function speedTarget(params, current, resistance, Ke) {
  const omegaSet = (params.rpm * 2 * Math.PI) / 60;
  const omegaDroop = omegaSet * (1 - MOTOR.droop * (current / MOTOR.ratedCurrent));
  const omegaLimit = Math.max(0, (params.voltage * 0.97 - current * resistance) / Ke);
  return { omegaSet, omegaTarget: Math.max(0, Math.min(omegaDroop, omegaLimit)), saturated: omegaLimit < omegaDroop };
}

/** First-order speed dynamics over dt seconds. */
export const stepSpeed = (omega, omegaTarget, dt) => omega + (omegaTarget - omega) * (1 - Math.exp(-dt / MOTOR.mechTau));
