import { useEffect } from "react";

export const INTRO_KEY = "bloks-intro-v1";
export const INTRO_PLUGINS_KEY = "bloks-intro-plugins";

export function introPending(): boolean {
  try {
    return !localStorage.getItem(INTRO_KEY);
  } catch {
    return false;
  }
}

export function Intro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(INTRO_KEY, String(Date.now()));
      } catch {}
      onDone();
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#080808] text-white"
      aria-label="DIZA AI Personal Assistant"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,0.055),transparent_36%)]" />
      <div className="relative flex -translate-y-2 flex-col items-center px-6 text-center">
        <div className="mb-6 h-px w-9 bg-white/30" />
        <div className="select-none text-[48px] font-[650] leading-[0.92] tracking-[-0.065em] sm:text-[68px]">
          DIZA AI
        </div>
        <div className="mt-5 text-[10px] font-medium uppercase tracking-[0.34em] text-white/48 sm:text-[11px]">
          Personal Assistant
        </div>
        <div className="mt-9 h-px w-16 overflow-hidden bg-white/10">
          <div className="intro-progress h-full w-1/4 bg-white/70" />
        </div>
      </div>
    </div>
  );
}
