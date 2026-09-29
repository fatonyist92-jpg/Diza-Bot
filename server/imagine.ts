// DIZA Imagine bridge state. DIZA BOT owns conversation/context and keeps
// durable job + asset identity. The media engine is replaceable: no model,
// provider or vendor owns these records.
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { atomicPrivateWrite } from "./private-storage.ts";
import { newId } from "./contracts.ts";

export type ImagineOperation =
  | "image-generate"
  | "image-edit"
  | "image-to-video"
  | "text-to-video"
  | "video-extend"
  | "variation";

export type ImagineJobStatus = "queued" | "processing" | "completed" | "failed";
export type ImagineAssetKind = "image" | "video";

export interface ImagineContinuity {
  faceIdentity?: string;
  wardrobe?: string;
  objects?: string;
  scene?: string;
  camera?: string;
  seed?: string;
  durationSeconds?: number;
  extendSeconds?: number;
}

export interface ImagineAsset {
  id: string;
  botId: string;
  taskId: string;
  projectId?: string;
  kind: ImagineAssetKind;
  path: string;
  mime: string;
  name: string;
  createdAt: number;
  source: "attachment" | "imagine";
  operation?: ImagineOperation;
  prompt?: string;
  jobId?: string;
  parentAssetId?: string;
  continuity?: ImagineContinuity;
}

export interface ImagineJob {
  id: string;
  botId: string;
  taskId: string;
  projectId?: string;
  operation: ImagineOperation;
  prompt: string;
  inputAssetIds: string[];
  parentAssetId?: string;
  continuity?: ImagineContinuity;
  status: ImagineJobStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
  resultAssetIds: string[];
  error?: string;
  retryOf?: string;
  remoteJobId?: string;
}

export interface NewImagineJob {
  botId: string;
  taskId: string;
  projectId?: string;
  operation: ImagineOperation;
  prompt: string;
  inputAssetIds?: string[];
  parentAssetId?: string;
  continuity?: ImagineContinuity;
  retryOf?: string;
}

const FILE = join(DATA_DIR, "imagine.json");
export const MAX_IMAGINE_JOBS = 500;
export const MAX_IMAGINE_ASSETS = 1000;
export const MAX_IMAGINE_PROMPT = 12_000;
const OPS: ImagineOperation[] = [
  "image-generate", "image-edit", "image-to-video", "text-to-video", "video-extend", "variation",
];

function safeOperation(value: unknown): ImagineOperation | null {
  return typeof value === "string" && OPS.includes(value as ImagineOperation) ? value as ImagineOperation : null;
}

export class ImagineStore {
  jobs: ImagineJob[] = [];
  assets: ImagineAsset[] = [];

  constructor() {
    try {
      const parsed = JSON.parse(readFileSync(FILE, "utf8"));
      if (Array.isArray(parsed?.jobs)) this.jobs = parsed.jobs.filter((j: ImagineJob) => j?.id && safeOperation(j.operation));
      if (Array.isArray(parsed?.assets)) this.assets = parsed.assets.filter((a: ImagineAsset) => a?.id && a?.taskId && a?.path);
    } catch {
      /* first run */
    }
  }

  private save() {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    atomicPrivateWrite(FILE, JSON.stringify({ jobs: this.jobs, assets: this.assets }, null, 2));
  }

  create(input: NewImagineJob, now = Date.now()): ImagineJob {
    const op = safeOperation(input.operation);
    if (!op) throw new Error("unsupported Imagine operation");
    const prompt = String(input.prompt ?? "").trim().slice(0, MAX_IMAGINE_PROMPT);
    if (!prompt) throw new Error("Imagine job needs a prompt");
    const inputAssetIds = [...new Set((input.inputAssetIds ?? []).filter((id) => this.asset(id)?.taskId === input.taskId))].slice(0, 8);
    const job: ImagineJob = {
      id: newId(), botId: input.botId, taskId: input.taskId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      operation: op, prompt, inputAssetIds,
      ...(input.parentAssetId && inputAssetIds.includes(input.parentAssetId) ? { parentAssetId: input.parentAssetId } : {}),
      ...(input.continuity ? { continuity: cleanContinuity(input.continuity) } : {}),
      status: "queued", progress: 0, createdAt: now, updatedAt: now, resultAssetIds: [],
      ...(input.retryOf ? { retryOf: input.retryOf } : {}),
    };
    this.jobs.push(job);
    if (this.jobs.length > MAX_IMAGINE_JOBS) this.jobs.splice(0, this.jobs.length - MAX_IMAGINE_JOBS);
    this.save();
    return job;
  }

