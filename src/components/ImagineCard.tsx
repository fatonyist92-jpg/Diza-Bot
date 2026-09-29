import { useState } from "react";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import RefreshCcw from "lucide-react/dist/esm/icons/refresh-ccw.mjs";
import Film from "lucide-react/dist/esm/icons/film.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";

import { api, type Message } from "@/state/store";
import { Button } from "@/components/ui/button";

const LABEL: Record<string, string> = {
  "image-generate": "Image generation",
  "image-edit": "Image edit",
  "image-to-video": "Image to video",
  "text-to-video": "Text to video",
  "video-extend": "Video extend",
  variation: "Variation",
};

export function ImagineCard({ botId, taskId, message }: { botId: string; taskId: string; message: Message }) {
  const job = message.imagine;
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (!job) return null;

  const createFrom = async (operation: string, assetId: string, prompt: string, continuity?: Record<string, number>) => {
    setActing(operation);
    setActionError(null);
    try {
      await api("/api/imagine/jobs", {
        method: "POST",
        body: JSON.stringify({ botId, taskId, operation, prompt, inputAssetIds: [assetId], parentAssetId: assetId, continuity }),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not start DIZA Imagine");
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="my-1 w-full max-w-[620px] rounded-2xl border bg-card p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[13.5px] font-medium">
            <Sparkles size={14} /> DIZA Imagine · {LABEL[job.operation] ?? job.operation}
          </div>
          <div className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{job.prompt}</div>
        </div>
        <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{job.status}</span>
      </div>

      {(job.status === "queued" || job.status === "processing") && (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-300" style={{ width: `${Math.max(3, job.progress)}%` }} />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 size={11} className="animate-spin" /> {job.progress}%
          </div>
        </div>
      )}

      {job.error && <div className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{job.error}</div>}
      {actionError && <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{actionError}</div>}

      {job.assets?.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {job.assets.map((asset) => (
            <div key={asset.id} className="overflow-hidden rounded-xl border bg-background">
              {asset.kind === "image" ? (
                <img src={`/api/imagine/assets/${asset.id}/content`} alt={asset.name} className="max-h-[420px] w-full object-contain" />
              ) : (
                <video src={`/api/imagine/assets/${asset.id}/content`} controls playsInline className="max-h-[420px] w-full bg-black object-contain" />
              )}
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <div className="min-w-0">
                  <div className="truncate text-[11.5px] font-medium">Asset #{asset.ordinal} · {asset.name}</div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground">{asset.id}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(acting)}
                    onClick={() => createFrom("variation", asset.id, `Create a variation of Asset #${asset.ordinal} while preserving its identity and continuity.`)}
                  >
                    <RefreshCcw size={11} /> Variation
                  </Button>
                  {asset.kind === "video" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(acting)}
                      onClick={() => createFrom("video-extend", asset.id, `Extend Asset #${asset.ordinal} by 15 seconds from its final frame and preserve continuity.`, { extendSeconds: 15 })}
                    >
                      <Film size={11} /> +15s
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {job.status === "failed" && (
        <div className="mt-3">
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(acting)}
            onClick={async () => {
              setActing("retry");
              setActionError(null);
              try { await api(`/api/imagine/jobs/${job.jobId}/retry`, { method: "POST" }); }
              catch (error) { setActionError(error instanceof Error ? error.message : "Could not retry DIZA Imagine"); }
              finally { setActing(null); }
            }}
          >
            <RefreshCcw size={12} /> Retry
          </Button>
        </div>
      )}
    </div>
  );
}
