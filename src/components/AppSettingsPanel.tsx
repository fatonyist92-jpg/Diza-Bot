// App-level settings, as a centered overlay: appearance plus the
// credentials shared by all agents. Per-agent settings live in
// SettingsPanel; contextual Box-token entry also stays in ComputerPanel.
import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Monitor from "lucide-react/dist/esm/icons/monitor.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { api, useStore } from "@/state/store";
import { useTheme, type Theme } from "@/lib/theme";
import type { UpdateState } from "@/types/bridge";
import { RecordPanel } from "./RecordPanel";
import { RulesPanel } from "./RulesPanel";
import { ApiKeyRow } from "./ApiKeys";
import { McpServersCard } from "./McpServers";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EnginesPanel } from "./EnginesPanel";
import { CloudSection } from "./CloudSection";
import { DevicesSection } from "./DevicesSection";
import { TelegramSection } from "./TelegramSection";
import { ChatSection } from "./ChatSection";
import { RemoteSection } from "./RemoteSection";
import { LocalVmSection } from "./LocalVmSection";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { thisComputer } from "@/lib/thisComputer";
import { getServerUrl, normalizeServerUrl, saveServerUrl, testServer } from "@/lib/serverUrl";

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: "light", label: "Terang", icon: <Sun size={14} /> },
  { value: "dark", label: "Gelap", icon: <Moon size={14} /> },
  { value: "system", label: "Sistem", icon: <Monitor size={14} /> },
];

/**
 * How a long conversation is kept inside the model's window.
 *
 * The switch is off, and it says what it trades rather than only what it
 * gives. Both settings work; one pays in a pause and the other pays in
 * cache misses, and which is cheaper depends on the provider, so the
 * honest thing is to describe both and let the person choose.
 */
function Compaction() {
  const { state, dispatch } = useStore();
  const on = state.config?.compaction?.micro ?? false;
  const [saving, setSaving] = useState(false);

  const set = (micro: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ compaction: { micro } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
            Summarise as you go
            <InfoTip text="Percakapan panjang perlu diringkas agar tetap muat dalam konteks. Jika nonaktif, peringkasan dilakukan sekali saat konteks penuh sehingga ada jeda sebelum pesan berikutnya. Jika aktif, satu pesan diringkas setelah setiap giliran sehingga tidak ada jeda. Konsekuensinya, ringkasan menulis ulang konteks yang sudah dikirim sehingga provider mungkin tidak dapat menggunakan cache. Pesan Anda sendiri tidak pernah diringkas dalam kedua mode." />
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Fold the conversation a little after each turn instead of all at once when it fills up.
          </div>
        </div>
        <Switch aria-label="Ringkas sambil berjalan" checked={on} disabled={saving} onCheckedChange={set} />
      </div>
    </div>
  );
}

/**
 * Whether a finished session gets read back for something worth keeping.
 *
 * Off, like everything here that spends money nobody asked for. What it
 * finds is always staged rather than installed, and the card says so,
 * because "it writes its own instructions" is a sentence that should come
 * with the word "suggests" attached.
 */
function ProposeSkills() {
  const { state, dispatch } = useStore();
  const on = state.config?.skills?.propose ?? false;
  const [saving, setSaving] = useState(false);

  const set = (propose: boolean) => {
    setSaving(true);
    api("/api/config", { method: "PUT", body: JSON.stringify({ skills: { propose } }) })
      .then((status) => dispatch({ type: "configStatus", config: status }))
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
            Suggest skills
            <InfoTip text="Tidak ada yang dipasang otomatis. Saran akan menunggu di Skill dengan teks yang sudah disiapkan, dan Anda cukup sekali menekan untuk menyimpannya. Membaca ulang sesi membutuhkan satu panggilan ringan menggunakan kunci Anda sendiri, sehingga fitur ini nonaktif sampai Anda mengaktifkannya." />
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            After a conversation that worked something out, read it back and write the procedure
            down as a skill. Most conversations teach nothing and nothing is suggested for them.
          </div>
        </div>
        <Switch aria-label="Sarankan skill" checked={on} disabled={saving} onCheckedChange={set} />
      </div>
    </div>
  );
}

