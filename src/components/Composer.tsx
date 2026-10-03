import { track } from "@/lib/analytics";
import { useEffect, useRef, useState } from "react";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import Mic from "lucide-react/dist/esm/icons/mic.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Camera from "lucide-react/dist/esm/icons/camera.mjs";
import ImageIcon from "lucide-react/dist/esm/icons/image.mjs";
import Video from "lucide-react/dist/esm/icons/video.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import Hand from "lucide-react/dist/esm/icons/hand.mjs";
import Archive from "lucide-react/dist/esm/icons/archive.mjs";
import FileIcon from "lucide-react/dist/esm/icons/file.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import { api, useStore, type Bot } from "@/state/store";
import { ReplyChip, type ReplyDraft } from "./MessageActions";
import { cn } from "@/lib/cn";
import {
  attachmentBasename,
  composeOutgoing,
  formatBytes,
  intakeFiles,
  isLongPaste,
  pasteAttachment,
  uploadStoredAttachment,
  type Attachment,
} from "@/lib/attachments";
import { Button } from "@/components/ui/button";
import { modKey } from "@/lib/thisComputer";
import { composerCeiling, edgeMask } from "@/lib/composerSize";
import { browserRecognitionAvailable, startFreeRecognition, type RecognitionSession } from "@/lib/localVoice";

/** Fade whichever edges have more text beyond them (see edgeMask). */
function shadeEdges(el: HTMLTextAreaElement) {
  const mask = edgeMask(el.scrollTop, el.clientHeight, el.scrollHeight);
  el.style.maskImage = mask;
  el.style.webkitMaskImage = mask;
}

/**
 * Grows with its content up to a ceiling, then scrolls.
 *
 * Measured at `auto` rather than at zero. An empty textarea collapsed to
 * no height reports a scrollHeight of its own maximum rather than of one
 * line, so measuring that way left the composer standing at its ceiling
 * whenever there was nothing in it, which is every time you look at it.
 *
 * The ceiling is a whole number of lines, measured from the rendered line
 * height, not a round number of pixels. A flat 200px was eight and a half
 * lines, so a scrolled composer always showed half a line sliced off at
 * one edge (#50).
 */
