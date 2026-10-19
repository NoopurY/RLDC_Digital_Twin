// Thermal model: first-order lumped network.
//
//   P_loss = I²R + T_fric·ω + core loss (+ extra loss from shorted turns)
//   C_th·dT/dt = P_loss − (T − T_amb)/R_th   → T_target = T_amb + R_th·P_loss
// The time constant is compressed (MOTOR.thermalTau) so heating is visible in a demo.

import { MOTOR } from "./motorParams.js";

export function losses({ copperLoss, frictionTorque, omega, faults, current }) {
  const frictionLoss = frictionTorque * Math.abs(omega);
  const coreLoss = 0.00012 * omega * omega + 6 * faults.electrical * (current / MOTOR.ratedCurrent) ** 2 * 10;
  return copperLoss + frictionLoss + coreLoss;
}

export const temperatureTarget = (ambient, pLoss) => ambient + MOTOR.Rth * pLoss;

export const stepTemperature = (temp, target, dt) => temp + (target - temp) * (1 - Math.exp(-dt / MOTOR.thermalTau));
