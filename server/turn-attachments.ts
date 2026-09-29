import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DATA_DIR } from "./config.ts";

export type TurnAttachment = { kind: "image" | "video" | "file"; path: string; name?: string; mime?: string };

type ApiPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "auto" } };

const TEXT_MAX = 180_000;
const IMAGE_MAX = 10 * 1024 * 1024;
const ATTACHMENT_ROOT = resolve(join(DATA_DIR, "attachments"));

const decode = (raw: string) => raw
  .replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">")
  .replaceAll("&#10;", "\n").replaceAll("&#13;", "\r").replaceAll("&amp;", "&");

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-z]+)="([^"]*)"/gi)) out[m[1]!.toLowerCase()] = decode(m[2]!);
  return out;
}

export function parseTurnAttachments(text: string): { cleanText: string; attachments: TurnAttachment[] } {
  const attachments: TurnAttachment[] = [];
  const cleanText = text.replace(/<attached-(image|video|file)\s+([^>]*?)\s*\/>\s*/gi, (_all, rawKind: string, rawAttrs: string) => {
    const meta = attrs(rawAttrs);
    if (meta.path) attachments.push({ kind: rawKind.toLowerCase() as TurnAttachment["kind"], path: meta.path, ...(meta.name ? { name: meta.name } : {}), ...(meta.mime ? { mime: meta.mime } : {}) });
    return "";
  }).trim();
  return { cleanText, attachments };
}

function mimeForImage(att: TurnAttachment): string | null {
  if (att.mime?.startsWith("image/")) return att.mime;
  const ext = extname(att.path).toLowerCase();
  return ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".gif" ? "image/gif" : ext === ".webp" ? "image/webp" : null;
}

function textLike(att: TurnAttachment): boolean {
  if (att.mime?.startsWith("text/")) return true;
  if (att.mime === "application/json") return true;
  return [".txt", ".md", ".markdown", ".csv", ".json", ".log"].includes(extname(att.path).toLowerCase());
}

function readable(path: string, max: number): boolean {
  try {
    const absolute = resolve(path);
    if (!(absolute === ATTACHMENT_ROOT || absolute.startsWith(`${ATTACHMENT_ROOT}/`))) return false;
    const stat = statSync(absolute);
    return existsSync(absolute) && stat.isFile() && stat.size <= max;
  } catch { return false; }
}

/** Convert DIZA attachment tags into the standard OpenAI-compatible
 * multimodal message shape. Text-like documents are included inline.
 * Binary/video formats remain explicit notices when this generic API
 * adapter cannot honestly inspect them. */
export function apiMessageContent(text: string): string | ApiPart[] {
  const { cleanText, attachments } = parseTurnAttachments(text);
  if (!attachments.length) return text;

  const notes: string[] = [];
  const images: ApiPart[] = [];
  for (const att of attachments) {
    const label = att.name ?? att.path.split(/[\\/]/).at(-1) ?? "attachment";
    if (att.kind === "image") {
      const mime = mimeForImage(att);
      if (mime && readable(att.path, IMAGE_MAX)) {
        const data = readFileSync(att.path).toString("base64");
        images.push({ type: "image_url", image_url: { url: `data:${mime};base64,${data}`, detail: "auto" } });
        notes.push(`[Attached image: ${label}]`);
      } else notes.push(`[Attached image ${label} could not be read by this engine.]`);
      continue;
    }
    if (att.kind === "file" && textLike(att) && readable(att.path, TEXT_MAX)) {
      const body = readFileSync(att.path, "utf8").slice(0, TEXT_MAX);
      notes.push(`[Attached file: ${label}]\n<attachment-content>\n${body}\n</attachment-content>`);
      continue;
    }
    if (att.kind === "video") {
      notes.push(`[Attached video: ${label}. This generic API adapter cannot inspect video frames/audio directly. Do not claim to have viewed it unless another available tool actually opens it.]`);
    } else {
      notes.push(`[Attached file: ${label}. This binary format is present but this generic API adapter cannot extract its contents directly. Do not guess its contents.]`);
    }
  }
  const textPart = [cleanText, ...notes].filter(Boolean).join("\n\n");
  return images.length ? [{ type: "text", text: textPart }, ...images] : textPart;
}
