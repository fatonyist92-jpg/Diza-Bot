/**
 * FREE_ONLY voice runtime.
 *
 * Speech input/output stays on the device/browser surface. The model only
 * receives ordinary text turns, so changing an LLM provider never changes
 * who owns voice state, memory or identity.
 */
export interface RecognitionHandlers {
  onPartial(text: string): void;
  onFinal(text: string): void;
  onSilence(): void;
  onError(message: string): void;
  onLevel?(level: number): void;
}

export interface RecognitionSession {
  stop(): void;
  needsManualFinish: boolean;
}

export interface SystemVoice {
  provider: "system";
  id: string;
  name: string;
  lang?: string;
  localService?: boolean;
}

export interface SpeechPlayback {
  stop(): void;
  done: Promise<void>;
}

function recognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}

export function browserRecognitionAvailable(): boolean {
  return Boolean(recognitionCtor());
}

/**
 * Desktop prefers the app-owned native helper. Web/PWA falls back to the
 * browser's speech recognizer when the browser exposes one. Neither path
 * needs a paid speech API key.
 */
export function startFreeRecognition(handlers: RecognitionHandlers): RecognitionSession | null {
  if (typeof window === "undefined") return null;
  const bridge = window.bloks;
  if (bridge?.speechStart && bridge?.onSpeechTranscript) {
    let stopped = false;
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (stopped) return;
      if (typeof line.level === "number") {
        handlers.onLevel?.(Math.max(0, Math.min(1, line.level)));
        return;
      }
      if (typeof line.error === "string") {
        handlers.onError(line.error);
        return;
      }
      if (typeof line.text === "string") {
        handlers.onPartial(line.text);
        if (line.partial === false) handlers.onFinal(line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd?.(({ code }) => {
      if (stopped) return;
      if (code && code !== 0) handlers.onError("recognition-error");
    });
    void bridge.speechStart().catch(() => handlers.onError("mic-failed"));
    return {
      needsManualFinish: true,
      stop: () => {
        if (stopped) return;
        stopped = true;
        offTranscript?.();
        offEnd?.();
        void bridge.speechStop?.().catch(() => {});
      },
    };
  }

  const Recognition = recognitionCtor();
  if (!Recognition) return null;
  const recog = new Recognition();
  let stopped = false;
  let finalized = false;
  recog.continuous = false;
  recog.interimResults = true;
  recog.onresult = (event: any) => {
    if (stopped) return;
    const result = event.results[event.results.length - 1];
    const text = String(result?.[0]?.transcript ?? "");
    if (!text) return;
    handlers.onPartial(text);
    if (result.isFinal && !finalized) {
      finalized = true;
      handlers.onFinal(text);
      try { recog.stop(); } catch {}
    }
  };
  recog.onerror = (event: any) => {
    if (stopped) return;
    if (event?.error === "no-speech") handlers.onSilence();
    else handlers.onError(`browser:${String(event?.error ?? "recognition-error")}`);
  };
  try {
    recog.start();
  } catch {
    handlers.onError("mic-failed");
    return null;
  }
  return {
    needsManualFinish: false,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try { recog.stop(); } catch {}
    },
  };
}

export function systemSpeechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

export function listSystemVoices(): SystemVoice[] {
  if (!systemSpeechAvailable()) return [];
  return window.speechSynthesis
    .getVoices()
    .map((voice) => ({
      provider: "system" as const,
      id: voice.voiceURI || voice.name,
      name: voice.name,
      lang: voice.lang || undefined,
      localService: voice.localService,
    }))
    .sort((a, b) => Number(Boolean(b.localService)) - Number(Boolean(a.localService)) || a.name.localeCompare(b.name));
}

export function onSystemVoicesChanged(callback: () => void): () => void {
  if (!systemSpeechAvailable()) return () => {};
  const synth = window.speechSynthesis;
  const handler = () => callback();
  synth.addEventListener?.("voiceschanged", handler);
  return () => synth.removeEventListener?.("voiceschanged", handler);
}

/** Visual markdown is noisy when spoken; flatten the common pieces locally. */
export function spokenText(text: string): string {
  let out = text;
  out = out.replace(/```(\w*)[^`]*```/g, (_all, lang: string) =>
    lang ? ` there is a ${lang} code block here ` : " there is a code block here ",
  );
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_a, alt: string) => (alt ? ` an image: ${alt} ` : " an image "));
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  out = out.replace(/https?:\/\/\S+/g, " a link ");
  out = out.replace(/`([^`]+)`/g, (_a, code: string) => (code.length <= 40 ? code : " a code snippet "));
  out = out.replace(/^#{1,6}\s*(.+)$/gm, "$1.");
  out = out.replace(/^\s*[-*+]\s+/gm, "");
  out = out.replace(/^\s*\d+\.\s+/gm, "");
  out = out.replace(/^\s*>\s?/gm, "");
  out = out.replace(/(\*\*|__|\*|_|~~)/g, "");
  out = out.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "");
  out = out.replace(/\n{2,}/g, ". ").replace(/\n/g, ". ").replace(/\s{2,}/g, " ").trim();
  return /[\p{L}\p{N}]/u.test(out) ? out : "";
}

/**
 * Device/browser TTS. No network vendor endpoint is called by DIZA.
 * `stop()` always resolves `done`, so barge-in cannot strand the call loop.
 */
export function playSystemSpeech(text: string, voiceId?: string | null): SpeechPlayback | null {
  if (!systemSpeechAvailable()) return null;
  const spoken = spokenText(text);
  if (!spoken) return null;
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(spoken);
  const chosen = synth.getVoices().find((voice) => voice.voiceURI === voiceId || voice.name === voiceId);
  if (chosen) {
    utterance.voice = chosen;
    if (chosen.lang) utterance.lang = chosen.lang;
  }
  let resolveDone!: () => void;
  let settled = false;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const settle = () => {
    if (settled) return;
    settled = true;
    resolveDone();
  };
  utterance.onend = settle;
  utterance.onerror = settle;
  synth.speak(utterance);
  return {
    done,
    stop: () => {
      try { synth.cancel(); } catch {}
      settle();
    },
  };
}
