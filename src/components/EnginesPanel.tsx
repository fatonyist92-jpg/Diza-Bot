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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

const AUTH_NOTE: Record<ProviderRow["auth"], string> = {
  oauth: "Browser sign-in",
  key: "API key",
  cli: "Signs in through its own CLI",
  none: "Runs on this machine",
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
          placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : "Paste your key"}
          autoComplete="off"
          className="h-8 text-[13px]"
        />
        <Button variant="secondary" onClick={save} disabled={!key.trim()} className="w-[72px]">
          <Check size={13} />
          Save
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className={cn("text-[11.5px]", mismatched ? "text-warning" : "text-muted-foreground")}>
          {mismatched ? `Keys here usually start with ${provider.keyPrefix}` : provider.keyHint}
        </span>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Get one <ExternalLink size={10} />
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
  const [codexLogin, setCodexLogin] = useState<{
    status: "idle" | "pending" | "connected" | "failed";
    verificationUrl?: string;
    userCode?: string;
    error?: string;
  } | null>(null);

  // an engine can be connected and still be down: no CLI on PATH, a key
  // the provider rejected, a local server that is not running
  const instance = state.instances.find((i) => i.driverKind === provider.kind);
  const down = instance && instance.snapshot.state !== "available";

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
              ? (instance!.snapshot.reason ?? "unavailable")
              : provider.connected
                ? "Connected"
                : AUTH_NOTE[provider.auth]}
          </div>
        </div>

        {provider.auth === "cli" ? (
          provider.kind === "codex" && provider.connected && provider.needsSignIn ? (
            <Button variant="secondary" size="sm" onClick={signInCodex} disabled={signingIn} className="shrink-0">
              {signingIn ? <Loader2 size={13} className="animate-spin" /> : "Sign in"}
            </Button>
          ) : (
            <span className="shrink-0 text-[11.5px] text-muted-foreground">
              {provider.connected ? "" : "Not found"}
            </span>
          )
        ) : provider.connected ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "disconnectProvider", kind: provider.kind })}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            Disconnect
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={act} disabled={signingIn} className="shrink-0">
            {signingIn ? (
              <Loader2 size={13} className="animate-spin" />
            ) : provider.auth === "oauth" ? (
              "Sign in"
            ) : provider.auth === "none" ? (
              "Enable"
            ) : (
              <>
                <Plus size={13} />
                Key
              </>
            )}
          </Button>
        )}
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
              ? "Codex is installed. Sign in with ChatGPT to use it."
              : `No sign-in detected. ${provider.signInHint ?? provider.keyHint}`
            : provider.keyHint}
        </div>
      )}
      {provider.kind === "codex" && codexLogin?.status === "pending" && (
        <div className="mt-2 ml-10 rounded-xl border bg-muted/40 px-3 py-2 text-[12px]">
          <div className="text-muted-foreground">Enter this one-time code on the OpenAI page:</div>
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
                Open OpenAI <ExternalLink size={11} />
              </a>
            )}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">Waiting for approval…</div>
        </div>
      )}
      {provider.kind === "codex" && codexLogin?.status === "failed" && (
        <div className="mt-1.5 pl-10 text-[12px] text-destructive">
          {codexLogin.error ?? "ChatGPT sign-in failed."}
        </div>
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

export function EnginesPanel() {
  const { state } = useStore();
  const providers = state.providers;
  if (!providers.length) return null;

  const connected = providers.filter((p) => p.connected).length;
  // Twelve flat rows is a list you scan past. The split is the one that
  // actually changes what an agent can do.
  const agents = providers.filter((p) => p.agentic);
  const chat = providers.filter((p) => !p.agentic);

  return (
    <>
      <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[13.5px] font-semibold text-foreground">Engines</div>
            <div className="text-[11.5px] text-muted-foreground">{connected} connected</div>
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            What your agents run on. Keys stay on this machine.
          </div>
        </div>
        <Group
          title="Agents"
          note="Run commands and read files. Install the CLI, then sign in."
          rows={agents}
        />
        <Group
          title="Chat models"
          note="Write and reason, but cannot act on your machine."
          rows={chat}
        />
      </div>
      <CustomEndpoints />
    </>
  );
}
