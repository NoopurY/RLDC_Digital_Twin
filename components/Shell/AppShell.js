"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Presentation, X, Menu } from "lucide-react";
import { useTwin } from "@/lib/engine/useTwin";
import { startDemo, stopDemo } from "@/lib/engine/demo";
import { fmtTime } from "@/lib/utils/format";
import { cx } from "@/components/ui/primitives";
import SoundToggle from "./SoundToggle";

export const NAV = [
  { href: "/simulator", label: "Simulator" },
  { href: "/fault-lab", label: "Fault Lab" },
  { href: "/dsp", label: "DSP Analysis" },
  { href: "/experiments", label: "Experiments" },
  { href: "/compare", label: "Compare" },
  { href: "/architecture", label: "Architecture" },
];

export function DemoButton({ className }) {
  const router = useRouter();
  return (
    <button
      onClick={() => {
        router.push("/simulator");
        startDemo();
      }}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[2px] border border-copper bg-copper px-2.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-panel hover:bg-copper/90",
        className
      )}
    >
      <Presentation size={12} /> Professor demo
    </button>
  );
}

export default function AppShell({ children }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  if (pathname === "/") return <>{children}<DemoOverlay /></>;

  return (
    <div className="paper min-h-screen">
      <header className="sticky top-0 z-30 border-b border-ink/15 bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-[1680px] items-center gap-6 px-4 lg:px-6">
          <Link href="/" className="display min-w-0 truncate text-[13px] font-bold uppercase tracking-[0.06em] text-ink lg:shrink-0">
            RLDC Motor <span className="text-copper">Digital Twin</span>
          </Link>
          <nav className="hidden h-full items-stretch gap-5 lg:flex">
            {NAV.map(({ href, label }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cx(
                    "flex items-center whitespace-nowrap border-b-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                    active ? "border-copper text-ink" : "border-transparent text-muted hover:text-ink"
                  )}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SoundToggle />
            <span className="hidden sm:block">
              <DemoButton />
            </span>
            <button className="text-muted lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
              <Menu size={18} />
            </button>
          </div>
        </div>
        {open && (
          <nav className="flex flex-col border-t border-line px-4 py-2 lg:hidden">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} className={cx("py-2 font-mono text-[12px] uppercase tracking-[0.12em]", pathname.startsWith(href) ? "text-copper" : "text-muted")}>
                {label}
              </Link>
            ))}
            <DemoButton className="my-2 self-start" />
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1680px] px-4 pb-28 pt-6 lg:px-6">
        <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          {children}
        </motion.div>
      </main>
      <DemoOverlay />
    </div>
  );
}

function DemoOverlay() {
  const s = useTwin();
  const d = s?.demo;
  return (
    <AnimatePresence>
      {d && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="fixed bottom-4 left-1/2 z-50 w-[min(720px,calc(100vw-32px))] -translate-x-1/2"
        >
          <div className="overflow-hidden rounded-[3px] border border-ink/20 bg-panel shadow-[0_12px_40px_-12px_rgb(38_37_34/0.35)]">
            <div className="h-[2px] bg-line">
              <div className="h-full bg-copper transition-[width] duration-300" style={{ width: `${(d.progress ?? 0) * 100}%` }} />
            </div>
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="label-xs !text-copper">Professor demo</span>
                  <span className="num text-[10px] text-dim">
                    {fmtTime(d.elapsed ?? 0)} / {fmtTime(d.total)}
                  </span>
                </div>
                <div className="display mt-0.5 text-[15px] font-semibold text-ink">{d.title}</div>
                <div className="text-[12.5px] leading-relaxed text-muted">{d.caption}</div>
              </div>
              <button onClick={stopDemo} className="text-dim hover:text-ink" aria-label="Close demo">
                <X size={16} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
