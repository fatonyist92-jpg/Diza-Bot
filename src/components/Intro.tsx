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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#070708] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,0.07),transparent_34%)]" />
      <div className="relative flex -translate-y-3 flex-col items-center">
        <div className="mb-5 h-px w-8 bg-white/35" />
        <div className="select-none text-[58px] font-[650] leading-none tracking-[-0.08em] sm:text-[72px]">
          DIZA
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="h-px w-7 bg-white/15" />
          <span className="text-[9px] font-medium uppercase tracking-[0.42em] text-white/42">
            Personal AI
          </span>
          <span className="h-px w-7 bg-white/15" />
        </div>
        <div className="mt-8 size-1 rounded-full bg-white/65 shadow-[0_0_14px_rgba(255,255,255,0.55)] animate-pulse" />
      </div>
    </div>
  );
}