function useAutoSize(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => shadeEdges(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Nothing typed is exactly one row, and rows=1 already says that, so
    // the height comes off entirely rather than being measured. An empty
    // textarea does not report the scrollHeight of one line, which is how
    // the composer came to stand at its ceiling whenever it was empty.
    if (!value) {
      el.style.height = "";
      shadeEdges(el);
      return;
    }
    const style = getComputedStyle(el);
    const ceiling = composerCeiling(
      parseFloat(style.lineHeight),
      parseFloat(style.paddingTop),
      parseFloat(style.paddingBottom),
    );
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ceiling)}px`;
    // Typing at the end, the usual case: show the end, padding included.
    // The browser only scrolls far enough to keep the caret's line in
    // view, which parks that line in the bottom fade.
    if (el.selectionEnd === value.length) el.scrollTop = el.scrollHeight;
    shadeEdges(el);
  }, [value]);
  return ref;
}

/** What the helper's error words mean to a person. */
const SPEECH_TROUBLE: Record<string, string> = {
  "speech-not-authorized":
    "Bloks memerlukan akses Pengenalan Suara untuk mengubah suara Anda menjadi teks. Izin ini terpisah dari izin mikrofon.",
  "recognizer-unavailable":
    "Pengenalan suara belum tersedia di perangkat ini saat ini.",
  "mic-failed": "Mikrofon tidak dapat dibuka. Aplikasi lain mungkin sedang menggunakannya.",
  "recognition-error": "Pengenalan suara berhenti. Coba lagi, dan periksa perangkat input jika masalah berulang.",
};

/**
 * Five bars that move with your voice. A recording state that shows only
 * a red dot cannot distinguish "listening" from "deaf", which is exactly
 * the doubt somebody has when nothing appears in the field.
 */
function VoiceMeter({ level }: { level: number }) {
  const bars = [0.45, 0.75, 1, 0.75, 0.45];
  return (
    <span className="flex h-[17px] items-center gap-[2px]" aria-hidden>
      {bars.map((weight, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-current transition-[height] duration-100 ease-out"
          style={{ height: `${Math.max(3, Math.min(15, 3 + level * weight * 22))}px` }}
        />
      ))}
    </span>
  );
}

export function Composer({
  bot,
  replyTo,
  onClearReply,
}: {
  bot: Bot;
  /** reply context to send with the next message */
  replyTo?: ReplyDraft | null;
  onClearReply?: () => void;
}) {
  const { dispatch } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  /** A standing denial: macOS will not prompt again, so we offer the pane. */
  const [micDenied, setMicDenied] = useState(false);
  /** Which Privacy pane would fix the current complaint. */
  const [speechPane, setSpeechPane] = useState<"mic" | "speech">("mic");
  /** Loudness right now, 0 to 1, straight from the microphone tap. */
  const [level, setLevel] = useState(0);
  // whatever was already typed, so speech is appended rather than
  // replacing what someone had started writing
  const baseText = useRef("");
  const recognitionRef = useRef<RecognitionSession | null>(null);
  const inputRef = useAutoSize(text);
  /** Chips riding with the next message. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Why something did not become a chip, said once, dismissible. */
  const [attachNotice, setAttachNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [intelligenceMode, setIntelligenceMode] = useState<"fast" | "auto" | "expert">("auto");
  const pickerRef = useRef<HTMLInputElement>(null);
  const imagePickerRef = useRef<HTMLInputElement>(null);
  const photoPickerRef = useRef<HTMLInputElement>(null);
  const videoPickerRef = useRef<HTMLInputElement>(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const composerRootRef = useRef<HTMLDivElement>(null);

  // Mobile browsers expose the keyboard through the visual viewport. Keep
  // the composer inside that visible viewport instead of letting the layout
  // viewport park it behind the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = composerRootRef.current;
    if (!viewport || !root) return;
    const sync = () => {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      root.style.transform = keyboardInset > 0 ? `translateY(-${keyboardInset}px)` : "";
    };
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    sync();
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      root.style.transform = "";
    };
  }, []);

  /** The one road in, whether the files came by picker, drop or paste. */
  const intake = (files: File[]) => {
    if (!files.length) return;
    void intakeFiles(files, {
      pathOf: (file) => window.bloks?.filePath?.(file) ?? "",
      uploadAttachment: uploadStoredAttachment,
    }).then(({ attachments: added, refused }) => {
      if (added.length) setAttachments((current) => [...current, ...added]);
      setAttachNotice(refused);
    });
  };

  const send = () => {
    if (submitting || (!text.trim() && !attachments.length)) return;
    const outgoing = composeOutgoing(text, attachments);
    setSubmitting(true);
    dispatch({
      type: "send",
      botId: bot.id,
      text: outgoing,
      replyTo: replyTo ?? undefined,
      mode: intelligenceMode,
      onAccepted: () => {
        setSubmitting(false);
        setText("");
        setAttachments([]);
        setAttachNotice(null);
        onClearReply?.();
      },
      onFailed: () => {
        setSubmitting(false);
        setAttachNotice("Pengiriman gagal; teks dan lampiran tetap disimpan. Coba lagi saat siap.");
      },
    });
    track("message_sent", { driver: bot.modelSelection?.instanceId });
  };


  // FREE_ONLY dictation: native helper in the desktop shell, browser
  // recognition in Web/PWA when exposed. Either path only produces draft
  // text; it never bypasses the normal send/router/context pipeline.
  useEffect(() => {
    if (!recording) return;
    setSpeechError(null);
    const applyText = (line: string) => {
      const base = baseText.current;
      setText(base ? `${base} ${line}` : line);
    };
    const session = startFreeRecognition({
      onPartial: applyText,
      onFinal: (line) => {
        applyText(line);
        setRecording(false);
      },
      onSilence: () => setRecording(false),
      onLevel: (next) => setLevel(next),
      onError: (code) => {
        setRecording(false);
        const browserCode = code.startsWith("browser:") ? code.slice(8) : "";
        if (browserCode) {
          setSpeechError(
            browserCode === "not-allowed" || browserCode === "service-not-allowed"
              ? "Browser ini tidak diizinkan menggunakan pengenalan suara. Periksa izin mikrofon/situs."
              : `Pengenalan suara berhenti (${browserCode}). Coba lagi.`,
          );
          return;
        }
        setSpeechError(SPEECH_TROUBLE[code] ?? "Dikte berhenti secara tidak terduga.");
        setSpeechPane(code === "speech-not-authorized" ? "speech" : "mic");
      },
    });
    recognitionRef.current = session;
    if (!session) {
      setRecording(false);
      setSpeechError("Tidak ada pengenalan suara gratis yang tersedia di perangkat/browser ini.");
    }
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setLevel(0);
    };
  }, [recording]);

  /**
   * Dictation is worthless if the button silently does nothing, which is
   * exactly what a missing microphone grant looked like: macOS refuses,
   * the helper never starts, and the icon just sits there. So the grant
   * is settled before recording starts. A first refusal is macOS's to
   * ask; a standing denial it will never ask about again, so that case
   * offers the Settings pane instead of a dead end.
   */
  const toggleMic = async () => {
    if (recording) {
      recognitionRef.current?.stop();
      setRecording(false);
      return;
    }

    setSpeechError(null);
    setMicDenied(false);
    baseText.current = text.trim();

    // Desktop asks the OS explicitly so a standing denial has a useful
    // explanation. Web/PWA lets the browser recognizer own its permission prompt.
    if (window.bloks) {
      const status = await window.bloks.permStatus().catch(() => null);
      let mic = status?.mic ?? "unknown";
      if (mic === "not-determined") {
        mic = (await window.bloks.permRequestMic().catch(() => false)) ? "granted" : "denied";
      }
      if (mic === "denied" || mic === "restricted") {
        setMicDenied(true);
        setSpeechError("DIZA tidak memiliki akses ke mikrofon Anda, sehingga dikte tidak dapat dimulai.");
        return;
      }
      setRecording(true);
      return;
    }

    if (browserRecognitionAvailable()) {
      setRecording(true);
      return;
    }
    setSpeechError("Browser ini tidak menyediakan pengenalan suara gratis. Anda tetap dapat mengetik atau melampirkan file audio/video.");
  };

  const canSend = !submitting && (Boolean(text.trim()) || attachments.length > 0);

  // While you hold the wheel the server refuses a turn, and it is right
  // to: you are the one driving. But a bare refusal after typing a
  // sentence reads as a bug, so the composer says so first and offers
  // the one thing that fixes it.
  // The mic belongs to the composer, so a composer that goes away has to
  // take it with it. Without this the helper keeps listening with no
  // waveform, no stop button and nothing to type into.
  const quiet = Boolean(bot.held || bot.archivedAt);
  useEffect(() => {
    if (quiet && recording) setRecording(false);
  }, [quiet, recording]);

  // Archived reads exactly like the wheel does from here: the transcript
  // is all still there, and the composer says why nothing can be sent and
  // offers the one press that fixes it. The server refuses either way;
  // this is so nobody types a paragraph into a refusal.
  if (bot.archivedAt) {
    return (
      <div className="px-4 pb-4 pt-1 md:px-6 md:pb-5">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 rounded-2xl border bg-muted/40 px-3.5 py-3">
          <Archive size={15} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-muted-foreground">
            {bot.name} is archived. Everything it said is still here, and it will not take new work
            until you restore it.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => dispatch({ type: "restoreBot", botId: bot.id })}
          >
            Pulihkan
          </Button>
        </div>
      </div>
    );
  }

  if (bot.held) {
    return (
      <div className="px-4 pb-4 pt-1 md:px-6 md:pb-5">
        <div className="mx-auto flex max-w-[760px] items-center gap-3 rounded-2xl border border-warning/40 bg-warning/5 px-3.5 py-3">
          <Hand size={15} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-foreground">
            You have {bot.name}&rsquo;s computer ({bot.held.why}). It will not start anything until you
            hand the wheel back.
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0"
            onClick={() => {
              void api(`/api/bots/${bot.id}/wheel`, { method: "DELETE" }).catch(() => {});
            }}
          >
            Kembalikan kontrol
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={composerRootRef}
      className="relative z-20 shrink-0 px-4 pb-4 pt-1 md:px-6 md:pb-5"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        intake([...e.dataTransfer.files]);
      }}
    >
      {replyTo && (
        <div className="mx-auto mb-2 max-w-[760px]">
          <ReplyChip draft={replyTo} onClear={() => onClearReply?.()} />
        </div>
      )}
      {attachNotice && (
        <div className="mx-auto mb-2 flex max-w-[760px] animate-rise-in items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{attachNotice}</span>
          <button
            onClick={() => setAttachNotice(null)}
            className="shrink-0 rounded-lg px-1.5 py-1 opacity-60 transition-opacity hover:opacity-100"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mx-auto mb-2 flex max-w-[760px] flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="flex max-w-[240px] items-center gap-1.5 rounded-xl border bg-muted/50 py-1 pl-1.5 pr-1 text-[12px] text-foreground"
            >
              {a.kind === "image" ? (
                <img
                  src={`/api/attachments/${attachmentBasename(a.path)}`}
                  alt={a.name}
                  className="size-7 shrink-0 rounded-lg object-cover"
                />
              ) : a.kind === "video" ? (
                <Video size={14} className="shrink-0 text-muted-foreground" />
              ) : (
                <FileIcon size={14} className="shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {a.kind === "paste" ? `Teks ditempel, ${a.lines} baris` : a.name}
              </span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(a.bytes)}</span>
              <button
                onClick={() => setAttachments((cur) => cur.filter((x) => x.id !== a.id))}
                className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`Hapus ${a.kind === "paste" ? "teks ditempel" : a.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {speechError && (
        <div className="mx-auto mb-2 flex max-w-[760px] animate-rise-in items-center gap-2 rounded-xl bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <span className="min-w-0 flex-1">{speechError}</span>
          {(micDenied || speechPane === "speech") && (
            <button
              onClick={() => void window.bloks?.permOpenSettings(speechPane)}
              className="shrink-0 rounded-lg bg-warning/15 px-2 py-1 font-medium underline-offset-2 transition-colors hover:bg-warning/25"
            >
              Buka Pengaturan
            </button>
          )}
          <button
            onClick={() => setSpeechError(null)}
            className="shrink-0 rounded-lg px-1.5 py-1 opacity-60 transition-opacity hover:opacity-100"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}
      <div className="mx-auto mb-1.5 flex max-w-[760px] gap-1 px-1" aria-label="Mode kecerdasan">
        {(["fast", "auto", "expert"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setIntelligenceMode(mode)}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors",
              intelligenceMode === mode
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            aria-pressed={intelligenceMode === mode}
            title={mode === "fast" ? "Respons cepat" : mode === "expert" ? "Penalaran lebih mendalam" : "Diza memilih otomatis"}
          >
            {mode === "fast" ? "Cepat" : mode === "expert" ? "Mendalam" : "Otomatis"}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "mx-auto flex max-w-[760px] items-end gap-1 rounded-[22px] border bg-background p-1.5 pl-2 shadow-[0_1px_3px_var(--shadow-color)] transition-[border-color,box-shadow] duration-150",
          "focus-within:border-ring/50",
        )}
      >
        <input
          ref={pickerRef}
          type="file"
          multiple
          className="hidden"
          accept="text/plain,text/markdown,text/csv,application/json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            intake([...(e.target.files ?? [])]);
            e.target.value = "";
            setAttachmentMenuOpen(false);
          }}
        />
        <input
          ref={imagePickerRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            intake([...(e.target.files ?? [])]);
            e.target.value = "";
            setAttachmentMenuOpen(false);
          }}
        />
        <input
          ref={photoPickerRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            intake([...(e.target.files ?? [])]);
            e.target.value = "";
            setAttachmentMenuOpen(false);
          }}
        />
        <input
          ref={videoPickerRef}
          type="file"
          accept="video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            intake([...(e.target.files ?? [])]);
            e.target.value = "";
            setAttachmentMenuOpen(false);
          }}
        />
        <div className="relative shrink-0">
          {attachmentMenuOpen && (
            <div className="absolute bottom-11 left-0 z-40 w-44 overflow-hidden rounded-2xl border bg-popover p-1.5 shadow-xl shadow-[--shadow-color]">
              {[
                ["Foto", <ImageIcon key="foto" size={17} />, () => imagePickerRef.current?.click()],
                ["Kamera", <Camera key="kamera" size={17} />, () => photoPickerRef.current?.click()],
                ["Video", <Video key="video" size={17} />, () => videoPickerRef.current?.click()],
                ["File", <FileIcon key="file" size={17} />, () => pickerRef.current?.click()],
              ].map(([label, icon, run]) => (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => (run as () => void)()}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] text-foreground transition-colors active:bg-accent"
                >
                  <span className="text-muted-foreground">{icon as React.ReactNode}</span>
                  <span>{String(label)}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground active:scale-95"
            title="Lampirkan"
            aria-label="Lampirkan"
            aria-expanded={attachmentMenuOpen}
            disabled={submitting}
            onClick={() => setAttachmentMenuOpen((open) => !open)}
          >
            <Plus size={18} />
          </button>
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={submitting}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // images in the clipboard become chips; so does a paste long
            // enough to bury the conversation
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              intake(files);
              return;
            }
            const pasted = e.clipboardData.getData("text/plain");
            if (pasted && isLongPaste(pasted)) {
              e.preventDefault();
              setAttachments((cur) => [...cur, pasteAttachment(pasted)]);
            }
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter starts a new line. While the agent
            // works, plain Enter queues behind the running turn, and
            // Cmd+Enter stops the turn first: both the patient road and
            // the impatient one, the same way the CLIs offer both.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if ((e.metaKey || e.ctrlKey) && bot.busy) {
                dispatch({ type: "interrupt", botId: bot.id });
              }
              send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          placeholder={
            recording
              ? "Mendengarkan…"
              : bot.busy
                ? `${bot.name} sedang bekerja. Enter untuk antre, ${modKey()}Enter untuk hentikan…`
                : `Pesan ke ${bot.name}`
          }
          className="w-full min-w-0 resize-none self-center bg-transparent px-1 py-1 text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
        />
        {bot.busy ? (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground active:scale-95"
            title="Hentikan"
          >
            <Square size={13} className="fill-current" />
          </button>
        ) : (
          <button
            onClick={() => void toggleMic()}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-150 active:scale-95",
              recording
                ? "animate-pulse bg-destructive/15 text-destructive"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            title={recording ? "Hentikan dikte (Esc)" : "Dikte"}
          >
            {recording ? <VoiceMeter level={level} /> : <Mic size={17} />}
          </button>
        )}
        <button
          onClick={send}
          disabled={!canSend}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform,opacity] duration-150 ease-out active:scale-95",
            canSend
              ? "bg-primary text-primary-foreground hover:opacity-90"
              : "cursor-not-allowed bg-muted text-muted-foreground/60",
          )}
          title="Kirim"
        >
          <ArrowUp size={17} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
