// What rides along with the next message.
//
// Desktop files can keep their real path. Browser/PWA/mobile picks have
// no host path, so pathless files are uploaded once and the prompt carries
// the app-owned saved path. Images are uploaded even on desktop so the
// transcript can render them consistently.

export type PasteAttachment = {
  kind: "paste";
  id: string;
  text: string;
  bytes: number;
  lines: number;
};

export type FileAttachment = {
  kind: "file";
  id: string;
  path: string;
  name: string;
  bytes: number;
  mime?: string;
};

export type ImageAttachment = {
  kind: "image";
  id: string;
  path: string;
  name: string;
  bytes: number;
  mime: string;
};

export type VideoAttachment = {
  kind: "video";
  id: string;
  path: string;
  name: string;
  bytes: number;
  mime: string;
};

export type Attachment = PasteAttachment | FileAttachment | ImageAttachment | VideoAttachment;

export type AttachmentRef = {
  path: string;
  name?: string;
  mime?: string;
};

/** Past either of these, a paste stops being typing and becomes a chip. */
export const PASTE_CHARS = 900;
export const PASTE_LINES = 12;

export function isLongPaste(text: string): boolean {
  return text.length >= PASTE_CHARS || text.split("\n").length >= PASTE_LINES;
}

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const FILE_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const baseMime = (value: string) => value.split(";")[0]!.trim().toLowerCase();

export function isImage(file: { type: string }): boolean {
  return IMAGE_MIMES.has(baseMime(file.type));
}

export function isVideo(file: { type: string }): boolean {
  return VIDEO_MIMES.has(baseMime(file.type));
}

