// How an agent sounds, and the call you have with it.
//
// VoiceCard is the picker in agent settings: system/browser voices only,
// with a one-tap preview and no paid speech API.
//
// CallOverlay is the call itself: a loop of listen → think → speak.
// Your words go through speech recognition and become an ordinary turn;
// the reply comes back as ordinary text and is synthesized by the current
// device/browser; when the audio ends, the mic
// opens again. The transcript is just the chat, a call leaves the same
// record a typed conversation would.
import { useCallback, useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import MicOff from "lucide-react/dist/esm/icons/mic-off.mjs";
import Phone from "lucide-react/dist/esm/icons/phone.mjs";
import PhoneOff from "lucide-react/dist/esm/icons/phone-off.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { BLOK_COLORS, type BlokColor } from "@/lib/mascot";
import { AgentAvatar } from "./Avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { routeSpokenToRoom } from "@/lib/spokenRouting";
import { thisComputer } from "@/lib/thisComputer";
import {
  listSystemVoices,
  onSystemVoicesChanged,
  playSystemSpeech,
  startFreeRecognition,
  systemSpeechAvailable,
  type RecognitionSession,
  type SpeechPlayback,
  type SystemVoice,
} from "@/lib/localVoice";

type VoiceOption = SystemVoice;

const PREVIEW_LINE = "Hi, this is how I sound. Ready when you are.";

function voiceId(bot: { voice?: { provider: string; id: string } | null }): string | null {
  return bot.voice?.provider === "system" ? bot.voice.id : null;
}

/** The call lease: one device on the line at a time, workspace-wide.
 * Claim before the mic opens; renew on a timer; release on hang-up. A
 * claim that fails names the device already talking. */
export async function claimCall(targetId: string): Promise<
  { ok: true; token: string; stop: () => void } | { ok: false; reason: string }
> {
  try {
    const r = await api("/api/calls/claim", {
      method: "POST",
      body: JSON.stringify({ targetId, device: thisComputer() }),
    });
    const token: string = r.token;
    const timer = setInterval(() => {
      api("/api/calls/renew", { method: "POST", body: JSON.stringify({ token }) }).catch(() => {});
    }, Math.max(4000, (r.ttlMs ?? 20000) / 3));
    return {
      ok: true,
      token,
      stop: () => {
        clearInterval(timer);
        void api("/api/calls", { method: "DELETE", body: JSON.stringify({ token }) }).catch(
          () => {},
        );
      },
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** True while a call owns the speaker and the mic. */
let callActive = false;
export function setCallActive(on: boolean) {
  callActive = on;
}

let autoAudio: SpeechPlayback | null = null;

/** A settled reply read aloud, when its agent opted in. One clip at a
 * time; a newer reply replaces an older one still playing; calls own
 * the speaker outright. */
export function maybeAutoSpeak(
  bot: { id: string; voice?: unknown; speakReplies?: boolean },
  text: string,
) {
  const selected = bot.voice as { provider?: string; id?: string } | null | undefined;
  if (!bot.speakReplies || selected?.provider !== "system" || callActive) return;
  autoAudio?.stop();
  const playback = playSystemSpeech(text, selected.id ?? null);
  if (!playback) return;
  if (callActive) { playback.stop(); return; }
  autoAudio = playback;
  void playback.done.finally(() => {
    if (autoAudio === playback) autoAudio = null;
  });
}

/** The voice picker card in agent settings. */
export function VoiceCard({ bot }: { bot: Bot }) {
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const configured = systemSpeechAvailable();

  useEffect(() => {
    if (!open) return;
    const refresh = () => setVoices(listSystemVoices());
    refresh();
    return onSystemVoicesChanged(refresh);
  }, [open]);

  const choose = (voice: VoiceOption | null) => {
    setError(null);
    api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ voice }) }).catch(
      (e: Error) => setError(e.message),
    );
  };

  const preview = () => {
    if (previewing) return;
    setPreviewing(true);
    const playback = playSystemSpeech(PREVIEW_LINE, voiceId(bot));
    if (!playback) {
      setError("This device/browser has no local speech output available.");
      setPreviewing(false);
      return;
    }
    void playback.done.finally(() => setPreviewing(false));
  };

  const legacy = bot.voice && bot.voice.provider !== "system";
  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen(!open)}>
        <div>
          <div className="text-[13.5px] font-semibold text-foreground">Voice</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {!configured
              ? "This device/browser has no system speech output."
              : legacy
                ? "Voice berbayar lama tersimpan tetapi dinonaktifkan. Pilih voice perangkat untuk mode GRATIS."
                : bot.voice
                  ? `Speaks as ${bot.voice.name ?? bot.voice.id} · local/device voice`
                  : "Pilih voice perangkat. Tidak ada API suara berbayar yang digunakan."}
          </div>
        </div>
        <span className="text-[12px] text-muted-foreground">{open ? "Hide" : "Choose"}</span>
      </button>

      {open && (
        <div className="mt-3">
          {bot.voice && !legacy && (
            <div className="mb-2 flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={preview} disabled={previewing}>
                <Volume2 size={13} />
                {previewing ? "Playing…" : "Preview"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => choose(null)}>Hapus voice</Button>
              <label className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bot.speakReplies ?? false}
                  onChange={(e) =>
                    api(`/api/bots/${bot.id}`, {
                      method: "PATCH",
                      body: JSON.stringify({ speakReplies: e.target.checked }),
                    }).catch(() => {})
                  }
                  className="accent-[--brand]"
                />
                Read replies aloud
              </label>
            </div>
          )}
          {legacy && (
            <Button size="sm" variant="secondary" className="mb-2" onClick={() => choose(null)}>
              Clear legacy paid voice
            </Button>
          )}
          <div className="flex max-h-[240px] flex-col gap-0.5 overflow-y-auto">
            {voices === null && !error && <div className="py-3 text-[12.5px] text-muted-foreground">Loading device voices…</div>}
            {voices?.length === 0 && <div className="py-3 text-[12.5px] text-muted-foreground">No device voices are exposed by this browser/OS.</div>}
            {(voices ?? []).map((voice) => {
              const active = bot.voice?.provider === "system" && bot.voice?.id === voice.id;
              return (
                <button
                  key={voice.id}
                  onClick={() => choose(voice)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-150",
                    active ? "bg-brand-soft" : "hover:bg-accent",
                  )}
                >
                  <span className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full",
                    active ? "bg-brand-ink text-brand-foreground" : "border",
                  )}>
                    {active && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{voice.name}</span>
                    {voice.lang && <span className="block text-[10.5px] text-muted-foreground">{voice.lang}{voice.localService ? " · on-device" : ""}</span>}
                  </span>
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Device</span>
                </button>
              );
            })}
          </div>
          {error && <div className="mt-2 text-[12px] text-destructive">{error}</div>}
        </div>
      )}
    </div>
  );
}