  job(id: string): ImagineJob | null { return this.jobs.find((j) => j.id === id) ?? null; }
  asset(id: string): ImagineAsset | null { return this.assets.find((a) => a.id === id) ?? null; }
  jobsForTask(taskId: string): ImagineJob[] { return this.jobs.filter((j) => j.taskId === taskId).sort((a,b)=>a.createdAt-b.createdAt); }
  assetsForTask(taskId: string): ImagineAsset[] { return this.assets.filter((a) => a.taskId === taskId).sort((a,b)=>a.createdAt-b.createdAt); }

  adoptAttachment(input: Omit<ImagineAsset, "id" | "createdAt" | "source">, now = Date.now()): ImagineAsset {
    const existing = this.assets.find((a) => a.taskId === input.taskId && a.path === input.path);
    if (existing) return existing;
    const asset: ImagineAsset = { id: newId(), createdAt: now, source: "attachment", ...input };
    this.assets.push(asset);
    if (this.assets.length > MAX_IMAGINE_ASSETS) this.assets.splice(0, this.assets.length - MAX_IMAGINE_ASSETS);
    this.save();
    return asset;
  }

  markProcessing(id: string, remoteJobId?: string, now = Date.now()): ImagineJob | null {
    const job = this.job(id); if (!job) return null;
    job.status = "processing"; job.progress = Math.max(job.progress, 1); job.updatedAt = now;
    if (remoteJobId) job.remoteJobId = remoteJobId;
    delete job.error; this.save(); return job;
  }

  setProgress(id: string, progress: number, now = Date.now()): ImagineJob | null {
    const job = this.job(id); if (!job || job.status === "completed" || job.status === "failed") return job;
    job.status = "processing"; job.progress = Math.max(1, Math.min(99, Math.round(progress))); job.updatedAt = now; this.save(); return job;
  }

  complete(id: string, results: Array<Omit<ImagineAsset, "id" | "createdAt" | "source" | "jobId">>, now = Date.now()): ImagineJob | null {
    const job = this.job(id); if (!job) return null;
    const made: ImagineAsset[] = results.slice(0, 8).map((result) => ({
      id: newId(), createdAt: now, source: "imagine", jobId: job.id, ...result,
      operation: job.operation, prompt: job.prompt,
      ...(result.parentAssetId || job.parentAssetId ? { parentAssetId: result.parentAssetId ?? job.parentAssetId } : {}),
      continuity: cleanContinuity({ ...(job.continuity ?? {}), ...(result.continuity ?? {}) }),
    }));
    this.assets.push(...made);
    if (this.assets.length > MAX_IMAGINE_ASSETS) this.assets.splice(0, this.assets.length - MAX_IMAGINE_ASSETS);
    job.status = "completed"; job.progress = 100; job.updatedAt = now; job.resultAssetIds = made.map((a) => a.id); delete job.error;
    this.save(); return job;
  }

  fail(id: string, error: string, now = Date.now()): ImagineJob | null {
    const job = this.job(id); if (!job) return null;
    job.status = "failed"; job.updatedAt = now; job.error = String(error).slice(0, 500); this.save(); return job;
  }

  retry(id: string, now = Date.now()): ImagineJob | null {
    const old = this.job(id); if (!old) return null;
    return this.create({
      botId: old.botId, taskId: old.taskId, projectId: old.projectId,
      operation: old.operation, prompt: old.prompt, inputAssetIds: old.inputAssetIds,
      parentAssetId: old.parentAssetId, continuity: old.continuity, retryOf: old.id,
    }, now);
  }
}

