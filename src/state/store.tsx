// All of the app's state, and the only place it talks to anything.
//
// The split that matters: the reducer next door is pure and knows nothing
// about the network, and every asynchronous thing happens here, either in
// the dispatch wrapper or in the event fold below. That is what makes the
// interesting logic testable without mounting a component or standing up
// a server.
//
// The app also owns no provider connections of its own. It sends typed
// commands and folds one event stream; anything that talks to a model
// happens in the harness.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { noticeFor } from "@/lib/notify";
import { maybeAutoSpeak } from "@/components/Voice";
import {
  findCard,
  isPermissionCard,
  initialState,
  reducer,
  type Action,
  type AppState,
  type Bot,
  type OptionCardData,
} from "./reducer";

export * from "./reducer";

// ── talking to the harness ─────────────────────────────────────────────
export async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

const StoreContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Text fields save as you type, so edits are coalesced per agent
  // rather than sending a request per keystroke.
  const patchTimers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; patch: Record<string, unknown> }>());

  const dispatch = useMemo(() => {
    const showError = (e: unknown) => {
      rawDispatch({ type: "error", message: e instanceof Error ? e.message : String(e) });
      setTimeout(() => rawDispatch({ type: "error", message: null }), 6000);
    };
    // Remembering that a card was dealt with is a nicety, not a
  // correctness requirement, so a failure here is allowed to pass.
    const persistCard = (botId: string, messageId: string, patch: Partial<OptionCardData>) => {
      fetch(`/api/bots/${botId}/cards/${messageId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    };

    const sendStreamingTurn = async (botId: string, body: Record<string, unknown>) => {
      let response: Response | null = null;
      for (let attempt = 0; attempt < 9; attempt += 1) {
        response = await fetch(`/api/bots/${botId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify(body),
        });
        if (response.ok) break;

        const failure = await response.clone().json().catch(() => ({}));
        const message = String(failure?.error ?? `${response.status} ${response.statusText}`);
        // Only replay requests that the Faable edge / DIZA loopback explicitly
        // says never reached a working core. A network exception is NOT
        // retried because the core may already have accepted that turn.
        const definitelyNotAccepted =
          message === "APP_UNREACHABLE" ||
          message === "DIZA backend is starting or unavailable" ||
          message.startsWith("DIZA persistence is unavailable.");
        if (!definitelyNotAccepted || attempt === 8) throw new Error(message);
        await new Promise((resolve) => setTimeout(resolve, 750 + attempt * 250));
      }
      if (!response?.ok) throw new Error("DIZA backend is starting or unavailable");
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.json().catch(() => ({}));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure: Error | null = null;
      const fold = (frame: any) => {
        if (frame.kind === "message") {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });
        } else if (frame.kind === "message.patch") {
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });
        } else if (frame.kind === "bot" && frame.bot?.id) {
          rawDispatch({ type: "botPatched", bot: frame.bot });
        } else if (frame.kind === "runtime" && frame.event?.type === "content.delta" && frame.event.streamKind === "assistant_text") {
          rawDispatch({ type: "streamDelta", threadId: frame.event.threadId, delta: frame.event.delta });
        } else if (frame.kind === "runtime" && frame.event?.type === "turn.completed") {
          rawDispatch({ type: "streamClear", threadId: frame.event.threadId });
        } else if (frame.kind === "request.error") {
          failure = new Error(frame.error || "The provider could not complete this turn.");
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const block of frames) {
          const line = block.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          try { fold(JSON.parse(line.slice(6))); } catch {}
        }
        if (done) break;
      }
      if (failure) throw failure;
    };

    const reconcileServerlessTurn = (botId: string) => {
      if (import.meta.env.VITE_DIZA_SERVERLESS !== "1") return;
      const current = stateRef.current.bots.find((bot) => bot.id === botId);
      if (current?.threadId) {
        rawDispatch({ type: "streamClear", threadId: current.threadId });
      }
      // The POST stream is the fast path, but Vercel may finish/persist the
      // turn even when a mobile browser misses its final frame. A fresh
      // serverless instance can briefly refuse the first read immediately
      // after that mutation, so retry only this read. Never replay the turn.
      const refresh = (attempt: number) => {
        api("/api/bots?messages=120")
          .then(({ bots }) => {
            if (Array.isArray(bots)) rawDispatch({ type: "hydrate", bots });
          })
          .catch(() => {
            if (attempt < 2) {
              setTimeout(() => refresh(attempt + 1), 400 * (attempt + 1));
            }
          });
      };
      refresh(0);
    };

    const wrapped: React.Dispatch<Action> = (action) => {
      rawDispatch(action);
      switch (action.type) {
        case "send":
          sendStreamingTurn(action.botId, {
            text: action.text,
            replyTo: action.replyTo,
            mode: action.mode ?? "auto",
          })
            .then(() => action.onAccepted?.())
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              action.onFailed?.(message);
              showError(error);
            })
            .finally(() => reconcileServerlessTurn(action.botId));
          break;
        case "answerCard": {
          const card = findCard(stateRef.current, action);
          if (card?.runId) {
            // A workflow run is parked on this card. Answering resumes
            // the run, which is a different thing from saying something
            // to an agent, so it goes to its own route. That route marks
            // the card answered itself: this one can be in a room, and
            // the card route only reaches an agent's own thread.
            api(`/api/workflows/runs/${card.runId}/answer`, {
              method: "POST",
              body: JSON.stringify({ answer: action.answer }),
            }).catch(showError);
          } else if (card?.requestId) {
            // A live provider ask settles against the agent that raised it,
            // wherever the card happens to be shown. Classify by the card,
            // never by button text: a legitimate human question can itself
            // have choices named "Allow" or "Deny".
            const permission = isPermissionCard(card);
            const behavior = permission
              ? action.answer === "Allow"
                ? "allow"
                : action.answer === "Deny"
                  ? "deny"
                  : "answer"
              : "answer";
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: card.requestId,
                behavior,
                message: behavior === "answer" ? action.answer : undefined,
              }),
            })
              .then(() => reconcileServerlessTurn(action.botId))
              .catch((error) => {
                showError(error);
                reconcileServerlessTurn(action.botId);
              });
          } else if (action.roomId) {
            api(`/api/bloks/${action.roomId}/messages`, {
              method: "POST",
              body: JSON.stringify({ text: action.answer }),
            }).catch(showError);
          } else {
            persistCard(action.botId, action.messageId, { answered: action.answer });
            api(`/api/bots/${action.botId}/messages`, {
              method: "POST",
              body: JSON.stringify({ text: action.answer }),
            }).catch(showError);
          }
          break;
        }
        // connecting an engine reloads the fleet server-side, so the model
        // picker has to be refetched alongside the provider list
        case "connectProvider":
          api(`/api/providers/${action.kind}/connect`, {
            method: "POST",
            body: JSON.stringify({ key: action.key ?? "", url: action.url ?? "" }),
          })
            .then(({ providers }) => {
              rawDispatch({ type: "providers", providers });
              return api("/api/instances").then(({ instances }) =>
                rawDispatch({ type: "instances", instances }),
              );
            })
            .catch(showError);
          break;
        case "disconnectProvider":
          api(`/api/providers/${action.kind}`, { method: "DELETE" })
            .then(({ providers }) => {
              rawDispatch({ type: "providers", providers });
              return api("/api/instances").then(({ instances }) =>
                rawDispatch({ type: "instances", instances }),
              );
            })
            .catch(showError);
          break;
        case "hireTeam":
          // the server creates the agents, opens the room and posts the
          // lead's brief; we just need to land the user in it
          api(`/api/teams/${action.messageId}/hire`, {
            method: "POST",
            body: JSON.stringify({ botId: action.botId }),
          })
            .then(({ blok }) =>
              api("/api/bloks").then(({ bloks }) => {
                rawDispatch({ type: "hydrateBloks", bloks });
                rawDispatch({ type: "select", id: blok.id });
              }),
            )
            .catch(showError);
          break;
        case "dismissCard": {
          const card = findCard(stateRef.current, action);
          if (card?.requestId) {
            const permission = isPermissionCard(card);
            api(`/api/bots/${action.botId}/respond`, {
              method: "POST",
              body: JSON.stringify({
                requestId: card.requestId,
                behavior: permission ? "deny" : "answer",
                message: permission ? "Ditolak dan ditutup oleh pengguna." : "Pertanyaan dilewati oleh pengguna.",
                dismissed: true,
              }),
            })
              .then(() => reconcileServerlessTurn(action.botId))
              .catch((error) => {
                showError(error);
                reconcileServerlessTurn(action.botId);
              });
          } else if (!action.roomId) {
            persistCard(action.botId, action.messageId, { dismissed: true });
          }
          break;
        }
        case "newBot":
          // one call: the server seeds the role's greeting and setup
          // question, so the agent never flashes as "New Agent"
          api("/api/bots", {
            method: "POST",
            body: JSON.stringify(action.profile ?? {}),
          })
            .then(({ bot }) => rawDispatch({ type: "botAdded", bot }))
            .catch(showError);
          break;
        case "duplicateBot": {
          const source = stateRef.current.bots.find((b) => b.id === action.botId);
          if (!source) break;
          api("/api/bots", { method: "POST" })
            .then(({ bot }) =>
              api(`/api/bots/${bot.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                  name: `${source.name} copy`,
                  title: source.title,
                  description: source.description,
                  notifications: source.notifications,
                  modelSelection: source.modelSelection,
                  ...(source.computer ? { computer: source.computer } : {}),
                }),
              }).then(({ bot: patched }) =>
                rawDispatch({ type: "botAdded", bot: { ...bot, ...patched, messages: bot.messages } }),
              ),
            )
            .catch(showError);
          break;
        }
        case "deleteBot":
          // Archived unless the caller says otherwise. Everything that
          // presses this from a row means "put it away"; only the drawer
          // asks for the other thing, and it asks in as many words.
          api(`/api/bots/${action.botId}${action.forget ? "?forget=1" : ""}`, { method: "DELETE" }).catch(
            showError,
          );
          break;
        case "restoreBot":
          api(`/api/bots/${action.botId}/restore`, { method: "POST" }).catch(showError);
          break;
        case "createRoom":
          api("/api/bloks", {
            method: "POST",
            body: JSON.stringify({ name: action.name, memberIds: action.memberIds }),
          })
            .then(({ blok }) => {
              rawDispatch({ type: "blokPatched", blok });
              rawDispatch({ type: "hydrateBloks", bloks: [] });
              return api("/api/bloks").then(({ bloks }) => {
                rawDispatch({ type: "hydrateBloks", bloks });
                rawDispatch({ type: "select", id: blok.id });
                rawDispatch({ type: "toggleNewRoom", open: false });
              });
            })
            .catch(showError);
          break;
        case "patchRoom":
          api(`/api/bloks/${action.blokId}`, {
            method: "PATCH",
            body: JSON.stringify(action.patch),
          }).catch(() => {});
          break;
        case "deleteRoom":
          api(`/api/bloks/${action.blokId}`, { method: "DELETE" })
            .then(() => rawDispatch({ type: "blokDeleted", blokId: action.blokId }))
            .catch(showError);
          break;
        case "newTask":
          api(`/api/bots/${action.botId}/tasks`, {
            method: "POST",
            body: JSON.stringify(action.projectId ? { projectId: action.projectId } : {}),
          })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "selectTask":
          api(`/api/bots/${action.botId}/tasks/${action.taskId}/activate`, { method: "POST" })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "closeTask":
          api(`/api/bots/${action.botId}/tasks/${action.taskId}`, { method: "DELETE" })
            .then((r) => r.bot && rawDispatch({ type: "botPatched", bot: r.bot }))
            .catch(showError);
          break;
        case "sendToRoom":
          api(`/api/bloks/${action.blokId}/messages`, {
            method: "POST",
            body: JSON.stringify({ text: action.text, replyTo: action.replyTo }),
          }).catch(showError);
          break;
        case "markUnread":
          api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify({ unread: true }) }).catch(
            () => {},
          );
          break;
        case "select": {
          const bot = stateRef.current.bots.find((b) => b.id === action.id);
          if (bot?.unread) {
            api(`/api/bots/${action.id}`, { method: "PATCH", body: JSON.stringify({ unread: false }) }).catch(() => {});
          }
          break;
        }
        case "setModel":
          api(`/api/bots/${action.botId}`, {
            method: "PATCH",
            body: JSON.stringify({ modelSelection: action.selection }),
          }).catch(showError);
          break;
        case "interrupt":
          api(`/api/bots/${action.botId}/interrupt`, { method: "POST" }).catch(showError);
          break;
        case "updateBot": {
          const timers = patchTimers.current;
          const pending = timers.get(action.botId);
          const patch = { ...pending?.patch, ...action.patch };
          if (pending) clearTimeout(pending.timer);
          timers.set(action.botId, {
            patch,
            timer: setTimeout(() => {
              timers.delete(action.botId);
              api(`/api/bots/${action.botId}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(showError);
            }, 400),
          });
          break;
        }
        default:
          break;
      }
    };
    return wrapped;
  }, []);

  // ── first load, then live updates ────────────────────────────────────
  /**
   * Raise a banner when something happens that is worth looking up for.
   * The decision lives in src/lib/notify.ts so it can be reasoned about
   * and tested on its own; this only supplies the context it needs and
   * hands the result to the shell.
   */
  /** Frames at or below this sequence are catch-up, not news. */
  const replayUntil = useRef(0);
  /** When each thread last raised a banner, to keep a chatty turn to one. */
  const lastBanner = useRef(new Map<string, number>());

  const announce = useCallback((threadId: string, message: unknown) => {
    const bridge = window.bloks;
    if (!bridge || !message) return;
    const current = stateRef.current;
    const bot = current.bots.find((b) => b.tasks?.some((t) => t.id === threadId));
    const room = current.bloks.find((r) => r.id === threadId);
    if (!bot && !room) return;
    const text = (message as { text?: string }).text ?? "";
    const notice = noticeFor(message as never, {
      focused: document.hasFocus() && document.visibilityState === "visible",
      selectedId: current.selectedId,
      threadId,
      ...(bot ? { bot: { id: bot.id, name: bot.name, notifications: bot.notifications } } : {}),
      ...(room ? { room: { id: room.id, name: room.name } } : {}),
      // a room line that named you is the one worth hearing about
      mentionsUser: /(^|\s)@(you|me)\b/i.test(text),
    });
    if (!notice) return;
    // A single turn can settle several messages. The first one is the
    // news; the rest would be the same news again, louder. An approval
    // is exempt, because it is the one thing that is always worth saying.
    const now = Date.now();
    const previous = lastBanner.current.get(threadId) ?? 0;
    if (!notice.urgent && now - previous < 4000) return;
    lastBanner.current.set(threadId, now);
    if (bot?.avatarAt) notice.avatar = `/api/bots/${bot.id}/avatar?v=${bot.avatarAt}`;
    void bridge.notifyShow(notice).catch(() => {});
  }, []);

  // Clicking a banner opens what it was about.
  useEffect(() => {
    const bridge = window.bloks;
    if (!bridge?.onNotifyActivate) return;
    return bridge.onNotifyActivate(({ target }) => {
      if (target) rawDispatch({ type: "select", id: target });
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const loadAll = async (): Promise<boolean> => {
      const results = await Promise.all([
        api("/api/bots")
          .then(({ bots }) => {
            if (alive) rawDispatch({ type: "hydrate", bots });
            return true;
          })
          .catch(() => false),
        api("/api/bloks")
          .then(({ bloks }) => {
            if (alive) rawDispatch({ type: "hydrateBloks", bloks });
            return true;
          })
          .catch(() => false),
        api("/api/instances")
          .then(({ instances }) => {
            if (alive) rawDispatch({ type: "instances", instances });
            return true;
          })
          .catch(() => false),
        api("/api/providers")
          .then(({ providers }) => {
            if (alive) rawDispatch({ type: "providers", providers });
            return true;
          })
          .catch(() => false),
        api("/api/config")
          .then((config) => {
            if (alive) rawDispatch({ type: "configStatus", config });
            return true;
          })
          .catch(() => false),
      ]);
      // Bot state is the minimum truthful definition of "connected":
      // without it the shell can look healthy while showing stale/empty chat.
      return results[0] === true;
    };
    // The stream carries sequence numbers, and reconnecting with the last
    // one seen replays exactly the missed frames. Only when the server
    // cannot cover the gap (hello says resumed: false) is the full state
    // re-downloaded, which turns most reconnects from a re-hydrate into a
    // catch-up. EventSource cannot change its URL between retries, so the
    // retry loop is ours.
    let es: EventSource | null = null;
    let lastSeq = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let streamFailures = 0;
    const startPollingFallback = () => {
      if (pollTimer) return;
      loadAll();
      pollTimer = setInterval(loadAll, 2000);
    };
    const stopPollingFallback = () => {
      if (!pollTimer) return;
      clearInterval(pollTimer);
      pollTimer = null;
    };
    const connect = () => {
      if (!alive) return;
      es = new EventSource(lastSeq ? `/api/events?since=${lastSeq}` : "/api/events");
      es.onopen = () => {
        streamFailures = 0;
        stopPollingFallback();
        rawDispatch({ type: "connected", value: true });
      };
      es.onerror = () => {
        streamFailures += 1;
        rawDispatch({ type: "connected", value: streamFailures >= 3 });
        es?.close();
        if (streamFailures >= 3) startPollingFallback();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, streamFailures >= 3 ? 15_000 : 1500);
      };
      es.onmessage = onFrame;
    };

    const onFrame = (raw: MessageEvent) => {
      let frame: any;
      try {
        frame = JSON.parse(raw.data);
      } catch {
        return;
      }
      if (typeof frame._seq === "number") lastSeq = frame._seq;
      switch (frame.kind) {
        case "hello":
          // Everything up to the server's current sequence is either
          // already ours or about to be replayed to catch us up. Neither
          // is news: a laptop opened after an hour should not fire an
          // hour of banners.
          replayUntil.current = typeof frame._seq === "number" ? frame._seq : 0;
          if (!frame.resumed) loadAll();
          break;
        case "message": {
          rawDispatch({ type: "messageAdded", threadId: frame.threadId, message: frame.message });
          // agents that opted in read their settled replies aloud, even
          // when their chat is not the one on screen
          const msg = frame.message;
          if (msg?.role === "bot" && msg.kind === "text" && msg.text) {
            const owner = stateRef.current.bots.find((b) =>
              b.tasks?.some((t) => t.id === frame.threadId),
            );
            if (owner) maybeAutoSpeak(owner, msg.text);
          }
          if (typeof frame._seq !== "number" || frame._seq > replayUntil.current) {
            announce(frame.threadId, msg);
          }
          break;
        }
        case "message.patch":
          rawDispatch({ type: "messagePatched", threadId: frame.threadId, message: frame.message });
          break;
        case "bot": {
          const bot = frame.bot as Partial<Bot> & { id: string };
          // an unread badge on the thread already open is wrong the
          // moment it arrives
          if (bot.unread && bot.id === stateRef.current.selectedId) {
            bot.unread = false;
            fetch(`/api/bots/${bot.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ unread: false }),
            }).catch(() => {});
          }
          rawDispatch({ type: "botPatched", bot });
          break;
        }
        case "runtime": {
          const event = frame.event;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") {
            rawDispatch({ type: "streamDelta", threadId: event.threadId, delta: event.delta });
          } else if (event.type === "turn.completed") {
            rawDispatch({ type: "streamClear", threadId: event.threadId });
          }
          break;
        }
        case "screen":
          rawDispatch({
            type: "screenFrame",
            botId: frame.botId,
            png: frame.png,
            mime: frame.mime ?? "image/png",
            ...(frame.source === "browser" ? { source: "browser" as const } : {}),
          });
          break;
        case "computer":
          rawDispatch({ type: "provisioning", botId: frame.botId, on: frame.state === "provisioning" });
          break;
        case "blok":
          rawDispatch({ type: "blokPatched", blok: frame.blok });
          break;
        case "blok.deleted":
          rawDispatch({ type: "blokDeleted", blokId: frame.blokId });
          break;
        // shared rooms: who is in them, who is at the door, who is typing
        case "room.people":
          if (Array.isArray(frame.people)) rawDispatch({ type: "roomPeople", roomId: frame.roomId, people: frame.people });
          break;
        case "room.joinRequest":
          rawDispatch({ type: "joinRequest", roomId: frame.roomId });
          break;
        case "room.typing":
          rawDispatch({ type: "roomTyping", roomId: frame.roomId, name: frame.name, at: frame.at ?? Date.now() });
          break;
        // an OAuth sign-in finishes in the browser, so the news that an
        // engine connected arrives here rather than from a fetch
        case "providers":
          rawDispatch({ type: "providers", providers: frame.providers });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          break;
        case "instances":
          if (Array.isArray(frame.instances)) rawDispatch({ type: "instances", instances: frame.instances });
          break;
        case "bot.deleted":
          rawDispatch({ type: "deleteBot", botId: frame.botId });
          break;
        // credentials changed and the engines were rebuilt, so the
        // picker needs to hear that something became usable
        case "config": {
          const { kind: _kind, _seq: _sequence, ...config } = frame;
          rawDispatch({
            type: "configStatus",
            config: { ...(stateRef.current.config ?? {}), ...config },
          });
          api("/api/instances")
            .then(({ instances }) => rawDispatch({ type: "instances", instances }))
            .catch(() => {});
          api("/api/providers")
            .then(({ providers }) => rawDispatch({ type: "providers", providers }))
            .catch(() => {});
          break;
        }
      }
    };
    // A Vercel turn carries its own event frames on the POST request;
    // keeping a second indefinite EventSource function open would add
    // cost without improving delivery. A refresh rehydrates from the
    // database-backed core, while the turn request carries live frames.
    if (import.meta.env.VITE_DIZA_SERVERLESS === "1") {
      rawDispatch({ type: "connected", value: false });
      const hydrateServerless = async () => {
        for (let attempt = 0; attempt < 3 && alive; attempt += 1) {
          if (await loadAll()) {
            if (alive) rawDispatch({ type: "connected", value: true });
            return;
          }
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
        if (alive) {
          rawDispatch({ type: "connected", value: false });
          rawDispatch({
            type: "error",
            message: "DIZA belum berhasil memuat chat. Mencoba lagi saat halaman dimuat ulang.",
          });
        }
      };
      void hydrateServerless();
    } else {
      connect();
    }
    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      stopPollingFallback();
      es?.close();
    };
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

export function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Sidebar stamps: a bare clock time on a three-day-old message reads as
 * "this morning". Show the time only for today, then the weekday, then
 * the date.
 */
export function formatWhen(at: number) {
  const then = new Date(at);
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (at >= midnight) return formatTime(at);
  if (at >= midnight - 86_400_000) return "Kemarin";
  if (at >= midnight - 6 * 86_400_000) return then.toLocaleDateString([], { weekday: "short" });
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}
