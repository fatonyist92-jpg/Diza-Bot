// Where browser/PWA attachments land.
//
// Desktop picks can hand an agent a real disk path. A browser, PWA or
// Android webview cannot, so pathless files are copied once into Bloks'
// own attachment store and the message carries that minted path. Names
// are never derived from user input: uuid + an extension selected from a
// strict MIME allow-list.
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";

const ATTACHMENTS_DIR = join(DATA_DIR, "attachments");

export type AttachmentKind = "image" | "video" | "file";

type AttachmentType = {
  ext: string;
  kind: AttachmentKind;
  maxBytes: number;
};

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

const TYPES: Record<string, AttachmentType> = {
  "image/png": { ext: "png", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/jpeg": { ext: "jpg", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/gif": { ext: "gif", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "image/webp": { ext: "webp", kind: "image", maxBytes: IMAGE_MAX_BYTES },
  "video/mp4": { ext: "mp4", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/webm": { ext: "webm", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "video/quicktime": { ext: "mov", kind: "video", maxBytes: VIDEO_MAX_BYTES },
  "text/plain": { ext: "txt", kind: "file", maxBytes: FILE_MAX_BYTES },
  "text/markdown": { ext: "md", kind: "file", maxBytes: FILE_MAX_BYTES },
  "text/csv": { ext: "csv", kind: "file", maxBytes: FILE_MAX_BYTES },
  "application/json": { ext: "json", kind: "file", maxBytes: FILE_MAX_BYTES },
  "application/pdf": { ext: "pdf", kind: "file", maxBytes: FILE_MAX_BYTES },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    ext: "docx", kind: "file", maxBytes: FILE_MAX_BYTES,
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    ext: "xlsx", kind: "file", maxBytes: FILE_MAX_BYTES,
  },
};

const MIME_FOR: Record<string, string> = Object.fromEntries(
  Object.entries(TYPES).map(([mime, meta]) => [meta.ext, mime]),
);
const SAFE_EXTENSIONS = [...new Set(Object.values(TYPES).map((meta) => meta.ext))].join("|");
const SAFE_NAME = new RegExp(`^[0-9a-f-]{36}\\.(${SAFE_EXTENSIONS})$`);

function baseType(contentType: string | undefined): string {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase();
}

export function extensionFor(contentType: string | undefined): string | null {
  return TYPES[baseType(contentType)]?.ext ?? null;
}

export function kindFor(contentType: string | undefined): AttachmentKind | null {
  return TYPES[baseType(contentType)]?.kind ?? null;
}

export function maxBytesFor(contentType: string | undefined): number | null {
  return TYPES[baseType(contentType)]?.maxBytes ?? null;
}

export function isStoredAttachmentPath(path: string): boolean {
  if (typeof path !== "string") return false;
  const normalized = join(ATTACHMENTS_DIR, path.split(/[\\/]/).pop() ?? "");
  return normalized === path && SAFE_NAME.test(path.split(/[\\/]/).pop() ?? "") && existsSync(path);
}

export function readStoredAttachment(path: string): { data: Buffer; mime: string; bytes: number } | null {
  if (!isStoredAttachmentPath(path)) return null;
  const name = path.split(/[\\/]/).pop() ?? "";
  const data = readFileSync(path);
  return { data, mime: MIME_FOR[name.split(".").at(-1)!] ?? "application/octet-stream", bytes: data.length };
}

/** Persist bytes produced by DIZA Imagine through the same MIME/size gate
 * as user uploads. Returns null rather than inventing a second media store. */
export function storeAttachmentBytes(data: Buffer, contentType: string): { path: string; mime: string; bytes: number; kind: AttachmentKind } | null {
  const mime = baseType(contentType);
  const meta = TYPES[mime];
  if (!meta || !data.length || data.length > meta.maxBytes) return null;
  mkdirSync(ATTACHMENTS_DIR, { recursive: true, mode: 0o700 });
  const name = `${randomUUID()}.${meta.ext}`;
  const path = join(ATTACHMENTS_DIR, name);
  writeFileSync(path, data, { mode: 0o600 });
  return { path, mime, bytes: data.length, kind: meta.kind };
}

/** Reads a whitelisted raw body and writes it down. The response path is
 * safe to include in a prompt; no original filename becomes part of it. */
export function saveAttachment(req: IncomingMessage, res: ServerResponse): void {
  const mime = baseType(req.headers["content-type"]);
  const meta = TYPES[mime];
  if (!meta) {
    res.writeHead(415, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "that attachment type is not supported" }));
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  req.on("data", (chunk: Buffer) => {
    if (tooLarge) return;
    size += chunk.length;
    if (size > meta.maxBytes) {
      tooLarge = true;
      chunks.length = 0;
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    if (tooLarge) {
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `${meta.kind === "video" ? "videos" : meta.kind === "image" ? "images" : "files"} top out at ${Math.round(meta.maxBytes / (1024 * 1024))} MB` }));
      return;
    }
    if (!size) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "empty upload" }));
      return;
    }
    mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    const name = `${randomUUID()}.${meta.ext}`;
    const path = join(ATTACHMENTS_DIR, name);
    writeFileSync(path, Buffer.concat(chunks), { mode: 0o600 });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ path, mime, bytes: size, kind: meta.kind }));
  });
  req.on("error", () => {
    if (!res.writableEnded) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "upload failed" }));
    }
  });
}

/** Hands a saved attachment back for transcript previews/downloads. Only
 * names minted by this module are ever looked up. */
export function serveAttachment(name: string, res: ServerResponse): void {
  if (!SAFE_NAME.test(name)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no such attachment" }));
    return;
  }
  const path = join(ATTACHMENTS_DIR, name);
  if (!existsSync(path)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "no such attachment" }));
    return;
  }
  res.writeHead(200, {
    "content-type": MIME_FOR[name.split(".").at(-1)!] ?? "application/octet-stream",
    "content-length": statSync(path).size,
    "cache-control": "private, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  createReadStream(path).pipe(res);
}
