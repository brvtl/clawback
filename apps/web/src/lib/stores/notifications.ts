import { writable, derived } from "svelte/store";
import { browser } from "$app/environment";
import { api, type ApiNotification } from "$lib/api/client";
import { checkpointStore } from "./checkpoints";
import { hitlStore } from "./hitl";
import { builderStore } from "./builder";

interface NotificationState {
  notifications: ApiNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
}

function createNotificationStore() {
  const { subscribe, update } = writable<NotificationState>({
    notifications: [],
    unreadCount: 0,
    loading: false,
    error: null,
  });

  let wsConnection: WebSocket | null = null;

  return {
    subscribe,

    async load() {
      update((state) => ({ ...state, loading: true, error: null }));

      try {
        const { notifications, unreadCount } = await api.getNotifications({ limit: 50 });
        update((state) => ({
          ...state,
          notifications,
          unreadCount,
          loading: false,
        }));
      } catch (e) {
        const error = e instanceof Error ? e.message : "Failed to load notifications";
        update((state) => ({ ...state, loading: false, error }));
      }
    },

    async markRead(id: string) {
      try {
        await api.markNotificationRead(id);
        update((state) => ({
          ...state,
          notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
          unreadCount: Math.max(0, state.unreadCount - 1),
        }));
      } catch (e) {
        console.error("Failed to mark notification as read:", e);
      }
    },

    async markAllRead() {
      try {
        await api.markAllNotificationsRead();
        update((state) => ({
          ...state,
          notifications: state.notifications.map((n) => ({ ...n, read: true })),
          unreadCount: 0,
        }));
      } catch (e) {
        console.error("Failed to mark all notifications as read:", e);
      }
    },

    add(notification: ApiNotification) {
      update((state) => ({
        ...state,
        notifications: [notification, ...state.notifications],
        unreadCount: state.unreadCount + (notification.read ? 0 : 1),
      }));
    },

    getWsUrl(): string {
      if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string;

      const apiBase =
        (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";
      if (apiBase) {
        return apiBase.replace(/^http/, "ws") + "/ws";
      }

      // Empty API base (Docker) — derive from current page
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}/ws`;
    },

    connectWebSocket() {
      if (!browser) return;

      const wsUrl = this.getWsUrl();

      try {
        wsConnection = new WebSocket(wsUrl);

        wsConnection.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string) as Record<string, unknown>;

            if (data.type === "notification" && data.notification) {
              this.add(data.notification as ApiNotification);
            } else if (data.type === "checkpoint") {
              const runId = (data.runId ?? data.workflowRunId) as string;
              if (runId && data.checkpoint) {
                checkpointStore.addCheckpoint(
                  runId,
                  data.checkpoint as {
                    id: string;
                    sequence: number;
                    type: string;
                    data: unknown;
                    createdAt: number;
                  }
                );
              }
            } else if (data.type === "hitl_request" && data.request) {
              const req = data.request as {
                id: string;
                prompt: string;
                context?: unknown;
                options?: string[];
                timeoutAt?: number;
              };
              hitlStore.addRequest({
                id: req.id,
                workflowRunId: data.workflowRunId as string,
                checkpointId: "",
                status: "pending",
                prompt: req.prompt,
                context: req.context,
                options: req.options,
                timeoutAt: req.timeoutAt,
                createdAt: Date.now(),
              });
            } else if (data.type === "builder_text" && data.sessionId) {
              builderStore.appendText(data.sessionId as string, data.text as string);
            } else if (data.type === "builder_tool_call" && data.sessionId) {
              builderStore.setToolCall(data.sessionId as string, data.tool as string);
            } else if (data.type === "builder_tool_result" && data.sessionId) {
              builderStore.clearToolCall(data.sessionId as string);
            } else if (data.type === "builder_complete" && data.sessionId) {
              builderStore.onComplete(data.sessionId as string);
            } else if (data.type === "builder_error" && data.sessionId) {
              builderStore.onError(data.sessionId as string, data.error as string);
            } else if (data.type === "builder_status" && data.sessionId) {
              builderStore.onStatus(data.sessionId as string, data.status as string);
            }
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
        };

        wsConnection.onerror = (error) => {
          console.error("WebSocket error:", error);
        };

        wsConnection.onclose = () => {
          // Reconnect after 5 seconds
          setTimeout(() => this.connectWebSocket(), 5000);
        };
      } catch (e) {
        console.error("Failed to connect WebSocket:", e);
      }
    },

    disconnectWebSocket() {
      if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
      }
    },
  };
}

export const notifications = createNotificationStore();

export const unreadNotifications = derived(notifications, ($notifications) =>
  $notifications.notifications.filter((n) => !n.read)
);
