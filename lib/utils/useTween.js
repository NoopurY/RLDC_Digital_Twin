"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Animates a number toward `target` with critically-damped-style exponential
 * easing (frame-rate independent). Returns the current animated value.
 */
export function useTween(target, { rate = 6, epsilon = 0.01 } = {}) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  const tgt = useRef(target);
  tgt.current = target;
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) return;
    if (cur.current == null || !Number.isFinite(cur.current)) cur.current = target;
    let raf;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const d = tgt.current - cur.current;
      if (Math.abs(d) < epsilon) {
        cur.current = tgt.current;
        setV(cur.current);
        return;
      }
      cur.current += d * (1 - Math.exp(-dt * rate));
      setV(cur.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, rate, epsilon]);
  return target == null ? target : v;
}

/** Polls a live getter every animation frame (throttled) and eases toward it. */
export function useLiveValue(get, { rate = 8, fps = 30 } = {}) {
  const [v, setV] = useState(0);
  const getRef = useRef(get);
  getRef.current = get;
  useEffect(() => {
    let raf;
    let last = performance.now();
    let lastSet = 0;
    let cur = getRef.current() ?? 0;
    const step = (now) => {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = getRef.current() ?? 0;
      cur += (t - cur) * (1 - Math.exp(-dt * rate));
      if (now - lastSet > 1000 / fps) {
        lastSet = now;
        setV(cur);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [rate, fps]);
  return v;
}