type CallState = "listening" | "transcribing" | "thinking" | "speaking" | "idle";

/**
 * The call. Speech recognition prefers the browser engine (it endpoints
 * on silence, which is what makes the loop hands-free); inside the
 * desktop shell it falls back to the native dictation bridge with a
 * tap-to-finish control.
 */
export function CallOverlay({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const { dispatch } = useStore();
  const [callState, setCallState] = useState<CallState>("idle");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsManualFinish, setNeedsManualFinish] = useState(false);
  const audioRef = useRef<SpeechPlayback | null>(null);
  const recogRef = useRef<RecognitionSession | null>(null);
  const baselineCount = useRef(bot.messages.length);
  const live = useRef(true);
  const mutedRef = useRef(false);
  const heardRef = useRef("");
  const botRef = useRef(bot);
  botRef.current = bot;

  const stopRecognition = () => {
    recogRef.current?.stop();
    recogRef.current = null;
    setNeedsManualFinish(false);
  };

  const stopAudio = () => {
    audioRef.current?.stop();
    audioRef.current = null;
  };

  const finishUtterance = (text: string) => {
    stopRecognition();
    const said = text.trim();
    if (!said) {
      if (!mutedRef.current) listen();
      return;
    }
    baselineCount.current = botRef.current.messages.length;
    setCallState("thinking");
    dispatch({ type: "send", botId: botRef.current.id, text: said });
  };

  const listen = useCallback(() => {
    if (!live.current || mutedRef.current) {
      setCallState("idle");
      return;
    }
    stopRecognition();
    setHeard("");
    heardRef.current = "";
    setError(null);
    setCallState("listening");
    const session = startFreeRecognition({
      onPartial: (text) => {
        setHeard(text);
        heardRef.current = text;
      },
      onFinal: (text) => finishUtterance(text),
      onSilence: () => {
        stopRecognition();
        if (live.current && !mutedRef.current) setTimeout(() => listen(), 120);
      },
      onError: (message) => {
        stopRecognition();
        setCallState("idle");
        setError(message.startsWith("browser:") ? `microphone: ${message.slice(8)}` : message);
      },
    });
    recogRef.current = session;
    setNeedsManualFinish(Boolean(session?.needsManualFinish));
    if (!session) {
      setCallState("idle");
      setError("No free microphone recognition is available on this device/browser.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The reply is still an ordinary chat message. Only playback is voice-specific.
  useEffect(() => {
    if (callState !== "thinking") return;
    const fresh = bot.messages.slice(baselineCount.current);
    const reply = [...fresh].reverse().find((m) => m.role === "bot" && m.kind === "text" && m.text);
    if (!reply?.text || bot.busy) return;
    setCallState("speaking");
    const playback = playSystemSpeech(reply.text, voiceId(bot));
    if (!playback) {
      setError("Output suara lokal tidak tersedia; balasan tetap ada di chat.");
      if (!mutedRef.current) listen();
      else setCallState("idle");
      return;
    }
    audioRef.current = playback;
    void playback.done.finally(() => {
      if (audioRef.current === playback) audioRef.current = null;
      if (!live.current) return;
      if (mutedRef.current) setCallState("idle");
      else listen();
    });
  }, [bot.messages, bot.busy, callState, bot.id, listen]);

  const lease = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setCallActive(true);
    void claimCall(bot.id).then((claim) => {
      if (!claim.ok) {
        setError(claim.reason);
        setCallState("idle");
        return;
      }
      lease.current = claim;
      if (live.current && !mutedRef.current) listen();
    });
    return () => {
      setCallActive(false);
      live.current = false;
      stopRecognition();
      stopAudio();
      lease.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listen]);

  const hangUp = () => {
    live.current = false;
    stopRecognition();
    stopAudio();
    lease.current?.stop();
    lease.current = null;
    onClose();
  };

  /** Barge in works while Diza is speaking or still generating. */
  const bargeIn = () => {
    stopAudio();
    if (botRef.current.busy) dispatch({ type: "interrupt", botId: botRef.current.id });
    listen();
  };

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopRecognition();
      if (callState === "listening") setCallState("idle");
    } else if (callState === "idle") {
      listen();
    }
  };

  const stateLabel =
    muted && callState !== "speaking" && callState !== "thinking"
      ? "Microphone muted"
      : callState === "listening"
        ? heard || "Listening…"
        : callState === "thinking"
          ? "Thinking…"
          : callState === "speaking"
            ? "Speaking"
            : "";

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <span className="absolute right-5 top-5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-success">
        FREE_ONLY
      </span>
      <div className="flex flex-col items-center gap-5">
        <div
          className={cn(
            "rounded-full p-2 transition-shadow duration-500",
            callState === "listening" && "shadow-[0_0_0_10px_color-mix(in_srgb,var(--brand)_14%,transparent)]",
            callState === "speaking" && "call-speaking-ring",
          )}
          style={{ "--ring-tint": BLOK_COLORS[bot.color as BlokColor] } as React.CSSProperties}
        >
          <AgentAvatar bot={bot} size={132} />
        </div>
        <div className="text-center">
          <div className="text-[19px] font-semibold text-foreground">{bot.name}</div>
          <div className="mt-1 min-h-[20px] max-w-[340px] px-4 text-[13.5px] text-muted-foreground">
            {error ?? stateLabel}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4">
          {(callState === "speaking" || callState === "thinking") && !muted && (
            <button
              onClick={bargeIn}
              title="Interrupt and talk"
              className="flex size-14 items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition-transform active:scale-95"
            >
              <Mic size={20} />
            </button>
          )}
          <button
            onClick={toggleMute}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            className={cn(
              "flex size-14 items-center justify-center rounded-full border shadow-sm transition-transform active:scale-95",
              muted ? "bg-warning/15 text-warning" : "bg-card text-foreground",
            )}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          {needsManualFinish && callState === "listening" && !muted && (
            <Button
              variant="secondary"
              onClick={() => finishUtterance(heardRef.current)}
            >
              Done talking
            </Button>
          )}
          <button
            onClick={hangUp}
            title="End call"
            className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-transform active:scale-95"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The header affordance: appears once the agent can actually speak. */
export function CallButton({ bot }: { bot: Bot }) {
  const [calling, setCalling] = useState(false);
  if (bot.voice?.provider !== "system") return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={`Call ${bot.name}`}
        aria-label={`Call ${bot.name}`}
        onClick={() => setCalling(true)}
      >
        <Phone size={16} />
      </Button>
      {calling && <CallOverlay bot={bot} onClose={() => setCalling(false)} />}
    </>
  );
}



/**
 * A room on the line. The room's own turn engine decides who answers;
 * this overlay routes your spoken address ("Kat, …" → "@Kat …"), then
 * speaks each fresh reply in arrival order, each in its own member's
 * voice. Strictly one voice at a time, a FIFO, not a mixer, and the
 * mic reopens only when the queue drains and the room has gone quiet.
 * Members without a voice still answer; their replies show as text in
 * the caption instead of being spoken.
 */
export function GroupCallOverlay({
  blok,
  members,
  onClose,
}: {
  blok: { id: string; name: string; messages: Message[] };
  members: Bot[];
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const [callState, setCallState] = useState<CallState>("idle");
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [needsManualFinish, setNeedsManualFinish] = useState(false);
  const audioRef = useRef<SpeechPlayback | null>(null);
  const recogRef = useRef<RecognitionSession | null>(null);
  const heardRef = useRef("");
  const baseline = useRef(blok.messages.length);
  const spoken = useRef(new Set<string>());
  const callStateRef = useRef<CallState>("idle");
  const botsRef = useRef(state.bots);
  botsRef.current = state.bots;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const live = useRef(true);
  const mutedRef = useRef(false);

  const liveMembers = state.bots.filter((b) => members.some((m) => m.id === b.id));
  const anyBusy = liveMembers.some((m) => m.busy);

  const stopRecognition = () => {
    recogRef.current?.stop();
    recogRef.current = null;
    setNeedsManualFinish(false);
  };

  const stopAudio = () => {
    audioRef.current?.stop();
    audioRef.current = null;
  };

  const finishUtterance = (text: string) => {
    stopRecognition();
    const said = text.trim();
    if (!said) {
      if (!mutedRef.current) listen();
      return;
    }
    baseline.current = blok.messages.length;
    setCallState("thinking");
    callStateRef.current = "thinking";
    dispatch({
      type: "sendToRoom",
      blokId: blok.id,
      text: routeSpokenToRoom(said, members.map((m) => m.name)),
    });
  };

  const listen = useCallback(() => {
    if (!live.current || mutedRef.current) {
      setCallState("idle");
      callStateRef.current = "idle";
      return;
    }
    stopRecognition();
    setHeard("");
    heardRef.current = "";
    setSpeakingId(null);
    setError(null);
    setCallState("listening");
    callStateRef.current = "listening";
    const session = startFreeRecognition({
      onPartial: (text) => {
        setHeard(text);
        heardRef.current = text;
      },
      onFinal: (text) => finishUtterance(text),
      onSilence: () => {
        stopRecognition();
        if (live.current && !mutedRef.current) setTimeout(() => listen(), 120);
      },
      onError: (message) => {
        stopRecognition();
        setCallState("idle");
        callStateRef.current = "idle";
        setError(message.startsWith("browser:") ? `microphone: ${message.slice(8)}` : message);
      },
    });
    recogRef.current = session;
    setNeedsManualFinish(Boolean(session?.needsManualFinish));
    if (!session) {
      setCallState("idle");
      callStateRef.current = "idle";
      setError("No free microphone recognition is available on this device/browser.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every fresh settled reply queues in order, spoken locally in its member's system voice.
  useEffect(() => {
    if (callState !== "thinking" && callState !== "speaking") return;
    const room = state.bloks.find((r) => r.id === blok.id);
    if (!room) return;
    const fresh = room.messages
      .slice(baseline.current)
      .filter((m) => m.role === "bot" && m.kind === "text" && m.text && !spoken.current.has(m.id));
    for (const message of fresh) {
      spoken.current.add(message.id);
      const speaker = liveMembers.find((b) => b.id === message.from);
      const gen = generation.current;
      queue.current = queue.current
        .catch(() => {})
        .then(async () => {
          if (!live.current || gen !== generation.current) return;
          setCallState("speaking");
          callStateRef.current = "speaking";
          setSpeakingId(speaker?.id ?? null);
          setCaption(`${speaker?.name ?? "Agent"}: ${message.text!.slice(0, 120)}`);
          if (speaker?.voice?.provider === "system") {
            const playback = playSystemSpeech(message.text!, speaker.voice.id);
            if (playback) {
              audioRef.current = playback;
              await playback.done;
              if (audioRef.current === playback) audioRef.current = null;
            }
          } else {
            // Voiceless or legacy-paid members remain visible as captions.
            await new Promise((r) => setTimeout(r, Math.min(4000, 1200 + message.text!.length * 25)));
          }
        });
    }
    const gen = generation.current;
    queue.current = queue.current.catch(() => {}).then(() => {
      if (!live.current || gen !== generation.current) return;
      if (callStateRef.current === "listening") return;
      const stillBusy = botsRef.current.some(
        (b) => members.some((m) => m.id === b.id) && b.busy,
      );
      if (!stillBusy) {
        if (mutedRef.current) {
          setCallState("idle");
          callStateRef.current = "idle";
        } else {
          listen();
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.bloks, state.bots, callState]);

  const lease = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setCallActive(true);
    for (const m of blok.messages) spoken.current.add(m.id);
    void claimCall(blok.id).then((claim) => {
      if (!claim.ok) {
        setError(claim.reason);
        return;
      }
      lease.current = claim;
      if (live.current && !mutedRef.current) listen();
    });
    return () => {
      setCallActive(false);
      live.current = false;
      generation.current += 1;
      stopRecognition();
      stopAudio();
      lease.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const interrupt = () => {
    generation.current += 1;
    queue.current = Promise.resolve();
    stopAudio();
    if (anyBusy) {
      for (const member of liveMembers.filter((candidate) => candidate.busy)) {
        dispatch({ type: "interrupt", botId: member.id });
      }
    }
    if (!mutedRef.current) listen();
  };

  const toggleMute = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    if (next) {
      stopRecognition();
      if (callState === "listening") {
        setCallState("idle");
        callStateRef.current = "idle";
      }
    } else if (callState === "idle") {
      listen();
    }
  };

  const hangUp = () => {
    live.current = false;
    generation.current += 1;
    stopRecognition();
    stopAudio();
    lease.current?.stop();
    lease.current = null;
    onClose();
  };

  const stateLabel =
    muted && callState !== "speaking" && callState !== "thinking"
      ? "Microphone muted"
      : callState === "listening"
        ? heard || "Listening. Say a name or just talk."
        : callState === "thinking"
          ? "The room is thinking…"
          : caption;

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
      <span className="absolute right-5 top-5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-success">
        FREE_ONLY
      </span>
      <div className="flex flex-col items-center gap-6">
        <div className="flex items-end gap-3">
          {liveMembers.map((member) => {
            const focused = speakingId === member.id || (speakingId === null && member.busy);
            return (
              <div
                key={member.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 transition-all duration-300",
                  focused ? "scale-110" : "opacity-70",
                )}
              >
                <div
                  className={cn("rounded-full", speakingId === member.id && "call-speaking-ring")}
                  style={{ "--ring-tint": BLOK_COLORS[member.color as BlokColor] } as React.CSSProperties}
                >
                  <AgentAvatar bot={member} size={focused ? 76 : 60} />
                </div>
                <span className="text-[11.5px] font-medium text-muted-foreground">{member.name}</span>
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <div className="text-[18px] font-semibold text-foreground">{blok.name}</div>
          <div className="mt-1 min-h-[20px] max-w-[420px] px-4 text-[13.5px] text-muted-foreground">
            {error ?? stateLabel}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {(callState === "speaking" || callState === "thinking") && !muted && (
            <button
              onClick={interrupt}
              title="Interrupt and talk"
              className="flex size-14 items-center justify-center rounded-full border bg-card text-foreground shadow-sm transition-transform active:scale-95"
            >
              <Mic size={20} />
            </button>
          )}
          <button
            onClick={toggleMute}
            title={muted ? "Unmute microphone" : "Mute microphone"}
            aria-pressed={muted}
            className={cn(
              "flex size-14 items-center justify-center rounded-full border shadow-sm transition-transform active:scale-95",
              muted ? "bg-warning/15 text-warning" : "bg-card text-foreground",
            )}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          {needsManualFinish && callState === "listening" && !muted && (
            <Button variant="secondary" onClick={() => finishUtterance(heardRef.current)}>
              Done talking
            </Button>
          )}
          <button
            onClick={hangUp}
            title="End call"
            className="flex size-14 items-center justify-center rounded-full bg-destructive text-white shadow-md transition-transform active:scale-95"
          >
            <PhoneOff size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** The room header affordance: live once anyone in the room can speak. */
export function GroupCallButton({
  blok,
  members,
}: {
  blok: { id: string; name: string; messages: Message[] };
  members: Bot[];
}) {
  const [calling, setCalling] = useState(false);
  const voiced = members.filter((m) => m.voice?.provider === "system").length;
  if (voiced === 0) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title={
          voiced === members.length
            ? `Call ${blok.name}`
            : `Call ${blok.name} (${members.length - voiced} member${members.length - voiced === 1 ? "" : "s"} without a voice will show as text)`
        }
        aria-label={`Call ${blok.name}`}
        onClick={() => setCalling(true)}
      >
        <Phone size={16} />
      </Button>
      {calling && <GroupCallOverlay blok={blok} members={members} onClose={() => setCalling(false)} />}
    </>
  );
}
