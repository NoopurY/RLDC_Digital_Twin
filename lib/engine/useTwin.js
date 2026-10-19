"use client";
import { useEffect, useSyncExternalStore } from "react";
import { engine } from "./twinEngine.js";

const getServerSnapshot = () => null;

/** Subscribe to the engine's analysis snapshots (≈5 Hz). */
export function useTwin() {
  useEffect(() => engine.start(), []);
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot, getServerSnapshot);
}

export { engine };