export function isUploadable(file: { type: string }): boolean {
  const mime = baseMime(file.type);
  return IMAGE_MIMES.has(mime) || VIDEO_MIMES.has(mime) || FILE_MIMES.has(mime);
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `a${Math.random().toString(36).slice(2)}`;

export function pasteAttachment(text: string): PasteAttachment {
  return {
    kind: "paste",
    id: newId(),
    text,
    bytes: new TextEncoder().encode(text).length,
    lines: text.split("\n").length,
  };
}

export function fileAttachment(name: string, path: string, bytes: number, mime?: string): FileAttachment {
  return { kind: "file", id: newId(), path, name, bytes, ...(mime ? { mime } : {}) };
}

export function videoAttachment(name: string, path: string, bytes: number, mime: string): VideoAttachment {
  return { kind: "video", id: newId(), path, name, bytes, mime };
}

export const INLINE_TEXT_LIMIT = 512 * 1024;

type IncomingFile = Pick<File, "name" | "size" | "type" | "text">;

/**
 * One intake for picker, camera capture, drop and paste. Desktop files use
 * their real path when possible; browser/PWA/mobile files upload when they
 * need a path. Nothing is discarded silently.
 */
export async function intakeFiles<T extends IncomingFile>(
  files: readonly T[],
  handlers: {
    pathOf: (file: T) => string;
    uploadAttachment: (file: T) => Promise<Attachment | null>;
  },
): Promise<{ attachments: Attachment[]; refused: string | null }> {
  const attachments: Attachment[] = [];
  const complaints: string[] = [];

  for (const file of files) {
    if (isImage(file)) {
      try {
        const uploaded = await handlers.uploadAttachment(file);
        if (uploaded) attachments.push(uploaded);
      } catch (error) {
        complaints.push(`${file.name || "image"}: ${error instanceof Error ? error.message : "upload failed"}`);
      }
      continue;
    }

    // Whitelisted formats get an app-owned copy even on desktop. That
    // gives API engines a safe path they may read without granting them
    // arbitrary access to the user's filesystem. Tiny text remains inline.
    if ((file.type.startsWith("text/") || file.type === "application/json") && file.size <= INLINE_TEXT_LIMIT) {
      try {
        attachments.push(pasteAttachment(await file.text()));
        continue;
      } catch {
        // unreadable browser File falls through to persisted upload
      }
    }
    if (isUploadable(file)) {
      try {
        const uploaded = await handlers.uploadAttachment(file);
        if (uploaded) {
          attachments.push(uploaded);
          continue;
        }
      } catch (error) {
        complaints.push(`${file.name || "that file"}: ${error instanceof Error ? error.message : "upload failed"}`);
        continue;
      }
    }

    let path = "";
    try {
      path = handlers.pathOf(file);
    } catch {
      // Plain browsers and Android webviews do not expose host disk paths.
    }
    if (path) {
      // Preserve baseline desktop behavior for formats outside the web
      // upload allow-list; process-backed engines may still use the path.
      attachments.push(fileAttachment(file.name, path, file.size, baseMime(file.type) || undefined));
      continue;
    }
    complaints.push(`${file.name || "that file"}: this file type is not supported`);
  }
  return { attachments, refused: complaints.length ? complaints.join("; ") : null };
}

/** Persist a browser/PWA/mobile attachment server-side. */
export async function uploadStoredAttachment(file: File): Promise<Attachment | null> {
  if (!isUploadable(file)) return null;
  const mime = baseMime(file.type);
  const max = isImage(file) ? IMAGE_MAX_BYTES : isVideo(file) ? VIDEO_MAX_BYTES : FILE_MAX_BYTES;
  if (file.size > max) {
    throw new Error(`${file.name || "attachment"} is over ${Math.round(max / (1024 * 1024))} MB`);
  }
  const response = await fetch("/api/attachments", {
    method: "POST",
    headers: { "content-type": mime },
    body: new Uint8Array(await file.arrayBuffer()),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? "upload failed");
  }
  const saved = await response.json();
  if (saved.kind === "image") {
    return { kind: "image", id: newId(), path: saved.path, name: file.name || "captured image", bytes: saved.bytes, mime: saved.mime };
  }
  if (saved.kind === "video") {
    return { kind: "video", id: newId(), path: saved.path, name: file.name || "captured video", bytes: saved.bytes, mime: saved.mime };
  }
  return fileAttachment(file.name || "attachment", saved.path, saved.bytes, saved.mime);
}

/** Backward-compatible name used by older callers/tests. */
export async function uploadImageAttachment(file: File): Promise<ImageAttachment | null> {
  if (!isImage(file)) return null;
  const uploaded = await uploadStoredAttachment(file);
  return uploaded?.kind === "image" ? uploaded : null;
}

function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

const unescapeAttr = (raw: string) =>
  raw
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#10;", "\n")
    .replaceAll("&#13;", "\r")
    .replaceAll("&amp;", "&");

function tag(kind: "image" | "video" | "file", a: { path: string; name: string; mime?: string }): string {
  return `<attached-${kind} path="${escapeAttr(a.path)}" name="${escapeAttr(a.name)}"${a.mime ? ` mime="${escapeAttr(a.mime)}"` : ""} />`;
}

export function composeOutgoing(text: string, attachments: Attachment[]): string {
  const parts = [text.trim()];
  for (const a of attachments) {
    if (a.kind === "paste") parts.push(`<pasted-text>\n${a.text}\n</pasted-text>`);
    else if (a.kind === "image") parts.push(tag("image", a));
    else if (a.kind === "video") parts.push(tag("video", a));
    else parts.push(tag("file", a));
  }
  return parts.filter(Boolean).join("\n\n");
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of raw.matchAll(/([a-z]+)="([^"]*)"/gi)) out[match[1]!.toLowerCase()] = unescapeAttr(match[2]!);
  return out;
}

/** Lift attachment tags out for transcript rendering. Old path-only tags
 * remain readable, so existing conversations do not need migration. */
export function splitAttachments(text: string): {
  display: string;
  images: AttachmentRef[];
  videos: AttachmentRef[];
  files: AttachmentRef[];
} {
  const images: AttachmentRef[] = [];
  const videos: AttachmentRef[] = [];
  const files: AttachmentRef[] = [];
  const display = text.replace(/<attached-(image|video|file)\s+([^>]*?)\s*\/>\s*/gi, (_whole, kind: string, raw: string) => {
    const meta = attrs(raw);
    if (!meta.path) return "";
    const ref = { path: meta.path, ...(meta.name ? { name: meta.name } : {}), ...(meta.mime ? { mime: meta.mime } : {}) };
    if (kind.toLowerCase() === "image") images.push(ref);
    else if (kind.toLowerCase() === "video") videos.push(ref);
    else files.push(ref);
    return "";
  });
  return { display: display.trim(), images, videos, files };
}

export function attachmentBasename(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? "";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