/** Shared context every agent receives. Optional, never asked for up
 * front: it lives here for whenever you feel like writing it. */
/**
 * What version this is, and the way to the next one.
 *
 * The updater already runs on its own at launch; this card exists so a
 * person can ask instead of waiting, watch the download when there is
 * one, and restart into it the moment it is ready. In a plain browser
 * tab there is no updater and the card says only what it knows.
 */
function AboutCard() {
  const [version, setVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateState>({ state: "idle" });

  useEffect(() => {
    void window.bloks?.appVersion?.().then(setVersion);
    void window.bloks?.updateState?.().then(setUpdate);
    return window.bloks?.onUpdateState?.(setUpdate);
  }, []);

  const line =
    update.state === "checking"
      ? "Memeriksa pembaruan…"
      : update.state === "downloading"
        ? `Mengunduh ${update.version ?? "pembaruan"}${update.percent ? ` (${update.percent}%)` : ""}…`
        : update.state === "current"
          ? "Anda menggunakan versi terbaru."
          : update.state === "ready"
            ? `${update.version ?? "Pembaruan"} sudah diunduh dan siap dipasang.`
            : update.state === "error"
              ? "The update check didn't reach the server. It will retry on next launch."
              : update.state === "dev"
                ? "Pembaruan berlaku untuk aplikasi terpasang, bukan build pengembangan."
                : null;

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">
          Bloks {version ?? ""}
        </div>
        {update.state === "ready" ? (
          <Button size="sm" onClick={() => void window.bloks?.updateInstall?.()}>
            Mulai ulang untuk memperbarui
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled={!window.bloks || update.state === "checking" || update.state === "downloading"}
            onClick={() => void window.bloks?.updateCheck?.().then(setUpdate)}
          >
            Periksa pembaruan
          </Button>
        )}
      </div>
      {line && <div className="mt-1.5 text-[12.5px] text-muted-foreground">{line}</div>}
      <div className="mt-2 text-[12.5px] text-muted-foreground">
        Ada yang rusak atau belum tersedia?{" "}
        <a
          href={`https://github.com/hamedgitty/bloks/issues/new?body=${encodeURIComponent(`\n\n---\nBloks ${version ?? ""} on ${navigator.platform}`)}`}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Kirim masukan
        </a>
        {" "}(membuka GitHub; tempel diagnostik di bawah jika diperlukan).
      </div>
    </div>
  );
}

/**
 * One button between "it doesn't work" and a useful bug report. The
 * server assembles the facts (versions, engine states, which
 * credentials exist as booleans, never values) and this copies them,
 * ready to paste into a GitHub issue.
 */
function Diagnostics() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    try {
      const report = await fetch("/api/diagnostics").then((r) => {
        if (!r.ok) throw new Error();
        return r.text();
      });
      await navigator.clipboard.writeText(report);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
        Diagnostics
        <InfoTip text="Laporan berisi versi, status koneksi engine, status apakah kunci tersedia atau tidak, dan jumlah agen. Nilai kunci tidak pernah disertakan, dan teks akhir dibersihkan dari pola yang menyerupai kredensial." />
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Copies a short report about this install, ready to paste into a bug report.
      </div>
      <button
        onClick={() => void copy()}
        className="mt-3 rounded-xl border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-accent"
      >
        {copied ? "Copied" : "Salin diagnostik"}
      </button>
      {failed && (
        <div className="mt-2 text-[12px] text-destructive">
          Couldn't build the report. Is the server running?
        </div>
      )}
    </div>
  );
}

