import type { ProviderSnapshot } from "./contracts.ts";

/** Provider failures that mean "this engine is temporarily out of capacity",
 * not that the prompt, workspace or tool call itself is bad. */
const CAPACITY = [
  /usage limit/i,
  /quota (?:exceeded|exhausted)/i,
  /resource[_ -]?exhausted/i,
  /rate limit/i,
  /too many requests/i,
  /try again at/i,
  /insufficient quota/i,
];

/** Keep a provider out of the hot path after it has already told us it
 * cannot serve turns. A later turn will retry it after this window. */
export const CAPACITY_COOLDOWN_MS = 30 * 60_000;

export function isProviderCapacityError(message: string | null | undefined): boolean {
  const text = message ?? "";
  return CAPACITY.some((pattern) => pattern.test(text));
}

/** "available but signed out" is installable, not usable. This matters
 * for CLI fallbacks such as Gemini CLI. */
export function usableSnapshot(snapshot: ProviderSnapshot | null | undefined): boolean {
  return Boolean(snapshot && snapshot.state === "available" && snapshot.authenticated !== false);
}

/** Explicit order beats registry insertion order. Keep this intentionally
 * short: Codex prefers the agentic Gemini CLI, then the Gemini API instance
 * if a key is connected. The API path is a second rail, not a substitute
 * for CLI tools. */
export function fallbackOrder(primaryInstanceId: string): string[] {
  return primaryInstanceId === "codex" ? ["gemini_cli", "gemini"] : [];
}
