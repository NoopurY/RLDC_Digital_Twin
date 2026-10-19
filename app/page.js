"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useTwin } from "@/lib/engine/useTwin";
import SoundToggle from "@/components/Shell/SoundToggle";
import { DemoButton } from "@/components/Shell/AppShell";

const MotorTwin = dynamic(() => import("@/components/MotorTwin/MotorTwin"), { ssr: false });

const CONCEPTS = [
  ["Simulate", "Controlled virtual motor behaviour.", "A coupled mechanical–electrical–thermal model of an R–L DC machine generates vibration and current samples. Six fault models reshape those signals with adjustable severity."],
  ["Analyze", "Real DSP signal processing.", "FIR/IIR filtering, windowed FFT, STFT, Welch PSD and envelope demodulation run on every generated sample — nothing on screen is a canned animation."],
  ["Diagnose", "Explainable fault detection.", "Features are compared with the twin’s own healthy reference. Every verdict lists the evidence behind it, and a health index tracks simulated degradation."],
];

export default function Landing() {
  useTwin();
  return (
    <div className="paper min-h-screen">
      <section className="relative h-[100svh] min-h-[620px] overflow-hidden">
        <div className="absolute inset-0">
          <MotorTwin mode="hero" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-canvas via-canvas/75 to-transparent" />

        <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4 md:px-10">
          <span className="display text-[12px] font-bold uppercase tracking-[0.08em]">
            RLDC Motor <span className="text-copper">Digital Twin</span>
          </span>
          <div className="flex items-center gap-2">
            <SoundToggle />
            <DemoButton />
          </div>
        </header>

        <div className="relative z-10 flex h-full flex-col justify-center px-5 md:px-10">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-2xl">
            <h1 className="display text-[48px] font-extrabold uppercase leading-[0.92] tracking-tight sm:text-[72px]">
              RLDC Motor
              <br />
              <span className="text-copper">Digital Twin</span>
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-ink/80">
              A software-defined laboratory for motor fault simulation, DSP analysis and predictive monitoring.
            </p>
            <div className="pointer-events-auto mt-8 flex flex-wrap gap-3">
              <Link
                href="/simulator"
                className="inline-flex h-11 items-center gap-2.5 rounded-[2px] bg-ink px-5 font-mono text-[12px] font-medium uppercase tracking-[0.12em] text-panel hover:bg-ink/90"
              >
                Launch simulator <ArrowRight size={15} />
              </Link>
              <Link
                href="/dsp"
                className="inline-flex h-11 items-center gap-2.5 rounded-[2px] border border-ink/30 px-5 font-mono text-[12px] uppercase tracking-[0.12em] text-ink hover:border-ink"
              >
                Explore DSP
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-5 py-20 md:grid-cols-3 md:px-10">
        {CONCEPTS.map(([t, s, d]) => (
          <div key={t} className="border-t-2 border-ink pt-4">
            <h2 className="display text-[22px] font-bold uppercase">{t}</h2>
            <p className="mt-1 text-[14px] font-medium text-copper">{s}</p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
