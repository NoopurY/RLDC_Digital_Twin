// RLDC motor model: composes the mechanical, electrical and thermal sub-models
// into one coupled operating point.
//
// Load ↑ → torque demand ↑ → current ↑ → I²R loss ↑ → temperature ↑ →
// resistance ↑ → controller headroom ↓ → speed droop ↑.  None of these
// quantities are independent random numbers; they all follow from the
// parameters and the fault state.

import { MOTOR } from "./motorParams.js";
import { loadTorque, frictionTorque, speedTarget, stepSpeed } from "./mechanicalModel.js";
import { torqueConstant, armatureResistance, armatureCurrent, armature } from "./electricalModel.js";
import { losses, temperatureTarget, stepTemperature } from "./thermalModel.js";

export * from "./motorParams.js";

/**
 * Quasi-static operating point for a given speed state and temperature.
 * Returns every derived electrical/mechanical quantity used by the signal models.
 */
export function operatingPoint(params, faults, omega, temp) {
  const running = params.rpm > 1;
  const Kt = torqueConstant(faults);
  const Ke = Kt;
  const tLoad = loadTorque(params, faults);
  const tFric = running ? frictionTorque(params, faults, omega) : 0;
  const torque = running ? tLoad + tFric : 0;
  const current = running ? armatureCurrent(torque, Kt) : 0;
  const R = armatureResistance(temp);
  const sp = speedTarget(params, current, R, Ke);
  const omegaTarget = running ? sp.omegaTarget : 0;
  const { backEmf, armatureVoltage, copperLoss } = armature(current, omega, Ke, R);
  const pLoss = losses({ copperLoss, frictionTorque: tFric, omega, faults, current });
  const pIn = armatureVoltage * current;
  const pOut = tLoad * Math.abs(omega);
  return {
    omegaTarget,
    omegaSet: sp.omegaSet,
    saturated: running && sp.saturated,
    current,
    torque,
    loadTorque: tLoad,
    frictionTorque: tFric,
    resistance: R,
    backEmf,
    armatureVoltage,
    duty: Math.min(1, armatureVoltage / Math.max(params.voltage, 1)),
    pLoss,
    pIn,
    pOut,
    efficiency: pIn > 1 ? pOut / pIn : 0,
    tempTarget: temperatureTarget(params.ambientTemp, pLoss),
  };
}

/** Advance mechanical and thermal states by dt seconds (first-order dynamics). */
export function stepMotorState(state, params, faults, dt) {
  const op = operatingPoint(params, faults, state.omega, state.temp);
  state.omega = stepSpeed(state.omega, op.omegaTarget, dt);
  state.temp = stepTemperature(state.temp, op.tempTarget, dt);
  return operatingPoint(params, faults, state.omega, state.temp);
}

/** Fixed-point solution for the steady state (used by What-If and dataset generation). */
export function steadyState(params, faults) {
  let omega = (params.rpm * 2 * Math.PI) / 60;
  let temp = params.ambientTemp;
  let op;
  for (let i = 0; i < 60; i++) {
    op = operatingPoint(params, faults, omega, temp);
    omega = op.omegaTarget;
    temp = op.tempTarget;
  }
  op = operatingPoint(params, faults, omega, temp);
  return { omega, temp, op };
}

export function createMotorState(params, faults, { steady = false } = {}) {
  if (steady) {
    const s = steadyState(params, faults);
    return { omega: s.omega, temp: s.temp };
  }
  return { omega: 0, temp: params.ambientTemp };
}

