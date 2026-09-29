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
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-[#08080a] text-white">
      <div className="relative flex flex-col items-center">
        <div className="absolute -inset-24 rounded-full bg-white/[0.035] blur-3xl" />
        <div className="relative select-none text-[54px] font-semibold tracking-[-0.075em] sm:text-[68px]">
          DIZA
        </div>
        <div className="relative mt-3 h-px w-16 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        <div className="relative mt-3 text-[10px] font-medium uppercase tracking-[0.34em] text-white/45">
          Personal AI
        </div>
      </div>
    </div>
  );
}
