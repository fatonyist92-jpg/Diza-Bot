import { useState } from "react";
import X from "lucide-react/dist/esm/icons/x.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import { useStore, type Message, type TeamPlan } from "@/state/store";
import { BlokAvatar } from "@/components/Avatar";
import { BLOK_COLOR_NAMES, shapeForBot, type BlokColor } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { simpleIndonesianText } from "@/lib/uiLanguage";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function OptionCard({
  botId,
  message,
  roomId,
}: {
  botId: string;
  message: Message;
  /** Set when the card is being shown inside a room, so an answer goes to
   * the room rather than to the agent alone. */
  roomId?: string;
}) {
  const { state, dispatch } = useStore();
  const [custom, setCustom] = useState("");
  const card = message.card;
  if (!card || card.dismissed) return null;

  const answer = (text: string) => {
    if (!text.trim()) return;
    dispatch({ type: "answerCard", botId, roomId, messageId: message.id, answer: text.trim() });
  };

  if (card.team) {
    const lead = state.bots.find((b) => b.id === botId);
    return (
      <TeamProposal
        plan={card.team}
        leadName={lead?.name ?? "Agen Anda"}
        settled={card.answered}
        onHire={() => dispatch({ type: "hireTeam", botId, messageId: message.id })}
        onDecline={() => answer("Not now. Handle this yourself.")}
      />
    );
  }

  const approval = !!card.requestId;

  return (
    <div className={cn(
      "w-full max-w-[560px] animate-rise-in overflow-hidden border bg-card",
      approval
        ? "rounded-[22px] border-border/60 bg-card/95 shadow-[0_16px_44px_var(--shadow-color)] backdrop-blur-sm"
        : "rounded-2xl p-4 shadow-[0_1px_3px_var(--shadow-color)]",
    )}>
      <div className={cn("flex items-start justify-between gap-4", approval && "px-4 pb-3.5 pt-4")}>
        <div className="min-w-0 flex-1">
          <div className={cn(
            "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em]",
            approval ? "text-muted-foreground" : card.runId ? "text-warning" : "text-brand-ink",
          )}>
            {approval && <span className="flex size-8 items-center justify-center rounded-xl border border-border/60 bg-foreground text-background shadow-sm"><ShieldCheck size={16} /></span>}
            <span>{approval ? "Perlu persetujuan" : card.runId ? "Alur kerja" : "Pertanyaan"}</span>
          </div>
          <div className={cn("break-words font-semibold text-foreground [overflow-wrap:anywhere]", approval ? "mt-3.5 text-[15.5px] tracking-[-0.01em]" : "mt-1 text-[14.5px]")}>
            {simpleIndonesianText(card.title)}
          </div>
          {card.subtitle && (
            <div className={cn(
              "break-words leading-relaxed text-muted-foreground [overflow-wrap:anywhere]",
              approval ? "mt-2 rounded-xl border border-border/50 bg-muted/35 px-3 py-2.5 font-mono text-[12px]" : "mt-0.5 text-[13px]",
            )}>
              {simpleIndonesianText(card.subtitle)}
            </div>
          )}
          {card.answeredBy && <div className="mt-1 text-[12px] text-muted-foreground">Dijawab oleh {card.answeredBy}</div>}
        </div>
        <button
          onClick={() => dispatch({ type: "dismissCard", botId, roomId, messageId: message.id })}
          aria-label="Simpan pertanyaan ini untuk nanti"
          title="Simpan pertanyaan ini untuk nanti"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div className={cn(
        approval ? "grid grid-cols-2 gap-2.5 border-t border-border/60 bg-muted/15 p-3.5" : "mt-3 flex flex-col gap-1",
      )}>
        {card.options.map((opt, i) => (
          <button
            key={opt}
            disabled={!!card.answered}
            onClick={() => answer(opt)}
            className={cn(
              approval
                ? "flex min-h-11 items-center justify-center rounded-xl px-3 py-2.5 text-[13.5px] font-semibold transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.98]"
                : "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[14px] transition-colors duration-150",
              card.answered === opt
                ? "bg-foreground text-background"
                : approval
                  ? i === 0
                    ? "bg-foreground text-background hover:opacity-90 disabled:opacity-45"
                    : "border bg-background text-foreground hover:bg-accent disabled:opacity-45"
                  : "text-foreground hover:bg-accent disabled:hover:bg-transparent",
              !approval && card.answered && card.answered !== opt && "opacity-45",
            )}
          >
            {!approval && (
              <span className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-lg text-[11.5px] font-semibold",
                card.answered === opt ? "bg-brand-ink text-brand-foreground" : "bg-muted text-muted-foreground",
              )}>
                {LETTERS[i]}
              </span>
            )}
            {simpleIndonesianText(opt)}
          </button>
        ))}
      </div>

      {!card.answered && card.requestId && card.tool && (
        <button
          onClick={() => {
            void fetch("/api/rules", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ effect: "allow", field: "tool", op: "equals", value: card.tool, botId, enabled: true }),
            }).catch(() => {});
            answer("Allow");
          }}
          className="w-full border-t border-border/60 px-4 py-3 text-left text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          Selalu izinkan {card.tool} untuk agen ini
        </button>
      )}

      {!card.answered && !card.runId && !approval && (
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && answer(custom)}
          placeholder="Tulis jawaban sendiri…"
          className="mt-2 w-full rounded-xl border border-input bg-transparent px-3 py-2 text-[13.5px] text-foreground outline-none transition-[border-color] duration-150 placeholder:text-muted-foreground focus:border-ring/60"
        />
      )}
    </div>
  );
}

