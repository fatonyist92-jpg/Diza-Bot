import { useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Settings from "lucide-react/dist/esm/icons/settings-2.mjs";
import BotIcon from "lucide-react/dist/esm/icons/bot.mjs";
import DoorOpen from "lucide-react/dist/esm/icons/door-open.mjs";
import UserRound from "lucide-react/dist/esm/icons/user-round.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import { AgentAvatar } from "./Avatar";
import { useStore, formatWhen, type Bot, type TaskSummary } from "@/state/store";
import { previewLine } from "@/lib/preview";

type ChatRow = { bot: Bot; task: TaskSummary | null; updatedAt: number; preview: string };

export function MobileChatHome({ onOpenChat, onOpenRooms, onOpenBots }: { onOpenChat: () => void; onOpenRooms: () => void; onOpenBots: () => void }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");

  const rows: ChatRow[] = state.bots
    .filter((bot) => !bot.hidden)
    .flatMap<ChatRow>((bot) => {
      const tasks = (bot.tasks ?? []).filter((task) => !task.archivedAt);
      if (!tasks.length) {
        const last = bot.messages.at(-1);
        return [{ bot, task: null, updatedAt: last?.at ?? 0, preview: previewLine(last) }];
      }
      return tasks.map((task) => {
        const active = task.id === bot.activeTaskId || task.id === bot.threadId;
        const last = active ? bot.messages.at(-1) : undefined;
        return {
          bot,
          task,
          updatedAt: task.updatedAt ?? task.createdAt,
          preview: active && last ? previewLine(last) : bot.title || "Percakapan DIZA",
        };
      });
    })
    .filter((row) => {
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      return `${row.task?.title ?? ""} ${row.bot.name} ${row.bot.title} ${row.preview}`
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const open = (row: ChatRow) => {
    dispatch({ type: "select", id: row.bot.id });
    if (row.task && row.bot.activeTaskId !== row.task.id) {
      dispatch({ type: "selectTask", botId: row.bot.id, taskId: row.task.id });
    }
    onOpenChat();
  };

  return (
    <main className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border/60 bg-background/95 px-5 pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[23px] font-semibold tracking-[-0.04em]">DIZA</div>
            <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Personal AI
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => dispatch({ type: "toggleNewAgent", open: true })}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Chat baru"
            >
              <Plus size={21} />
            </button>
            <button
              onClick={() => dispatch({ type: "toggleAppSettings" })}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Pengaturan"
            >
              <Settings size={19} />
            </button>
          </div>
        </div>
        <div className="mt-4 flex h-10 items-center gap-2 rounded-xl bg-accent/70 px-3 focus-within:bg-accent">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari chat"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </header>

      <nav className="grid grid-cols-3 gap-2 border-b border-border/55 px-4 py-3">
        <button onClick={onOpenRooms} className="flex items-center justify-center gap-1.5 rounded-xl bg-accent/60 px-2 py-2 text-[12px] font-medium transition-all duration-200 active:scale-[0.97]"><DoorOpen size={15} /> Rooms</button>
        <button onClick={onOpenBots} className="flex items-center justify-center gap-1.5 rounded-xl bg-accent/60 px-2 py-2 text-[12px] font-medium transition-all duration-200 active:scale-[0.97]"><BotIcon size={15} /> Bots</button>
        <button onClick={() => dispatch({ type: "toggleAppSettings" })} className="flex items-center justify-center gap-1.5 rounded-xl bg-accent/60 px-2 py-2 text-[12px] font-medium transition-all duration-200 active:scale-[0.97]"><UserRound size={15} /> Account</button>
      </nav>

      <section className="min-h-0 flex-1 overflow-y-auto animate-fade-in">
        {rows.length ? (
          rows.map((row) => (
            <button
              key={row.task?.id ?? row.bot.id}
              onClick={() => open(row)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/70"
            >
              <AgentAvatar bot={row.bot} size={50} />
              <div className="min-w-0 flex-1 border-b border-border/55 pb-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15.5px] font-semibold">
                    {row.bot.name}
                  </span>
                  {row.updatedAt > 0 && (
                    <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                      {formatWhen(row.updatedAt)}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                    {row.task ? `${row.task.title} · ${row.preview}` : row.preview}
                  </span>
                  {row.bot.unread && <span className="size-2.5 shrink-0 rounded-full bg-foreground" />}
                </div>
              </div>
            </button>
          ))
        ) : (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center text-muted-foreground">
            <MessageCircle size={28} strokeWidth={1.5} />
            <div className="mt-3 text-[14px] font-medium text-foreground">Belum ada chat</div>
            <div className="mt-1 text-[12.5px]">Buat bot pertama untuk memulai percakapan.</div>
          </div>
        )}
      </section>
    </main>
  );
}