export function cleanContinuity(raw: ImagineContinuity): ImagineContinuity {
  const out: ImagineContinuity = {};
  for (const key of ["faceIdentity", "wardrobe", "objects", "scene", "camera", "seed"] as const) {
    if (typeof raw[key] === "string" && raw[key]!.trim()) out[key] = raw[key]!.trim().slice(0, 800);
  }
  for (const key of ["durationSeconds", "extendSeconds"] as const) {
    const n = Number(raw[key]); if (Number.isFinite(n) && n > 0) out[key] = Math.min(120, Math.round(n));
  }
  return out;
}

export function imagineContext(assets: ImagineAsset[]): string {
  if (!assets.length) return "";
  const recent = assets.slice(-12);
  const all = assets;
  return [
    "DIZA Imagine assets in this conversation. Asset numbering is stable in creation order; use these exact IDs when the user says 'the first/second/that image/video':",
    ...recent.map((asset) => {
      const ordinal = all.findIndex((a) => a.id === asset.id) + 1;
      const parent = asset.parentAssetId ? ` parent=${asset.parentAssetId}` : "";
      return `- Asset #${ordinal}: id=${asset.id} kind=${asset.kind}${parent} name=${asset.name}`;
    }),
    "Asset metadata is conversation context, not long-term memory. Never copy it into bot/project memory unless the user explicitly asks.",
  ].join("\n");
}

export interface DetectedImagineRequest {
  operation: ImagineOperation;
  inputAssetIds: string[];
  parentAssetId?: string;
  continuity?: ImagineContinuity;
}

