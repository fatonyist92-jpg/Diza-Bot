// grok.com device-code sign-in for the official Grok CLI.
// DIZA only surfaces the public challenge. Credentials stay in Grok's own
// ~/.grok/auth.json and XAI_API_KEY is deliberately removed from the child.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type LoginStatus = "idle" | "pending" | "connected" | "failed";
export interface GrokLoginView {
  status: LoginStatus;
  verificationUrl?: string;
  userCode?: string;
  error?: string;
}
interface ActiveLogin {
  child: ChildProcessWithoutNullStreams;
  status: "pending" | "failed";
  verificationUrl?: string;
  userCode?: string;
  error?: string;
}
let active: ActiveLogin | null = null;

const authFile = () => join(process.env.GROK_HOME || join(homedir(), ".grok"), "auth.json");
export const grokLoggedIn = () => existsSync(authFile());

function stop(child: ChildProcessWithoutNullStreams) {
  try { child.kill("SIGTERM"); } catch {}
}

function publicChallenge(text: string) {
  const url = text.match(/https:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, "");
  const fromQuery = url ? new URL(url).searchParams.get("user_code") ?? undefined : undefined;
  const labelled =
    text.match(/(?:code|user[_ -]?code)\s*(?:is|:|=)?\s*([A-Z0-9][A-Z0-9-]{4,20})/i)?.[1];
  return { verificationUrl: url, userCode: fromQuery || labelled };
}

export async function grokLoginStatus(): Promise<GrokLoginView> {
  if (grokLoggedIn()) return { status: "connected" };
  if (!active) return { status: "idle" };
  if (active.status === "failed") return { status: "failed", ...(active.error ? { error: active.error } : {}) };
  return {
    status: "pending",
    ...(active.verificationUrl ? { verificationUrl: active.verificationUrl } : {}),
    ...(active.userCode ? { userCode: active.userCode } : {}),
  };
}

export async function startGrokDeviceLogin(cli = "grok"): Promise<GrokLoginView> {
  if (grokLoggedIn()) return { status: "connected" };
  if (active) { stop(active.child); active = null; }

  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.XAI_API_KEY;
  const child = spawn(cli, ["login", "--device-auth"], {
    cwd: homedir(), env, stdio: ["pipe", "pipe", "pipe"],
  });
  active = { child, status: "pending" };

  let buffer = "";
  const read = (chunk: Buffer | string) => {
    if (!active || active.child !== child) return;
    buffer = (buffer + chunk.toString()).slice(-8_000);
    const challenge = publicChallenge(buffer);
    if (challenge.verificationUrl) active.verificationUrl = challenge.verificationUrl;
    if (challenge.userCode) active.userCode = challenge.userCode;
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("error", (error) => {
    if (!active || active.child !== child) return;
    active.status = "failed";
    active.error = error.message;
  });
  child.on("close", (code) => {
    if (!active || active.child !== child) return;
    if (grokLoggedIn()) { active = null; return; }
    active.status = "failed";
    active.error = code === 0 ? "Grok sign-in ended without a saved session." : "Grok device sign-in failed.";
  });

  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline && active?.child === child && !active.userCode && !active.verificationUrl) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return grokLoginStatus();
}
