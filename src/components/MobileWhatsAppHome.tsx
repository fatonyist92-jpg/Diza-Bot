import { useMemo, useState } from "react";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import { AgentAvatar } from "./Avatar";
import { formatWhen, useStore, type Blok, type Bot } from "@/state/store";
import { previewLine } from "@/lib/preview";
import { cn } from "@/lib/cn";

type Tab = "agents" | "rooms";

function lastAgentAt(bot: Bot) {
  return bot.messages.at(-1)?.at ?? 0;
}

function lastRoomAt(room: Blok) {
  return room.messages.at(-1)?.at ?? room.createdAt;
}

export function MobileWhatsAppHome({
  onOpenConversation,
}: {
  onOpenConversation: () => void;
}) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>("agents");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();

  const agents = useMemo(
    () =>
      state.bots
        .filter((bot) => !bot.hidden && !bot.archivedAt)
        .filter((bot) => {
          if (!needle) return true;
          return `${bot.name} ${bot.title} ${previewLine(bot.messages.at(-1))}`
            .toLowerCase()
            .includes(needle);
        })
        .sort((a, b) => lastAgentAt(b) - lastAgentAt(a)),
    [needle, state.bots],
  );

  const rooms = useMemo(
    () =>
      state.bloks
        .filter((room) => {
          if (!needle) return true;
          return `${room.name} ${previewLine(room.messages.at(-1))}`
            .toLowerCase()
            .includes(needle);
        })
        .sort((a, b) => lastRoomAt(b) - lastRoomAt(a)),
    [needle, state.bloks],
  );

  const openAgent = (bot: Bot) => {
    dispatch({ type: "select", id: bot.id });
    onOpenConversation();
  };

  const openRoom = (room: Blok) => {
    dispatch({ type: "select", id: room.id });
    onOpenConversation();
  };

  const create = () =>
    dispatch({
      type: tab === "agents" ? "toggleNewAgent" : "toggleNewRoom",
      open: true,
    });

  return (
    <main className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border/70 bg-background">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div>
            <div className="text-[24px] font-semibold tracking-[-0.035em]">Diza</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">Obrolan</div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={create}
              className="flex size-10 items-center justify-center rounded-full transition-colors active:bg-accent"
              aria-label={tab === "agents" ? "Buat agent" : "Buat room"}
            >
              <Plus size={22} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleAppSettings", open: true })}
              className="flex size-10 items-center justify-center rounded-full transition-colors active:bg-accent"
              aria-label="Pengaturan"
            >
              <Settings size={20} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="px-4 pb-3">
          <div className="flex h-11 items-center gap-2 rounded-full bg-muted px-4">
            <Search size={18} className="shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "agents" ? "Cari agent" : "Cari room"}
              className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="grid grid-cols-2">
          {([
            ["agents", "Agents"],
            ["rooms", "Rooms"],
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
                  "relative h-11 text-[14px] font-semibold transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
                <span
                  className={cn(
                    "absolute bottom-0 left-1/2 h-[3px] w-14 -translate-x-1/2 rounded-full bg-foreground transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </header>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {tab === "agents" ? (
          agents.length ? (
            agents.map((bot) => {
              const last = bot.messages.at(-1);
              const at = lastAgentAt(bot);
              return (
                <button
                  key={bot.id}
                  type="button"
                  onClick={() => openAgent(bot)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/70"
                >
                  <AgentAvatar bot={bot} size={52} className="rounded-full" />
                  <span className="min-w-0 flex-1 border-b border-border/60 pb-3">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[15.5px] font-semibold">{bot.name}</span>
                      {at > 0 && (
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">
                          {formatWhen(at)}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted-foreground">
                        {previewLine(last) || "Belum ada pesan"}
                      </span>
                      {bot.unread && <span className="size-2.5 shrink-0 rounded-full bg-foreground" />}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <Empty label={needle ? "Agent tidak ditemukan" : "Belum ada agent"} />
          )
        ) : rooms.length ? (
          rooms.map((room) => {
            const last = room.messages.at(-1);
            const at = lastRoomAt(room);
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => openRoom(room)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-accent/70"
              >
                <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-muted">
                  <Users size={22} strokeWidth={1.7} />
                </span>
                <span className="min-w-0 flex-1 border-b border-border/60 pb-3">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15.5px] font-semibold">{room.name}</span>
                    {at > 0 && (
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">
                        {formatWhen(at)}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-[13.5px] text-muted-foreground">
                    {previewLine(last) || "Belum ada pesan"}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <Empty label={needle ? "Room tidak ditemukan" : "Belum ada room"} />
        )}
      </section>
    </main>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-8 pb-24 text-center text-[13px] text-muted-foreground">
      {label}
    </div>
  );
}
