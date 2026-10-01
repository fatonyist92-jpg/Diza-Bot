import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";
import BotIcon from "lucide-react/dist/esm/icons/bot.mjs";
import { StoreProvider, useStore } from "@/state/store";
import { Intro, introPending } from "@/components/Intro";
import { initAnalytics, setupDone, workspaceSetupDone } from "@/lib/analytics";
import { unreadCount } from "@/lib/unread";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { NewAgentScreen } from "@/components/NewAgentScreen";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { SkillsPanel } from "@/components/SkillsPanel";
import { RoomView } from "@/components/RoomView";
import { NewRoomDialog } from "@/components/NewRoomDialog";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AutomationsPanel } from "@/components/AutomationsPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { ProjectsPanel } from "@/components/ProjectsPanel";
import { ActivityPanel } from "@/components/Activity";
import { CommandPalette } from "@/components/CommandPalette";
import { QuickAsk } from "@/components/QuickAsk";
import { MobileChatHome } from "@/components/MobileChatHome";
import { ProfilePanel } from "@/components/ProfilePanel";

function transitionUi(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update));
}

function Shell() {
  const { state, dispatch } = useStore();
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [mobileHome, setMobileHome] = useState(() => window.innerWidth < 768);
  const [mobileList, setMobileList] = useState<"rooms" | "bots" | null>(null);
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  useEffect(() => {
    if (!mobile || mobileHome) return;
    history.pushState({ dizaMobileChat: true }, "", location.href);
    const onPopState = () => transitionUi(() => setMobileHome(true));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [mobile, mobileHome]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      setMobile(media.matches);
      if (!media.matches) setMobileHome(false);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const room = state.bloks.find((b) => b.id === state.selectedId);
  const bot = room
    ? null
    : (state.bots.find((b) => b.id === state.selectedId && !b.hidden) ??
      state.bots.find((b) => !b.hidden) ??
      null);

  // The Dock badge mirrors the sidebar's unread dots. Absent bridge
  // means a browser tab, which has no Dock to speak of.
  const waiting = unreadCount(state.bots);
  useEffect(() => {
    window.bloks?.badgeSet?.(waiting);
  }, [waiting]);
  if (mobile && mobileList) {
    const rooms = state.bloks;
    const bots = state.bots.filter((b) => !b.hidden);
    const roomsMode = mobileList === "rooms";
    return (
      <main className="flex h-full min-h-0 w-full flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-4">
          <button onClick={() => transitionUi(() => setMobileList(null))} className="flex size-9 items-center justify-center rounded-full active:bg-accent" aria-label="Kembali">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 text-[20px] font-semibold">{roomsMode ? "Ruang" : "Bot"}</div>
          <button
            onClick={() => dispatch({ type: roomsMode ? "toggleNewRoom" : "toggleNewAgent", open: true })}
            className="flex size-9 items-center justify-center rounded-full active:bg-accent"
            aria-label={roomsMode ? "Buat ruang" : "Buat bot"}
          >
            <Plus size={21} />
          </button>
        </header>
        <section className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
          {roomsMode ? rooms.map((room) => (
            <button key={room.id} onClick={() => transitionUi(() => { dispatch({ type: "select", id: room.id }); setMobileList(null); setMobileHome(false); })} className="flex w-full items-center gap-3 border-b border-border/55 px-1 py-3 text-left active:bg-accent/60">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent"><Users size={20} /></span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{room.name}</span>
            </button>
          )) : bots.map((item) => (
            <button key={item.id} onClick={() => transitionUi(() => { dispatch({ type: "select", id: item.id }); setMobileList(null); setMobileHome(false); })} className="flex w-full items-center gap-3 border-b border-border/55 px-1 py-3 text-left active:bg-accent/60">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent"><BotIcon size={20} /></span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{item.name}</span>
            </button>
          ))}
        </section>
        {state.newRoomOpen && <NewRoomDialog />}
        {state.newAgentOpen && <NewAgentScreen />}
      </main>
    );
  }

  if (mobile && mobileHome) {
    return (
      <>
        <MobileChatHome
          onOpenChat={() => transitionUi(() => setMobileHome(false))}
          onOpenRooms={() => transitionUi(() => setMobileList("rooms"))}
          onOpenBots={() => transitionUi(() => setMobileList("bots"))}
          onOpenProfile={() => transitionUi(() => setMobileProfileOpen(true))}
        />
        {state.appSettingsOpen && <AppSettingsPanel />}
        {mobileProfileOpen && <ProfilePanel onClose={() => transitionUi(() => setMobileProfileOpen(false))} />}
        {state.newAgentOpen && <NewAgentScreen />}
      </>
    );
  }

  return (
    <div data-app-shell="diza-bot" className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background md:flex-row">
      {!mobile && <Sidebar />}
      {/* Automations lives beside the sidebar like any other view, so
          opening it never hides the agent list. */}
      {state.routinesOpen ? (
        <AutomationsPanel onClose={() => dispatch({ type: "toggleRoutines", open: false })} />
      ) : room ? (
        <RoomView blok={room} />
      ) : bot ? (
        <ChatView bot={bot} onMobileBack={mobile ? () => transitionUi(() => setMobileHome(true)) : undefined} />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "Belum ada agen" : "Menghubungkan ke server Bloks…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Jalankan dengan <code className="rounded bg-muted px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.skillsOpen && <SkillsPanel />}
      {state.newRoomOpen && <NewRoomDialog />}
      {state.newAgentOpen && <NewAgentScreen />}
      {state.projectsOpen && <ProjectsPanel />}
      {state.activityOpen && <ActivityPanel />}
      <CommandPalette />
    </div>
  );
}

export default function App() {
  // The panel window loads the same bundle with a flag. It shares nothing
  // else with the workspace: no store, no stream, no intro, because it is
  // open for four seconds at a time.
  if (new URLSearchParams(location.search).has("quick")) return <QuickAsk />;

  // First launch runs the cinematic intro, then the working onboarding.
  // Two separate flags on purpose: someone who skips the intro still needs
  // setup, and someone who resets setup should not sit through the film
  // twice.
  const forced = new URLSearchParams(location.search).has("intro");
  const [introOpen, setIntroOpen] = useState(true);
  // Until the workspace answers, showing the dashboard would be a guess,
  // and a wrong guess flashes the whole app for a moment before the
  // welcome covers it. A workspace that has clearly never been set up
  // needs no wait; everyone else holds on the app's own background for
  // the few milliseconds a loopback request takes.
  const [settled, setSettled] = useState(() => introPending() && !setupDone());
  useEffect(() => {
    initAnalytics();
    // The browser's flag is only a first guess: it is per origin, and the
    // app's origin moves with its port. The workspace itself is the
    // authority, so correct course as soon as it answers. A workspace that
    // has been set up closes both; one that has not opens them, which is
    // what makes a fresh install reliably show the welcome.
    void workspaceSetupDone()
      .then(() => {
        if (forced) return;
        // DIZA Web intentionally shows its five-second identity intro on every app entry.
        setIntroOpen(true);
      })
      .finally(() => setSettled(true));
  }, [forced]);
  if (!settled) return <div className="h-full bg-background" />;
  return (
    <StoreProvider>
      <Shell />
      {introOpen && <Intro onDone={() => setIntroOpen(false)} />}
    </StoreProvider>
  );
}
