// One workspace-wide engine picker.
//
// Every agent follows this primary engine/model. Per-agent identity, memory,
// permissions and history stay separate, while capacity fallback may serve an
// individual turn on another authenticated engine when the primary is full.
import { useEffect, useRef, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Loader2 from "lucide-react/dist/esm/icons/loader-2.mjs";
import { api, useStore, type InstanceInfo } from "@/state/store";
import { ProviderMark } from "./ProviderIcons";
import { cn } from "@/lib/cn";

function modelLabel(instance: InstanceInfo | undefined, model: string): string {
  return instance?.models.options.find((o) => o.id === model)?.label ?? model;
}

const usable = (instance: InstanceInfo) =>
  instance.snapshot.state === "available" && instance.snapshot.authenticated !== false;

const byUsable = (a: InstanceInfo, b: InstanceInfo) =>
  Number(usable(b)) - Number(usable(a));

function effectiveModel(instance: InstanceInfo | undefined, model: string): string {
  const isKnown = instance?.models.options.some((o) => o.id === model);
  return isKnown ? model : (instance?.models.default ?? model);
}

export function GlobalEnginePicker({ className }: { className?: string }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [railId, setRailId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const selection =
    state.config?.engine ??
    state.bots[0]?.modelSelection ??
    (state.instances[0]
      ? { instanceId: state.instances[0].instanceId, model: state.instances[0].models.default }
      : { instanceId: "", model: "" });
  const active = state.instances.find((i) => i.instanceId === selection.instanceId);
  const railInstance =
    state.instances.find((i) => i.instanceId === (railId ?? selection.instanceId)) ??
    [...state.instances].sort(byUsable)[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (instance: InstanceInfo, model: string) => {
    if (!usable(instance) || saving) return;
    setSaving(true);
    setError(null);
    try {
      const status = await api("/api/config", {
        method: "PUT",
        body: JSON.stringify({ engine: { instanceId: instance.instanceId, model } }),
      });
      dispatch({ type: "configStatus", config: status });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        onClick={() => {
          setRailId(selection.instanceId || railInstance?.instanceId || null);
          setOpen((o) => !o);
        }}
        disabled={!state.instances.length || saving}
        className="flex h-9 min-w-[180px] items-center justify-between gap-2 rounded-xl border bg-background px-3 text-[12.5px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        title={
          active
            ? `${active.displayName} · ${modelLabel(active, effectiveModel(active, selection.model))}`
            : "Pilih engine workspace"
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {active && <ProviderMark driverKind={active.driverKind} size={14} />}
          <span className="truncate">
            {active
              ? `${active.displayName} · ${modelLabel(active, effectiveModel(active, selection.model))}`
              : "Pilih engine"}
          </span>
        </span>
        {saving ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} className="opacity-60" />}
      </button>

      {error && <div className="mt-1.5 max-w-[300px] text-[11.5px] text-destructive">{error}</div>}

      {open && (
        <div
          data-global-engine-picker
          className="absolute right-0 top-full z-40 mt-1.5 flex w-[320px] max-w-[92vw] origin-top-right animate-pop-in overflow-hidden rounded-xl border bg-popover shadow-lg shadow-[--shadow-color]"
        >
          <div className="flex max-h-[330px] flex-col gap-0.5 overflow-y-auto border-r bg-muted/40 p-1.5">
            {[...state.instances].sort(byUsable).map((instance) => {
              const unavailable = !usable(instance);
              const onRail = instance.instanceId === railInstance?.instanceId;
              return (
                <button
                  key={instance.instanceId}
                  onClick={() => setRailId(instance.instanceId)}
                  title={
                    unavailable
                      ? `${instance.displayName}: ${instance.snapshot.authenticated === false ? "belum login" : (instance.snapshot.reason ?? "unavailable")}`
                      : instance.displayName
                  }
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg transition-colors",
                    onRail ? "bg-accent" : "hover:bg-accent/60",
                    unavailable && "opacity-40",
                  )}
                >
                  <ProviderMark driverKind={instance.driverKind} size={16} />
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1 p-1.5">
            {railInstance ? (
              <>
                <div className="px-2 pb-1 pt-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-foreground">
                      {railInstance.displayName}
                    </span>
                    {state.providers.find((p) => p.kind === railInstance.driverKind)?.agentic && (
                      <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                        tools
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {usable(railInstance)
                      ? (railInstance.snapshot.version ?? "ready")
                      : railInstance.snapshot.authenticated === false
                        ? "Belum login"
                        : (railInstance.snapshot.reason ?? "unavailable")}
                  </div>
                </div>

                {railInstance.models.options.map((option) => {
                  const current =
                    selection.instanceId === railInstance.instanceId &&
                    effectiveModel(railInstance, selection.model) === option.id;
                  const disabled = !usable(railInstance);
                  return (
                    <button
                      key={option.id}
                      disabled={disabled || saving}
                      onClick={() => void pick(railInstance, option.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors",
                        disabled
                          ? "cursor-not-allowed text-muted-foreground/50"
                          : "text-foreground hover:bg-accent",
                        current && "bg-accent",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{option.label}</span>
                        {option.id === railInstance.models.default && (
                          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">
                            default
                          </span>
                        )}
                      </span>
                      {current && <Check size={14} className="shrink-0 text-brand-ink" />}
                    </button>
                  );
                })}
              </>
            ) : (
              <div className="px-2 py-3 text-[13px] text-muted-foreground">Belum ada engine.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
