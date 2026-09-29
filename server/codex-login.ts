// ChatGPT device-code sign-in for the Codex CLI used by the web runtime.
//
// This owns only the short-lived login app-server process. The resulting
// credential is written by Codex to its own auth store; DIZA never receives
// or serializes ChatGPT access/refresh tokens.
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";

import { attachRpc, type RpcLink } from "./harness/jsonrpc-stdio.ts";

type LoginStatus = "idle" | "pending" | "connected" | "failed";

export interface CodexLoginView {
  status: LoginStatus;
  verificationUrl?: string;
  userCode?: string;
  error?: string;
}

interface ActiveLogin {
  child: ChildProcessWithoutNullStreams;
  rpc: RpcLink;
  loginId: string;
  verificationUrl: string;
  userCode: string;
  status: "pending" | "connected" | "failed";
  error?: string;
}

let active: ActiveLogin | null = null;

function stop(child: ChildProcessWithoutNullStreams) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

export function codexLoggedIn(cli = "codex"): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cli, ["login", "status"], { timeout: 8_000 }, (error) => resolve(!error));
  });
}

export async function codexLoginStatus(cli = "codex"): Promise<CodexLoginView> {
  if (await codexLoggedIn(cli)) return { status: "connected" };
  if (!active) return { status: "idle" };
  if (active.status === "failed") return { status: "failed", ...(active.error ? { error: active.error } : {}) };
  if (active.status === "connected") return { status: "connected" };
  return { status: "pending" };
}

export async function startCodexDeviceLogin(cli = "codex"): Promise<CodexLoginView> {
  if (await codexLoggedIn(cli)) return { status: "connected" };
  if (active?.status === "pending") {
    return { status: "failed", error: "A Codex sign-in is already in progress. Finish it in the open browser tab." };
  }
  if (active) {
    stop(active.child);
    active = null;
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  // Codex must authenticate with the user's ChatGPT login, not an inherited
  // Platform API key that could move inference onto metered API billing.
  delete env.OPENAI_API_KEY;
  // Temporary, login-only diagnostics. Keep provider/core behavior unchanged.
  env.RUST_LOG = "codex_login=debug,codex_http_client=debug";

  const child = spawn(cli, ["app-server"], {
    cwd: homedir(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
  });

  let resolveCompleted: ((value: CodexLoginView) => void) | null = null;
  const completed = new Promise<CodexLoginView>((resolve) => {
    resolveCompleted = resolve;
  });

  const rpc = attachRpc({
    stdin: child.stdin,
    stdout: child.stdout,
    onFrame: (message, direction) => {
      if (direction !== "in" || !message?.error) return;
      const safe = JSON.stringify(message.error)
        .replace(/(authorization|bearer)\\s+[^\\s"]+/gi, "$1 [redacted]")
        .replace(/("(?:access_token|refresh_token|id_token)"\\s*:\\s*")[^"]+(")/gi, "$1[redacted]$2")
        .slice(-4_000);
      console.error("[diza-codex-rpc-error] " + safe);
    },
    onRequest: (message) => {
      // Login should not ask the host for permissions or tools. Refuse any
      // unexpected request instead of leaving the app-server hanging.
      rpc.replyError(message.id, -32601, "DIZA Codex login does not handle host requests");
    },
    onNotify: (message) => {
      if (message.method !== "account/login/completed") return;
      const params = message.params ?? {};
      if (!active || params.loginId !== active.loginId) return;
      if (params.success === true) {
        active.status = "connected";
        resolveCompleted?.({ status: "connected" });
      } else {
        active.status = "failed";
        active.error = String(params.error ?? "ChatGPT sign-in failed");
        resolveCompleted?.({ status: "failed", error: active.error });
      }
      setTimeout(() => stop(child), 100).unref?.();
    },
  });

  child.on("error", (error) => {
    if (!active || active.child !== child) return;
    active.status = "failed";
    active.error = error.message;
    resolveCompleted?.({ status: "failed", error: active.error });
  });
  child.on("close", (code) => {
    if (!active || active.child !== child || active.status !== "pending") return;
    active.status = "failed";
    active.error = stderr.trim() || `Codex login process exited with code ${code ?? "unknown"}`;
    resolveCompleted?.({ status: "failed", error: active.error });
  });

  try {
    await rpc.request("initialize", { clientInfo: { name: "diza-bot", version: "1" } });
    rpc.notify("initialized", {});
    const result = await rpc.request("account/login/start", { type: "chatgptDeviceCode" });
    if (
      result?.type !== "chatgptDeviceCode" ||
      typeof result.loginId !== "string" ||
      typeof result.verificationUrl !== "string" ||
      typeof result.userCode !== "string"
    ) {
      throw new Error("Codex did not return a device-code login challenge");
    }
    active = {
      child,
      rpc,
      loginId: result.loginId,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
      status: "pending",
    };
    // Keep a reference alive for the completion notification without
    // blocking the HTTP request that shows the user the challenge.
    void completed;
    return {
      status: "pending",
      verificationUrl: result.verificationUrl,
      userCode: result.userCode,
    };
  } catch (error) {
    stop(child);
    const message = error instanceof Error ? error.message : String(error);
    const safeStderr = stderr
      .replace(/(authorization|bearer)\\s+[^\\s]+/gi, "$1 [redacted]")
      .replace(/("(?:access_token|refresh_token|id_token)"\\s*:\\s*")[^"]+(")/gi, "$1[redacted]$2")
      .trim()
      .slice(-4_000);
    if (safeStderr) {
      console.error("[diza-codex-login] app-server stderr tail:\\n" + safeStderr);
    }
    active = null;
    return { status: "failed", error: message };
  }
}
