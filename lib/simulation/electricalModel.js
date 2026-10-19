// Electrical model: R–L armature circuit of the DC machine.
//
//   V_a = R_a(T)·I + L_a·dI/dt + K_e·ω      (steady state: L_a·dI/dt → 0)
//   K_t·I = T_load + T_fric                 → I = T / K_t
//   R_a(T) = R_a25·(1 + α_cu·(T − 25))
// A shorted armature coil (electrical fault) lowers the effective K_t = K_e,
// so the same torque needs more current.

import { MOTOR } from "./motorParams.js";

export const torqueConstant = (faults) => MOTOR.Ke * (1 - 0.14 * faults.electrical);

export const armatureResistance = (temp) => MOTOR.Ra25 * (1 + MOTOR.alphaCu * (temp - 25));

export const armatureCurrent = (torque, Kt) => torque / Kt;

/** Terminal quantities for the present speed and current. */
export function armature(current, omega, Ke, R) {
  const backEmf = Ke * omega;
  return { backEmf, armatureVoltage: backEmf + current * R, copperLoss: current * current * R };
}
