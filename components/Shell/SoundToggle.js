"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { motorSound } from "@/lib/engine/sound";
import { cx } from "@/components/ui/primitives";

/** Sound on/off (browsers require a user gesture before audio can start). */
export default function SoundToggle({ className }) {
  const on = useSyncExternalStore(motorSound.subscribe, () => motorSound.enabled, () => false);
  // Restore the saved preference on the first interaction anywhere on the page.
  useEffect(() => {
    let wanted = false;
    try {
      wanted = localStorage.getItem("rldc-sound") === "1";
    } catch {
      /* ignore */
    }
    if (!wanted || motorSound.enabled) return;
    const arm = () => motorSound.setEnabled(true);
    window.addEventListener("pointerdown", arm, { once: true });
    return () => window.removeEventListener("pointerdown", arm);
  }, []);
  return (
    <button
      onClick={() => motorSound.setEnabled(!on)}
      title={on ? "Mute motor sound" : "Play motor sound"}
      aria-label={on ? "Mute motor sound" : "Play motor sound"}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-[3px] border px-2 font-mono text-[10.5px] uppercase tracking-[0.1em] transition-colors",
        on ? "border-kinetic/60 bg-kinetic/10 text-kinetic" : "border-line text-muted hover:text-ink",
        className
      )}
    >
      {on ? <Volume2 size={13} /> : <VolumeX size={13} />}
      <span className="hidden sm:inline">Sound</span>
    </button>
  );
}