function AboutYou() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.about ?? "";
  const [value, setValue] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  // adopt the server value once it arrives, without stomping an edit
  useEffect(() => {
    if (hydrated.current || !state.config) return;
    hydrated.current = true;
    setValue(saved);
  }, [state.config, saved]);

  const save = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ profile: { about: next } }),
      })
        .then((status) => {
          dispatch({ type: "configStatus", config: status });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1600);
        })
        .catch(() => {});
    }, 600);
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">Tentang Anda</div>
        {justSaved && (
          <span className="flex items-center gap-1 text-[11.5px] text-success">
            <Check size={12} /> Tersimpan
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Konteks opsional yang diterima semua agen. Tetap tersimpan di {thisComputer()}.
      </div>
      <Textarea
        value={value}
        onChange={(e) => save(e.target.value)}
        placeholder="mis. Saya sedang membangun aplikasi agen local-first. Buat jawaban singkat dan langsung ke inti."
        className="mt-3 min-h-[88px] resize-none text-[13px]"
      />
    </div>
  );
}

/** A key found elsewhere on this machine is an OFFER, never a default:
 * using it bills an account the user set up for something else. This
 * card asks plainly and remembers the answer either way. */
function DizaPreferences() {
  const { state, dispatch } = useStore();
  const saved = state.config?.profile?.preferences ?? "";
  const [value, setValue] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current || !state.config) return;
    hydrated.current = true;
    setValue(saved);
  }, [state.config, saved]);

  const save = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api("/api/config", { method: "PUT", body: JSON.stringify({ profile: { preferences: next } }) })
        .then((status) => {
          dispatch({ type: "configStatus", config: status });
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1600);
        })
        .catch(() => {});
    }, 600);
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-foreground">Cara Diza merespons</div>
        {justSaved && <span className="flex items-center gap-1 text-[11.5px] text-success"><Check size={12} /> Tersimpan</span>}
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Preferensi respons ini tetap sama meskipun provider AI diganti.
      </div>
      <Textarea value={value} onChange={(e) => save(e.target.value)}
        placeholder="mis. Gunakan Bahasa Indonesia, jelaskan istilah teknis dengan sederhana, dan buat jawaban ringkas."
        className="mt-3 min-h-[88px] resize-none text-[13px]" />
    </div>
  );
}



function ServerConnection() {
  const [draft, setDraft] = useState(() => getServerUrl());
  const [saved, setSaved] = useState(() => getServerUrl());
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const test = async () => {
    setTesting(true);
    setMessage(null);
    const result = await testServer(draft);
    setMessage({ ok: result.ok, text: result.message });
    setTesting(false);
  };

  const save = () => {
    const trimmed = draft.trim();
    const normalized = trimmed ? normalizeServerUrl(trimmed) : "";
    if (trimmed && !normalized) {
      setMessage({ ok: false, text: "Alamat server tidak valid. Gunakan http:// atau https://." });
      return;
    }
    const next = saveServerUrl(normalized);
    setDraft(next);
    setSaved(next);
    setMessage({
      ok: true,
      text: next
        ? "Alamat server tersimpan. Koneksi baru akan memakai server ini."
        : "Mode server lokal/satu-origin aktif.",
    });
  };

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="text-[13.5px] font-semibold text-foreground">Server DIZA</div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Alamat backend yang dipakai APK/PWA. Untuk server sementara di HP, masukkan URL tunnel hostc.app.
      </div>
      <div className="mt-3">
        <label className="text-[11.5px] font-medium text-muted-foreground" htmlFor="diza-server-url">
          Alamat server
        </label>
        <input
          id="diza-server-url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage(null);
          }}
          placeholder="https://xxxxxxxx.hostc.app"
          className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring/60"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void test()} disabled={testing || !draft.trim()}>
          {testing ? "Menguji…" : "Tes"}
        </Button>
        <Button size="sm" onClick={save} disabled={draft.trim() === saved}>
          Simpan
        </Button>
        {saved && (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              saveServerUrl("");
              setSaved("");
              setMessage({ ok: true, text: "Alamat server dihapus. Mode satu-origin aktif." });
            }}
            className="ml-auto rounded-lg px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Hapus
          </button>
        )}
      </div>
      {message && (
        <div className={cn("mt-2 text-[12px]", message.ok ? "text-success" : "text-destructive")}>
          {message.text}
        </div>
      )}
    </div>
  );
}


