// Engines: every model provider Bloks can talk to, and how you sign in.
//
// The row tells you the truth about the auth up front. OpenRouter is a
// real browser sign-in; the rest are a pasted key, a CLI that already
// holds a login, or a server on this machine. Nothing here pretends to be
// a sign-in that is really a text field.
import { useEffect, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ExternalLink from "lucide-react/dist/esm/icons/external-link.mjs";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import { api, useStore, type ProviderRow } from "@/state/store";
import { CustomEndpoints } from "./CustomEndpoints";
import { ProviderMark } from "./ProviderIcons";
import { GlobalEnginePicker } from "./ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const AUTH_NOTE: Record<ProviderRow["auth"], string> = {
  oauth: "Login melalui browser",
  key: "API key",
  cli: "Login melalui CLI",
  none: "Berjalan di perangkat ini",
};

function KeyForm({ provider, onDone }: { provider: ProviderRow; onDone: () => void }) {
  const { dispatch } = useStore();
  const [key, setKey] = useState("");
  const mismatched = Boolean(provider.keyPrefix && key && !key.startsWith(provider.keyPrefix));

  const save = () => {
    if (!key.trim()) return;
    dispatch({ type: "connectProvider", kind: provider.kind, key: key.trim() });
    onDone();
  };

  return (
    <div className="mt-2.5">
      <div className="flex gap-2">
        <Input
          autoFocus
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onDone();
          }}
          placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : "Tempel API key"}
          autoComplete="off"
          className="h-8 text-[13px]"
        />
        <Button variant="secondary" onClick={save} disabled={!key.trim()} className="w-[72px]">
          <Check size={13} />
          Simpan
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={cn("text-[11.5px]", mismatched ? "text-warning" : "text-muted-foreground")}>
          {mismatched ? `Key biasanya diawali ${provider.keyPrefix}` : provider.keyHint}
        </span>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Buka sumber key <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function EngineRow({ provider }: { provider: ProviderRow }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [codexLogin, setCodexLogin] = useState<{
    status: "idle" | "pending" | "connected" | "failed";
    verificationUrl?: string;
    userCode?: string;
    error?: string;
  } | null>(null);
  const [grokLogin, setGrokLogin] = useState<{
    status: "idle" | "pending" | "connected" | "failed";
    verificationUrl?: string;
    userCode?: string;
    error?: string;
  } | null>(null);

  // an engine can be connected and still be down: no CLI on PATH, a key
  // the provider rejected, a local server that is not running
  const instance = state.instances.find((i) => i.driverKind === provider.kind);
  const down = instance && instance.snapshot.state !== "available";
  const active = Boolean(instance && state.config?.engine?.instanceId === instance.instanceId);
  const canActivate = Boolean(
    instance &&
    provider.connected &&
    !provider.needsSignIn &&
    !down &&
    instance.models.options.length > 0,
  );

  const activate = async () => {
    if (!instance || active || !canActivate) return;
    const model =
      state.config?.engine?.instanceId === instance.instanceId
        ? state.config.engine.model
        : instance.models.default || instance.models.options[0]?.id;
    if (!model) {
      setError("Engine ini belum memiliki model yang bisa dipilih.");
      return;
    }
    setActivating(true);
    setError(null);
    try {
      const config = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ engine: { instanceId: instance.instanceId, model } }),
      });
      dispatch({ type: "configStatus", config });
      await refreshEngines();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  };

  const signIn = () => {
    setSigningIn(true);
    setError(null);
    api(`/api/oauth/${provider.kind}/start`, { method: "POST" })
      .then(({ url }) => {
        // Electron hands this to the system browser; the callback lands
        // back on the harness, which broadcasts the new connection.
        window.open(url, "_blank", "noopener");
      })
      .catch((e) => setError(e.message))
      .finally(() => setSigningIn(false));
  };

  const refreshEngines = () =>
    Promise.all([
      api("/api/providers").then(({ providers }) => dispatch({ type: "providers", providers })),
      api("/api/instances").then(({ instances }) => dispatch({ type: "instances", instances })),
    ]);

  const signInCodex = () => {
    setSigningIn(true);
    setError(null);
    const authWindow = window.open("about:blank", "_blank");
    api("/api/providers/codex/login", { method: "POST" })
      .then((login) => {
        setCodexLogin(login);
        if (login.status === "connected") {
          authWindow?.close();
          return refreshEngines();
        }
        if (login.status === "pending" && login.verificationUrl) {
          if (authWindow) authWindow.location.href = login.verificationUrl;
          else window.open(login.verificationUrl, "_blank", "noopener");
        } else {
          authWindow?.close();
        }
      })
      .catch((e) => {
        authWindow?.close();
        setError(e.message);
      })
      .finally(() => setSigningIn(false));
  };

  const signInGrok = () => {
    setSigningIn(true);
    setError(null);
    api("/api/providers/grokCli/login", { method: "POST" })
      .then((login) => {
        setGrokLogin(login);
        if (login.status === "connected") return refreshEngines();
        if (login.status === "pending" && login.verificationUrl) {
          window.open(login.verificationUrl, "_blank", "noopener");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setSigningIn(false));
  };

  useEffect(() => {
    if (provider.kind !== "codex" || codexLogin?.status !== "pending") return;
    const poll = () => {
      api("/api/providers/codex/login")
        .then((login) => {
          // Status polling intentionally omits the one-time challenge. Preserve it\n          // while login is pending so switching to the OpenAI tab cannot erase\n          // the 9-character code from DIZA.\n          setCodexLogin((current) =>\n            login.status === "pending" && current?.status === "pending"\n              ? { ...current, ...login, userCode: login.userCode ?? current.userCode, verificationUrl: login.verificationUrl ?? current.verificationUrl }\n              : login,\n          );
          if (login.status === "connected") void refreshEngines();
        })
        .catch(() => {});
    };
    const timer = setInterval(poll, 2_000);
    return () => clearInterval(timer);
    // refreshEngines is deliberately local: polling only depends on the
    // provider row and whether a Codex login attempt is active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.kind, codexLogin?.status]);

  useEffect(() => {
    if (provider.kind !== "grokCli" || grokLogin?.status !== "pending") return;
    const poll = () => {
      api("/api/providers/grokCli/login")
        .then((login) => {
          setGrokLogin((current) =>
            login.status === "pending" && current?.status === "pending"
              ? { ...current, ...login, userCode: login.userCode ?? current.userCode, verificationUrl: login.verificationUrl ?? current.verificationUrl }
              : login,
          );
          if (login.status === "connected") void refreshEngines();
        })
        .catch(() => {});
    };
    const timer = setInterval(poll, 2_000);
    return () => clearInterval(timer);
  }, [provider.kind, grokLogin?.status]);

  const act = () => {
    if (provider.auth === "oauth") return signIn();
    if (provider.auth === "none") {
      return dispatch({ type: "connectProvider", kind: provider.kind });
    }
    setOpen((v) => !v);
  };

  return (
    <div className="border-t px-4 py-3 first:border-t-0">
      <div className="flex items-center gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <ProviderMark driverKind={provider.kind} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium text-foreground">{provider.name}</div>
          <div
            className={cn(
              "truncate text-[12px]",
              down ? "text-warning" : provider.connected ? "text-success" : "text-muted-foreground",
            )}
          >
            {down
              ? (instance!.snapshot.reason ?? "Tidak tersedia")
              : provider.connected
                ? "Terhubung"
                : AUTH_NOTE[provider.auth]}
          </div>
        </div>

        {provider.auth === "cli" ? (
          (provider.kind === "codex" || provider.kind === "grokCli") && provider.connected && provider.needsSignIn ? (
            <Button variant="secondary" size="sm" onClick={provider.kind === "codex" ? signInCodex : signInGrok} disabled={signingIn} className="shrink-0">
              {signingIn ? <Loader2 size={13} className="animate-spin" /> : provider.kind === "codex" ? "Login ChatGPT" : "Login"}
            </Button>
          ) : (
            <span className="shrink-0 text-[11.5px] text-muted-foreground">
              {provider.connected ? "" : "Tidak ditemukan"}
            </span>
          )
        ) : provider.connected ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "disconnectProvider", kind: provider.kind })}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            Putuskan
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={act} disabled={signingIn} className="shrink-0">
            {signingIn ? (
              <Loader2 size={13} className="animate-spin" />
            ) : provider.auth === "oauth" ? (
              "Login"
            ) : provider.auth === "none" ? (
              "Aktifkan"
            ) : (
              <>
                <Plus size={13} />
                Key
              </>
            )}
          </Button>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 pl-10">
        <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted-foreground">
          <span
            className={cn(
              "inline-block size-2 rounded-full border",
              active ? "border-foreground bg-foreground" : "border-muted-foreground/50 bg-transparent",
            )}
          />
          <span>{active ? "Aktif" : "Nonaktif"}</span>
          {provider.kind === "codex" && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-foreground">
              Prioritas
            </span>
          )}
        </div>
        <Button
          variant={active ? "ghost" : "secondary"}
          size="sm"
          onClick={() => void activate()}
          disabled={active || !canActivate || activating}
          className="shrink-0"
          title={active ? "Engine ini sedang aktif untuk semua agen dan ruang." : "Aktifkan untuk semua agen dan ruang"}
        >
          {activating ? <Loader2 size={13} className="animate-spin" /> : active ? "Aktif" : "Aktifkan"}
        </Button>
      </div>

      {open && !provider.connected && (
        <KeyForm provider={provider} onDone={() => setOpen(false)} />
      )}
      {provider.auth === "cli" && (!provider.connected || provider.needsSignIn) && (
        <div className="mt-1.5 pl-10 text-[11.5px] leading-relaxed text-muted-foreground">
          {/* Installed and installed-but-signed-out need different advice.
              Some CLIs sign in where we cannot see it, so the second is a
              hint rather than a verdict, and stays muted. */}
          {provider.connected
            ? provider.kind === "codex"
              ? "Codex terpasang. Login ChatGPT untuk menggunakannya."
              : provider.kind === "grokCli"
                ? "Grok CLI terpasang. Login dengan akun Grok untuk menggunakannya."
                : `Login belum terdeteksi. ${provider.signInHint ?? provider.keyHint}`
            : provider.keyHint}
        </div>
      )}
      {provider.kind === "codex" && codexLogin?.status === "pending" && (
        <div className="mt-2 ml-10 rounded-xl border bg-muted/40 px-3 py-2 text-[12px]">
          <div className="text-muted-foreground">Masukkan kode sekali pakai ini di halaman OpenAI:</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="select-all text-[14px] font-semibold tracking-[0.08em] text-foreground">
              {codexLogin.userCode}
            </code>
            {codexLogin.verificationUrl && (
              <a
                href={codexLogin.verificationUrl}
                target="_blank"
                rel="noreferrer"
                className="flex shrink-0 items-center gap-1 font-medium text-foreground"
              >
                Buka OpenAI <ExternalLink size={11} />
              </a>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Menunggu persetujuan…</div>
        </div>
      )}
      {provider.kind === "codex" && codexLogin?.status === "failed" && (
        <div className="mt-1.5 pl-10 text-[12px] text-destructive">
          {codexLogin.error ?? "Login ChatGPT gagal."}
        </div>
      )}
      {provider.kind === "grokCli" && grokLogin?.status === "pending" && (
        <div className="mt-2 ml-10 rounded-xl border bg-muted/40 px-3 py-2 text-[12px]">
          <div className="text-muted-foreground">Masukkan kode sekali pakai ini di halaman xAI:</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <code className="select-all text-[14px] font-semibold tracking-[0.08em] text-foreground">{grokLogin.userCode ?? "Menunggu…"}</code>
            {grokLogin.verificationUrl && <a href={grokLogin.verificationUrl} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 font-medium text-foreground">Buka xAI <ExternalLink size={11} /></a>}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Menunggu persetujuan…</div>
        </div>
      )}
      {provider.kind === "grokCli" && grokLogin?.status === "failed" && (
        <div className="mt-1.5 pl-10 text-[12px] text-destructive">{grokLogin.error ?? "Login Grok gagal."}</div>
      )}
      {error && <div className="mt-1.5 pl-10 text-[12px] text-destructive">{error}</div>}
    </div>
  );
}

function Group({ title, note, rows }: { title: string; note: string; rows: ProviderRow[] }) {
  if (!rows.length) return null;
  return (
    <>
      <div className="border-t bg-muted/30 px-4 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{note}</div>
      </div>
      {rows.map((provider) => (
        <EngineRow key={provider.kind} provider={provider} />
      ))}
    </>
  );
}

const ENGINE_LOAD_ATTEMPTS = 12;
const ENGINE_LOAD_RETRY_MS = 1_500;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function EnginesPanel() {
  const { state, dispatch } = useStore();
  const providers = state.providers;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setLoadError(null);
    let lastError: unknown = null;

    try {
      for (let attempt = 0; attempt < ENGINE_LOAD_ATTEMPTS; attempt += 1) {
        try {
          const [providerPayload, instancePayload, config] = await Promise.all([
            api("/api/providers"),
            api("/api/instances"),
            api("/api/config"),
          ]);
          const nextProviders = Array.isArray(providerPayload?.providers) ? providerPayload.providers : [];
          const nextInstances = Array.isArray(instancePayload?.instances) ? instancePayload.instances : [];
          if (!nextProviders.length || !nextInstances.length) {
            throw new Error("Daftar engine belum siap.");
          }

          dispatch({ type: "providers", providers: nextProviders });
          dispatch({ type: "instances", instances: nextInstances });
          dispatch({ type: "configStatus", config });
          return;
        } catch (error) {
          lastError = error;
          if (attempt + 1 < ENGINE_LOAD_ATTEMPTS) {
            await wait(ENGINE_LOAD_RETRY_MS);
          }
        }
      }

      setLoadError(lastError instanceof Error ? lastError.message : String(lastError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!providers.length && !loading && !loadError) void reload();
    // The panel owns this recovery path: a transient first-load failure must
    // not leave the Engine tab permanently blank.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers.length]);

  if (!providers.length) {
    return (
      <div className="mt-4 rounded-2xl border bg-card p-4">
        <div className="text-[13.5px] font-semibold text-foreground">Engine</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          {loading
            ? "Memuat daftar engine…"
            : loadError
              ? "Daftar engine belum berhasil dimuat."
              : "Menyiapkan daftar engine…"}
        </div>
        {loadError && (
          <>
            <div className="mt-2 break-words text-[11.5px] text-destructive">{loadError}</div>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => void reload()}>
              Coba lagi
            </Button>
          </>
        )}
      </div>
    );
  }

  const priority = (provider: ProviderRow) =>
    provider.kind === "codex" ? 0 : provider.name.toLowerCase().includes("openai") ? 1 : 10;
  const ordered = [...providers].sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
  const connected = ordered.filter((p) => p.connected).length;
  const agents = ordered.filter((p) => p.agentic);
  const chat = ordered.filter((p) => !p.agentic);

  return (
    <>
      <div className="mt-4 rounded-2xl border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold text-foreground">Engine utama</div>
            <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              Hanya satu engine yang aktif untuk semua Agen dan Ruang. Mengaktifkan engine lain otomatis menonaktifkan engine sebelumnya.
            </div>
          </div>
          <GlobalEnginePicker className="shrink-0" />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[13.5px] font-semibold text-foreground">Daftar engine</div>
            <div className="text-[11.5px] text-muted-foreground">{connected} terhubung</div>
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Pilih engine yang akan dipakai DIZA. Kredensial tetap tersimpan di server Anda.
          </div>
        </div>
        <Group
          title="Agen"
          note="Dapat menjalankan tools dan membaca file. Pasang CLI lalu login."
          rows={agents}
        />
        <Group
          title="Model chat"
          note="Untuk menulis dan bernalar, tanpa kontrol langsung ke perangkat."
          rows={chat}
        />
      </div>
      <CustomEndpoints />
    </>
  );
}