function referencedAsset(text: string, assets: ImagineAsset[]): ImagineAsset | null {
  const lower = text.toLowerCase();
  const ordinals: Array<[RegExp, number]> = [
    [/\b(?:yang\s+)?pertama\b|\bfirst\b|#1\b/, 1],
    [/\b(?:yang\s+)?kedua\b|\bsecond\b|#2\b/, 2],
    [/\b(?:yang\s+)?ketiga\b|\bthird\b|#3\b/, 3],
    [/\b(?:yang\s+)?keempat\b|\bfourth\b|#4\b/, 4],
  ];
  for (const [pattern, n] of ordinals) if (pattern.test(lower)) return assets[n - 1] ?? null;
  const id = lower.match(/\basset\s*[:#]?\s*([\w-]{8,})\b/i)?.[1];
  if (id) return assets.find((a) => a.id.toLowerCase().startsWith(id.toLowerCase())) ?? null;
  if (/\b(?:ini|tadi|terakhir|last|previous|that)\b/.test(lower)) return assets.at(-1) ?? null;
  return null;
}

function seconds(text: string): number | undefined {
  const found = text.match(/\b(\d{1,3})\s*(?:detik|seconds?|sec|s)\b/i);
  if (!found) return undefined;
  return Math.min(120, Math.max(1, Number(found[1])));
}

/** Conservative, provider-independent fast path for explicit media asks.
 * Ambiguous prompts remain ordinary chat so Diza can reason before acting. */
export function detectImagineRequest(text: string, assets: ImagineAsset[]): DetectedImagineRequest | null {
  const lower = text.toLowerCase();
  const explicitCreate = /\b(buat(?:kan)?|bikin|generate|create|render|hasilkan|jadikan)\b/.test(lower);
  const videoWord = /\b(video|i2v|t2v|animasi|animate|bergerak|gerakkan|motion)\b/.test(lower);
  const imageWord = /\b(gambar|image|foto|photo|portrait|ilustrasi)\b/.test(lower);
  const imageCreateAsk = /\b(?:buat(?:kan)?|bikin|generate|create|render|hasilkan)\b\s+(?:(?:saya|aku|sebuah|satu|an?|the)\s+){0,2}(?:gambar|image|foto|photo|portrait|ilustrasi)\b/.test(lower);
  const videoCreateAsk = /\b(?:buat(?:kan)?|bikin|generate|create|render|hasilkan|jadikan)\b\s+(?:(?:saya|aku|sebuah|satu|an?|the)\s+){0,2}(?:video|animasi)\b/.test(lower);
  const explanatory = /\b(analisis|analisa|penjelasan|deskripsi|caption|cara kerja|explain|describe|analysis)\b/.test(lower);
  if (explanatory && !imageCreateAsk && !videoCreateAsk) return null;
  const editWord = /\b(edit|ubah|ganti|hapus|tambahkan|tambahkan|replace|remove|change)\b/.test(lower);
  const extendWord = /\b(lanjut(?:kan)?|extend|continue|perpanjang|sambung)\b/.test(lower);
  const variationWord = /\b(variasi|variation|versi lain|alternate|alternatif|regenerate)\b/.test(lower);
  const ref = referencedAsset(text, assets);
  const lastImage = [...assets].reverse().find((a) => a.kind === "image") ?? null;
  const lastVideo = [...assets].reverse().find((a) => a.kind === "video") ?? null;
  const duration = seconds(text);

  if (extendWord && (ref?.kind === "video" || lastVideo)) {
    const parent = ref?.kind === "video" ? ref : lastVideo!;
    return { operation: "video-extend", inputAssetIds: [parent.id], parentAssetId: parent.id, continuity: { extendSeconds: duration ?? 15 } };
  }
  if (variationWord && (ref || assets.length)) {
    const parent = ref ?? assets.at(-1)!;
    return { operation: "variation", inputAssetIds: [parent.id], parentAssetId: parent.id };
  }
  const motionAction = videoCreateAsk || /\b(gerakkan|animasikan|animate|turn into video|make it move)\b/.test(lower) || (explicitCreate && /\b(bergerak|motion)\b/.test(lower));
  if (videoWord && motionAction && (ref?.kind === "image" || (!ref && lastImage))) {
    const parent = ref?.kind === "image" ? ref : lastImage!;
    return { operation: "image-to-video", inputAssetIds: [parent.id], parentAssetId: parent.id, continuity: { durationSeconds: duration ?? 15 } };
  }
  if (videoWord && videoCreateAsk) return { operation: "text-to-video", inputAssetIds: [], continuity: { durationSeconds: duration ?? 15 } };
  if (editWord && (ref?.kind === "image" || lastImage)) {
    const parent = ref?.kind === "image" ? ref : lastImage!;
    return { operation: "image-edit", inputAssetIds: [parent.id], parentAssetId: parent.id };
  }
  if (imageWord && imageCreateAsk) return { operation: "image-generate", inputAssetIds: [] };
  return null;
}


export interface ImagineDirective {
  operation: ImagineOperation;
  prompt: string;
  inputAssetIds: string[];
  parentAssetId?: string;
  continuity?: ImagineContinuity;
}

/** API-backed models cannot run the one-turn CLI. They can emit the same
 * action as a fenced JSON directive; the server removes it from visible
 * prose and routes it through the identical job validator/store. */
export function extractImagineDirectives(raw: string): { directives: ImagineDirective[]; text: string } {
  const directives: ImagineDirective[] = [];
  const text = raw.replace(/```diza-imagine\s*\n([\s\S]*?)```/gi, (_whole, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      const op = safeOperation(parsed?.operation);
      const prompt = typeof parsed?.prompt === "string" ? parsed.prompt.trim().slice(0, MAX_IMAGINE_PROMPT) : "";
      if (!op || !prompt) return "";
      const ids = Array.isArray(parsed.inputAssetIds)
        ? parsed.inputAssetIds.filter((id: unknown): id is string => typeof id === "string").slice(0, 8)
        : [];
      directives.push({
        operation: op,
        prompt,
        inputAssetIds: ids,
        ...(typeof parsed.parentAssetId === "string" ? { parentAssetId: parsed.parentAssetId } : {}),
        ...(parsed.continuity && typeof parsed.continuity === "object" ? { continuity: cleanContinuity(parsed.continuity) } : {}),
      });
    } catch {
      /* malformed action disappears rather than becoming visible junk */
    }
    return "";
  }).trim();
  return { directives: directives.slice(0, 4), text };
}
