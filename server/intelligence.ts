/** Diza's thin intelligence layer. It decides how a turn should use the
 * already-working provider pipeline; it never talks to a provider itself. */
export type IntelligenceMode = "fast" | "auto" | "expert";
export type TurnIntent = "chat" | "reasoning" | "search" | "image" | "video" | "file";

export interface TurnDecision {
  requestedMode: IntelligenceMode;
  effectiveMode: Exclude<IntelligenceMode, "auto">;
  intent: TurnIntent;
  effort: "low" | "medium" | "high";
  /** Search turns that ask for comparison/cross-checking need deeper synthesis. */
  deepResearch: boolean;
}

const REASONING = /\b(analy[sz]e|analysis|debug|compare|design|architect|strategy|plan|calculate|prove|explain deeply|review code|troubleshoot)\b/i;
const CURRENT = /\b(latest|today|current|news|price|weather|search|look up|find online|web|terbaru|hari ini|saat ini|sekarang|berita|harga|cuaca|cari|cek online|internet)\b/i;
const IMAGE_TAG = /(?:\[image:[^\]]+\]|<attached-image\b[^>]*\/>)/i;
const VIDEO_TAG = /<attached-video\b[^>]*\/>/i;
const FILE_TAG = /(?:\[file:[^\]]+\]|<attached-file\b[^>]*\/>)/i;
const DEEP_RESEARCH = /\b(research|deep dive|cross[- ]?check|multiple sources|multi[- ]?source|compare sources|verify sources|investigate|riset|teliti|cek silang|bandingkan sumber|beberapa sumber)\b/i;

export function detectIntent(text: string): TurnIntent {
  if (IMAGE_TAG.test(text)) return "image";
  if (VIDEO_TAG.test(text)) return "video";
  if (FILE_TAG.test(text)) return "file";
  if (CURRENT.test(text)) return "search";
  if (REASONING.test(text) || text.length > 900) return "reasoning";
  return "chat";
}

export function decideTurn(mode: IntelligenceMode, text: string): TurnDecision {
  const intent = detectIntent(text);
  const deepResearch = intent === "search" && DEEP_RESEARCH.test(text);
  const effectiveMode = mode === "auto"
    ? (intent === "reasoning" || intent === "file" || intent === "image" || intent === "video" || deepResearch ? "expert" : "fast")
    : mode;
  return {
    requestedMode: mode,
    effectiveMode,
    intent,
    effort: effectiveMode === "expert" ? "high" : "low",
    deepResearch,
  };
}

export function parseMode(value: unknown): IntelligenceMode {
  return value === "fast" || value === "expert" || value === "auto" ? value : "auto";
}

/** A small instruction only; capability availability is still decided by the
 * existing integration layer, so routing cannot grant a tool the user did not have. */
export function intentHint(intent: TurnIntent): string {
  switch (intent) {
    case "search": return "This request may need current information. Use an available web/browser capability before answering; if none is available, say current verification was not possible. Cite only sources you actually used.";
    case "image": return "The user attached an image. Inspect the supplied image when the current engine supports it; do not invent visual details you cannot access.";
    case "video": return "The user attached a video. Inspect the supplied video only when the current engine can actually read it; otherwise say that video inspection is unavailable rather than inventing frames, motion, or audio.";
    case "file": return "The user attached a file. Use the supplied file as the source when file-reading capability is available; if the engine cannot read that format, say so rather than guessing its contents.";
    case "reasoning": return "Work through this carefully and verify the result before answering.";
    default: return "";
  }
}
