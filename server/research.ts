/** Provider-independent research helpers.
 *
 * Providers do the browsing; DIZA owns the research contract.  Keeping
 * source extraction here means a provider switch cannot change how saved
 * answers expose their sources to the conversation UI.
 */
export interface ResearchSource {
  url: string;
  title: string;
  host: string;
}

export interface ResearchMetadata {
  sources: ResearchSource[];
}

const MAX_SOURCES = 12;
const MARKDOWN_LINK = /\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL = /https?:\/\/[^\s<>{}\[\]"')]+/gi;

function cleanUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    // A citation should be a checkable page, never a credential-bearing URL.
    if (url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "source";
  }
}

/** Pull checkable sources out of the settled assistant answer.
 * Never invents metadata: titles come from the model's markdown label, or
 * the host when the answer only contains a bare URL. */
export function extractResearchSources(text: string): ResearchSource[] {
  const out: ResearchSource[] = [];
  const seen = new Set<string>();

  const add = (raw: string, title?: string) => {
    if (out.length >= MAX_SOURCES) return;
    const url = cleanUrl(raw);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const host = hostOf(url);
    const label = String(title ?? "").trim();
    out.push({ url, host, title: label && label !== url ? label : host });
  };

  for (const match of text.matchAll(MARKDOWN_LINK)) add(match[2], match[1]);
  for (const match of text.matchAll(BARE_URL)) add(match[0]);
  return out;
}

/** Extra contract for turns that need current/researched information.
 * It asks for evidence but cannot grant a browser the user did not enable. */
export function researchInstruction(deep = false): string {
  const depth = deep
    ? "For material claims, cross-check with at least two independent sources when the evidence allows it."
    : "Use more than one source when a material claim would be weak from a single source.";
  return [
    "This request needs current or externally verified information.",
    "Use an available web/browser capability before answering; if none is available, say that current verification was not possible rather than pretending it was.",
    "Prefer primary sources for load-bearing facts, then independent reputable sources for cross-checking.",
    depth,
    "Distinguish sourced fact from inference or contested claims.",
    "Synthesize rather than dumping snippets: lead with the answer, explain where sources agree or conflict, and state meaningful uncertainty.",
    "Cite sources using direct Markdown links such as [Source title](https://example.com/page). Never invent a URL or cite a page you did not actually use.",
    "End with a compact Sources section containing the links you relied on most so the app can expose them separately.",
  ].join(" ");
}
