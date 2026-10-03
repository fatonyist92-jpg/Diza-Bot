import { useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import { AgentAvatar } from "./Avatar";
import { useStore, formatWhen, type Bot, type Blok } from "@/state/store";
import { previewLine } from "@/lib/preview";
import { simpleIndonesianText } from "@/lib/uiLanguage";
import { cn } from "@/lib/cn";

type HomeTab = "agents" | "rooms";

function agentUpdatedAt(bot: Bot): number {
  return bot.messages.at(-1)?.at ?? bot.tasks?.reduce((latest, task) => Math.max(latest, task.updatedAt ?? task.createdAt), 0) ?? 0;
}

function roomUpdatedAt(room: Blok): number {
  return room.messages.at(-1)?.at ?? room.createdAt;
}

export function MobileChatHome({ onOpenChat }: { onOpenChat: () => void }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<HomeTab>("agents");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const agents = state.bots
    .filter((bot) => !bot.hidden && !bot.archivedAt)
    .filter((bot) => {
      if (!needle) return true;
      const last = simpleIndonesianText(previewLine(bot.messages.at(-1)));
      return `${bot.name} ${bot.title} ${last}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => agentUpdatedAt(b) - agentUpdatedAt(a));

  const rooms = state.bloks
    .filter((room) => {
      if (!needle) return true;
      const last = simpleIndonesianText(previewLine(room.messages.at(-1)));
      return `${room.name} ${last}`.toLowerCase().includes(needle);
    })
    .sort((a, b) => roomUpdatedAt(b) - roomUpdatedAt(a));

  const openAgent = (bot: Bot) => {
    dispatch({ type: "select", id: bot.id });
    onOpenChat();
  };

  const openRoom = (room: Blok) => {
    dispatch({ type: "select", id: room.id });
    onOpenChat();
  };

  const createNew = () => {
    dispatch({
      type: tab === "agents" ? "toggleNewAgent" : "toggleNewRoom",
      open: true,
    });
  };

  return (
    <main className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="shrink-0 bg-background px-5 pb-3 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[31px] font-semibold leading-none tracking-[-0.045em]">Obrolan</h1>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={createNew}
              className="flex size-10 items-center justify-center rounded-full text-foreground transition-colors active:bg-accent"
              aria-label={tab === "agents" ? "Buat agen" : "Buat ruang"}
              title={tab === "agents" ? "Buat agen" : "Buat ruang"}
            >
              <Plus size={24} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleAppSettings", open: true })}
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-accent active:text-foreground"
              aria-label="Pengaturan"
              title="Pengaturan"
            >
              <SlidersHorizontal size={21} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2">
          {([
            ["agents", "Agen"],
            ["rooms", "Ruang"],
          ] as const).map(([value, label]) => {
            const active = tab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTab(value);
                  setQuery("");
                }}
                className={cn(
                  "relative h-11 text-[16px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
                aria-pressed={active}
              >
                {label}
                <span
                  className={cn(
                    "absolute bottom-0 left-1/2 h-[2px] w-12 -translate-x-1/2 rounded-full bg-foreground transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex h-12 items-center gap-3 rounded-[18px] bg-muted px-4">
          <Search size={20} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "agents" ? "Cari agen" : "Cari ruang"}
            className="min-w-0 flex-1 bg-transparent text-[15.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {tab === "agents" ? (
          agents.length ? (
            agents.map((bot) => {
              const last = bot.messages.at(-1);
              const updatedAt = agentUpdatedAt(bot);
              const preview = simpleIndonesianText(previewLine(last)) || "Belum ada pesan";
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => openAgent(bot)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-accent/70"
                >
                  <AgentAvatar bot={bot} size={54} className="rounded-full" />
                  <span className="min-w-0 flex-1 border-b border-border/70 pb-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[16px] font-semibold tracking-[-0.015em]">{bot.name}</span>
                      {updatedAt > 0 && (
                        <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                          {formatWhen(updatedAt)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14.5px] text-muted-foreground">{preview}</span>
                      {bot.unread && <span className="size-2.5 shrink-0 rounded-full bg-foreground" />}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState
              icon={<MessageCircle size={28} strokeWidth={1.5} />}
              title={needle ? "Agen tidak ditemukan" : "Belum ada agen"}
              subtitle={needle ? "Coba kata pencarian lain." : "Tekan + untuk membuat agen baru."}
            />
          )
        ) : rooms.length ? (
          rooms.map((room) => {
            const last = room.messages.at(-1);
            const updatedAt = roomUpdatedAt(room);
            const preview = simpleIndonesianText(previewLine(last)) || "Belum ada pesan";
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => openRoom(room)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors active:bg-accent/70"
              >
                <span className="flex size-[54px] shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <Users size={23} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1 border-b border-border/70 pb-3">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[16px] font-semibold tracking-[-0.015em]">{room.name}</span>
                    {updatedAt > 0 && (
                      <span className="shrink-0 text-[12.5px] tabular-nums text-muted-foreground">
                        {formatWhen(updatedAt)}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[14.5px] text-muted-foreground">{preview}</span>
                </span>
              </button>
            );
          })
        ) : (
          <EmptyState
            icon={<Users size={28} strokeWidth={1.5} />}
            title={needle ? "Ruang tidak ditemukan" : "Belum ada ruang"}
            subtitle={needle ? "Coba kata pencarian lain." : "Tekan + untuk membuat ruang baru."}
          />
        )}
      </section>
    </main>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-20 text-center text-muted-foreground">
      {icon}
      <div className="mt-3 text-[14px] font-medium text-foreground">{title}</div>
      <div className="mt-1 text-[12.5px]">{subtitle}</div>
    </div>
  );
}