/** Deterministic colour for someone who is not an agent yet, so the roster
 * you approve looks like the roster you get. */
function colorFor(name: string): BlokColor {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return BLOK_COLOR_NAMES[Math.abs(hash) % BLOK_COLOR_NAMES.length];
}

/**
 * A lead asking to hire. Nothing is created until this is approved, so the
 * card shows the whole roster: who, what they own, and what they can do.
 */
function TeamProposal({
  plan,
  leadName,
  settled,
  onHire,
  onDecline,
}: {
  plan: TeamPlan;
  leadName: string;
  settled?: string;
  onHire: () => void;
  onDecline: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hired = settled === "Hire the team";

  return (
    <div className="w-full max-w-[560px] animate-rise-in overflow-hidden rounded-2xl border bg-card shadow-[0_1px_3px_var(--shadow-color)]">
      <div className="px-4 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-brand-ink">
          {hired ? "Tim dibuat" : "Usulan tim"}
        </div>
        <div className="mt-1 text-[14.5px] font-semibold text-foreground">
          {leadName} ingin {plan.members.length} anggota untuk “{plan.room}”
        </div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          Mereka mengerjakan tugas pendukung. {leadName} meninjau hasilnya lalu melaporkan kembali kepada Anda.
        </div>
      </div>

      <div className="mt-3 flex flex-col divide-y border-t">
        {plan.members.map((member) => (
          <div key={member.name} className="flex gap-3 px-4 py-3">
            <BlokAvatar
              color={colorFor(member.name)}
              shape={shapeForBot({ name: member.name })}
              expression="friendly"
              size={30}
              className="mt-0.5 rounded-[9px]"
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">{member.name}</div>
              {member.title && (
                <div className="text-[12.5px] leading-snug text-muted-foreground">{member.title}</div>
              )}
              {member.skills.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {member.skills.map((skill) => (
                    <span
                      key={skill}
                      title={skill}
                      className="max-w-[220px] truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {skill.split(":")[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {plan.brief && (
        <div className="border-t px-4 py-2.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            {open ? "Tutup brief" : "Lihat brief tim"}
          </button>
          {open && (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {plan.brief}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t bg-muted/30 px-4 py-3">
        {hired ? (
          <span className="text-[13px] text-muted-foreground">
            Tim sudah dibuat. Ruang kerja terbuka dan {leadName} sudah memberi brief.
          </span>
        ) : settled ? (
          <span className="text-[13px] text-muted-foreground">Ditolak.</span>
        ) : (
          <>
            <button
              onClick={onHire}
              className="rounded-xl bg-brand-ink px-3.5 py-2 text-[13.5px] font-medium text-brand-foreground transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.98]"
            >
              Buat tim
            </button>
            <button
              onClick={onDecline}
              className="rounded-xl px-3 py-2 text-[13.5px] text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            >
              Nanti saja
            </button>
          </>
        )}
      </div>
    </div>
  );
}