const SETTINGS_TABS = [
  ["general", "Umum"],
  ["engines", "Engine"],
  ["apps", "Aplikasi"],
  ["localvm", "VM Lokal"],
  ["voices", "Suara"],
  ["devices", "Perangkat"],
  ["rules", "Aturan"],
  ["record", "Rekam"],
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number][0];


/**
 * The system-wide hotkey, and the honest reporting around it.
 *
 * Off until somebody sets one: a global shortcut that arrives uninvited
 * will sooner or later collide with something they already use. And
 * because another app may already own the keys, registration answers
 * with what actually took rather than assuming it worked.
 */
function QuickAskShortcut() {
  const [accelerator, setAccelerator] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAccelerator(c.shortcuts?.quickAsk ?? null))
      .catch(() => {});
  }, []);

  const save = async (next: string | null) => {
    setProblem(null);
    const took = (await window.bloks?.shortcutApply(next)) ?? null;
    if (next && !took) {
      setProblem("Kombinasi tombol itu sudah digunakan aplikasi lain. Coba kombinasi berbeda.");
      return;
    }
    setAccelerator(took);
    await fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shortcuts: { quickAsk: took } }),
    }).catch(() => {});
  };

  // Reading a chord off a keypress, in Electron's own spelling.
  const capture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const key = e.key;
    if (key === "Escape") return setCapturing(false);
    // a modifier on its own is not a shortcut, it is half of one
    if (["Shift", "Control", "Alt", "Meta"].includes(key)) return;
    const parts: string[] = [];
    if (e.metaKey) parts.push("Command");
    if (e.ctrlKey) parts.push("Control");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (parts.length === 0) {
      setProblem("Pintasan global memerlukan setidaknya satu tombol modifier agar tidak aktif saat Anda mengetik.");
      return;
    }
    parts.push(key.length === 1 ? key.toUpperCase() : key);
    setCapturing(false);
    void save(parts.join("+"));
  };

  if (!window.bloks) return null;

  return (
    <div className="mt-4 rounded-2xl border bg-card p-4">
      <div className="text-[13.5px] font-semibold text-foreground">Tanya cepat</div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
        A shortcut that works anywhere on {thisComputer()}. It opens one line over whatever
        you are doing, sends it to an agent, and gets out of the way.
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => {
            setProblem(null);
            setCapturing(true);
          }}
          onKeyDown={capturing ? capture : undefined}
          className={cn(
            "min-w-[168px] rounded-xl border px-3 py-2 text-[13px] transition-colors",
            capturing
              ? "border-brand bg-brand-soft text-foreground"
              : "border-input text-foreground hover:border-foreground/25",
          )}
        >
          {capturing ? "Tekan kombinasi tombol…" : (accelerator ?? "Belum diatur")}
        </button>
        {accelerator && !capturing && (
          <button
            onClick={() => void save(null)}
            className="rounded-lg px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Hapus
          </button>
        )}
      </div>
      {problem && <div className="mt-2 text-[12px] text-destructive">{problem}</div>}
      <div className="mt-2 text-[11.5px] text-muted-foreground">
        Tab memilih agen lain, Enter mengirim, Escape menutup.
      </div>
    </div>
  );
}

