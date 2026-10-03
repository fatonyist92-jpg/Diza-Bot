import { useEffect, useRef, useState } from "react";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
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

function Shell() {
  const { state, dispatch } = useStore();
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  const [mobileHome, setMobileHome] = useState(() => window.innerWidth < 768);
  const mobileHomeRef = useRef(mobileHome);

  useEffect(() => {
    mobileHomeRef.current = mobileHome;
  }, [mobileHome]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      setMobile(media.matches);
      if (!media.matches) setMobileHome(false);
      if (media.matches && window.innerWidth < 768) setMobileHome((current) => current);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  // Android/PWA back behaviour:
  // 1) from any conversation, Back returns to Home;
  // 2) from Home, Back asks before leaving the app.
  useEffect(() => {
    if (!mobile) return;
    const guard = { ...(history.state ?? {}), dizaHomeGuard: true };
    history.pushState(guard, "", location.href);

    const onPopState = () => {
      if (!mobileHomeRef.current) {
        setMobileHome(true);
        history.pushState(guard, "", location.href);
        return;
      }

      const leave = window.confirm("Apakah Anda yakin ingin keluar?");
      if (!leave) {
        history.pushState(guard, "", location.href);
        return;
      }

      window.removeEventListener("popstate", onPopState);
      history.back();
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [mobile]);

  const room = state.bloks.find((b) => b.id === state.selectedId);
  const bot = room
    ? null
    : (state.bots.find((b) => b.id === state.selectedId && !b.hidden) ??
      state.bots.find((b) => !b.hidden) ??
      null);

  const waiting = unreadCount(state.bots);
  useEffect(() => {
    window.bloks?.badgeSet?.(waiting);
  }, [waiting]);

  if (mobile && mobileHome) {
    return (
      <>
        <MobileChatHome onOpenChat={() => setMobileHome(false)} />
        {state.appSettingsOpen && <AppSettingsPanel />}
        {state.newRoomOpen && <NewRoomDialog />}
        {state.newAgentOpen && <NewAgentScreen />}
      </>
    );
  }

  return (
    <div data-app-shell="diza-bot" className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background md:flex-row">
      {!mobile && <Sidebar />}
      {state.routinesOpen ? (
        <AutomationsPanel onClose={() => dispatch({ type: "toggleRoutines", open: false })} />
      ) : room ? (
        <RoomView blok={room} onMobileBack={mobile ? () => setMobileHome(true) : undefined} />
      ) : bot ? (
        <ChatView bot={bot} onMobileBack={mobile ? () => setMobileHome(true) : undefined} />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "Belum ada agen" : "Menghubungkan ke server DIZA…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Periksa alamat server di <span className="font-medium text-foreground">Pengaturan</span>.
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
  if (new URLSearchParams(location.search).has("quick")) return <QuickAsk />;

  const forced = new URLSearchParams(location.search).has("intro");
  const [introOpen, setIntroOpen] = useState(true);
  const [settled, setSettled] = useState(() => introPending() && !setupDone());

  useEffect(() => {
    initAnalytics();
    void workspaceSetupDone()
      .then(() => {
        if (forced) return;
        // DIZA memperlihatkan identitas singkat selama lima detik setiap aplikasi dibuka.
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
