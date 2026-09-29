export interface ReliabilitySnapshot {
  status: "ready" | "degraded";
  uptimeSeconds: number;
  counts: {
    bots: number;
    tasks: number;
    busyTasks: number;
    imagineQueued: number;
    imagineProcessing: number;
    imagineFailed: number;
  };
  imagine: { configured: boolean; enabled: boolean; stalledJobs: number };
  engines: { configured: number; available: number; unavailable: number };
  warnings: string[];
}

export function reliabilitySnapshot(input: {
  uptimeSeconds: number;
  bots: Array<{ tasks?: Array<{ busy?: boolean }> }>;
  imagineJobs: Array<{ status: string; updatedAt: number }>;
  imagineConfigured: boolean;
  imagineEnabled: boolean;
  engineStates?: Array<"available" | "unavailable">;
  now?: number;
  stalledAfterMs?: number;
}): ReliabilitySnapshot {
  const now = input.now ?? Date.now();
  const stalledAfter = input.stalledAfterMs ?? 20 * 60_000;
  const tasks = input.bots.flatMap((bot) => bot.tasks ?? []);
  const queued = input.imagineJobs.filter((j) => j.status === "queued");
  const processing = input.imagineJobs.filter((j) => j.status === "processing");
  const failed = input.imagineJobs.filter((j) => j.status === "failed");
  const stalled = [...queued, ...processing].filter((j) => now - j.updatedAt > stalledAfter);
  const engineStates = input.engineStates ?? [];
  const available = engineStates.filter((state) => state === "available").length;
  const unavailable = engineStates.length - available;
  const warnings: string[] = [];
  if (input.imagineEnabled && !input.imagineConfigured) warnings.push("Imagine is enabled but its bridge is not configured.");
  if (stalled.length) warnings.push(`${stalled.length} Imagine job(s) have not progressed for more than 20 minutes.`);
  return {
    status: warnings.length ? "degraded" : "ready",
    uptimeSeconds: Math.round(input.uptimeSeconds),
    counts: {
      bots: input.bots.length,
      tasks: tasks.length,
      busyTasks: tasks.filter((task) => task.busy).length,
      imagineQueued: queued.length,
      imagineProcessing: processing.length,
      imagineFailed: failed.length,
    },
    imagine: {
      configured: input.imagineConfigured,
      enabled: input.imagineEnabled,
      stalledJobs: stalled.length,
    },
    engines: { configured: engineStates.length, available, unavailable },
    warnings,
  };
}


export class FailureWindow {
  private events: Array<{ at: number; area: string }> = [];
  private readonly windowMs: number;
  private readonly maxEvents: number;
  constructor(windowMs = 15 * 60_000, maxEvents = 200) {
    this.windowMs = windowMs;
    this.maxEvents = maxEvents;
  }
  record(area: string, now = Date.now()): void {
    this.events.push({ at: now, area: String(area).slice(0, 40) });
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    this.prune(now);
  }
  snapshot(now = Date.now()): { windowMinutes: number; total: number; byArea: Record<string, number> } {
    this.prune(now);
    const byArea: Record<string, number> = {};
    for (const event of this.events) byArea[event.area] = (byArea[event.area] ?? 0) + 1;
    return { windowMinutes: Math.round(this.windowMs / 60_000), total: this.events.length, byArea };
  }
  private prune(now: number): void {
    const after = now - this.windowMs;
    this.events = this.events.filter((event) => event.at >= after);
  }
}