export function AppSettingsPanel() {
  const { dispatch } = useStore();
  const { theme, setTheme } = useTheme();
  const [tab, setTab] = useState<SettingsTab>("general");

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && dispatch({ type: "toggleAppSettings", open: false })}
    >
      <DialogContent className="flex h-[85vh] max-h-[640px] w-full max-w-[720px] flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-[52px] shrink-0 items-center border-b px-5">
          <DialogTitle className="text-[14.5px]">Pengaturan</DialogTitle>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/*
            The category rail, which stops being a rail on a narrow
            window. Below sm it is a scrolling row above the content,
            because 150px of nav out of 375px of window leaves body copy
            wrapping every two or three words. Kept as one list rather
            than two so the tabs cannot drift apart.
          */}
          <nav
            className={cn(
              "flex shrink-0 gap-0.5 overflow-x-auto border-b p-2",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              "sm:w-[150px] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-2.5",
            )}
          >
            {SETTINGS_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 sm:w-full sm:text-left",
                  tab === key
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-5">
            {tab === "general" && (
              <>
                <div className="mt-4 rounded-2xl border bg-card p-4">
                  <div className="text-[13.5px] font-semibold text-foreground">Tampilan</div>
                  <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                    Pilih tampilan DIZA di {thisComputer()}
                  </div>
                  <div className="mt-3 flex gap-1 rounded-xl bg-muted p-1">
                    {THEME_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] transition-colors duration-150",
                          theme === option.value
                            ? "bg-background font-medium text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <ServerConnection />
                <QuickAskShortcut />
                <Compaction />
                <ProposeSkills />
                <AboutYou />
                <DizaPreferences />
                <Diagnostics />
                <AboutCard />
              </>
            )}

            {tab === "engines" && <EnginesPanel />}

            {tab === "apps" && (
              <>
              <div className="mt-4 rounded-2xl border bg-card p-4">
                <div className="text-[13.5px] font-semibold text-foreground">Aplikasi dan komputer</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Dipakai bersama oleh semua agen. Key tetap tersimpan di {thisComputer()}.
                </div>
                <div className="mt-4 flex flex-col gap-4">
                  <ApiKeyRow
                    section="composio"
                    label="Composio Connect key"
                    placeholder="ck_…"
                    info={{
                      text: "Composio memiliki dua jenis key. Ini adalah Connect key (diawali ck_) untuk menghubungkan akun seperti Slack dan Gmail. Key diperiksa ke Composio saat disimpan.",
                      linkLabel: "Dapatkan Connect key di composio.dev",
                      linkHref: "https://composio.dev",
                    }}
                  />
                  <ApiKeyRow
                    section="composioApi"
                    label="Kunci API Composio (opsional)"
                    placeholder="ak_…  membuka seluruh katalog aplikasi"
                    info={{
                      text: "Key Composio lainnya adalah project API key (diawali ak_), terpisah dari Connect key di atas. Key ini hanya dipakai untuk melihat katalog aplikasi lengkap; koneksi tetap dapat bekerja tanpanya.",
                    }}
                  />
                  <ApiKeyRow
                    section="box"
                    label="Box API key"
                    placeholder="Tempel kunci API Box Anda"
                    info={{
                      text: "Memberikan komputer Linux jarak jauh yang terisolasi kepada agen, lengkap dengan desktop dan terminal. Box menjadi layanan berbayar setelah masa uji coba, sehingga penggunaan dapat dikenai biaya.",
                      linkLabel: "Buka panduan kunci API Box",
                      linkHref: "https://docs.ascii.dev/box/api-keys",
                    }}
                  />
                </div>
              </div>
              <McpServersCard />
              </>
            )}

            {tab === "localvm" && <LocalVmSection />}

            {tab === "rules" && <RulesPanel />}

            {tab === "record" && <RecordPanel />}

            {tab === "devices" && (
              <>
                <RemoteSection />
                <DevicesSection />
                <TelegramSection />
                <ChatSection />
                <CloudSection />
              </>
            )}

            {tab === "voices" && (
              <div className="mt-4 rounded-2xl border bg-card p-4">
                <div className="text-[13.5px] font-semibold text-foreground">Suara</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  DIZA Voice menggunakan mode GRATIS SAJA. Suara keluaran memakai voice yang tersedia di perangkat/browser. Input suara memakai pengenal suara bawaan perangkat atau browser bila tersedia. DIZA tidak memanggil API speech ElevenLabs/OpenAI dan tidak mengirim audio mikrofon mentah ke provider LLM. Layanan pengenalan suara bawaan browser/OS tetap dapat digunakan sesuai implementasi platform.
                </div>
                <div className="mt-3 rounded-xl border border-success/30 bg-success/5 p-3 text-[12px] leading-relaxed text-muted-foreground">
                  Pilih voice perangkat untuk setiap agen dari Pengaturan Agen. Daftar dan nama voice dapat berbeda di tiap perangkat.
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
