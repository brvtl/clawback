import { writable } from "svelte/store";
import { api } from "$lib/api/client";

interface BuilderMessage {
  role: "user" | "assistant";
  content: string;
}

interface BuilderState {
  sessionId: string | null;
  messages: BuilderMessage[];
  loading: boolean;
  currentToolCall: string | null;
  error: string | null;
}

const STORAGE_KEY = "clawback_builder_session_id";

function createBuilderStore() {
  const { subscribe, update, set } = writable<BuilderState>({
    sessionId: null,
    messages: [],
    loading: false,
    currentToolCall: null,
    error: null,
  });

  return {
    subscribe,

    /** Append streaming text to the current assistant message (or create one). */
    appendText(sessionId: string, text: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant") {
          msgs[msgs.length - 1] = { ...last, content: last.content + text };
        } else {
          msgs.push({ role: "assistant", content: text });
        }
        return { ...state, messages: msgs };
      });
    },

    setToolCall(sessionId: string, tool: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        return { ...state, currentToolCall: tool };
      });
    },

    clearToolCall(sessionId: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        return { ...state, currentToolCall: null };
      });
    },

    onComplete(sessionId: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        return { ...state, loading: false, currentToolCall: null };
      });
    },

    onError(sessionId: string, error: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        return { ...state, loading: false, currentToolCall: null, error };
      });
    },

    onStatus(sessionId: string, status: string) {
      update((state) => {
        if (state.sessionId !== sessionId) return state;
        return { ...state, loading: status === "processing" };
      });
    },

    /** Send a user message. Returns immediately after POST 202. */
    async sendMessage(message: string) {
      let currentSessionId: string | null = null;
      const unsubscribe = subscribe((s) => {
        currentSessionId = s.sessionId;
      });
      unsubscribe();

      // Add user message to local state
      update((state) => ({
        ...state,
        messages: [...state.messages, { role: "user", content: message }],
        loading: true,
        error: null,
      }));

      try {
        const { sessionId: returnedId } = await api.sendBuilderMessage(
          message,
          currentSessionId ?? undefined
        );

        // Store session ID
        update((state) => ({ ...state, sessionId: returnedId }));
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, returnedId);
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : "Failed to send message";
        update((state) => ({ ...state, loading: false, error }));
      }
    },

    /** Load an existing session from the server. */
    async loadSession(sessionId: string) {
      update((state) => ({ ...state, loading: true, error: null }));

      try {
        const { session, messages: rawMessages } = await api.getBuilderSession(sessionId);

        // Convert Anthropic messages to display messages
        const displayMessages = convertToDisplayMessages(rawMessages);

        set({
          sessionId: session.id,
          messages: displayMessages,
          loading: session.status === "processing",
          currentToolCall: null,
          error: session.lastError,
        });

        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, session.id);
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : "Failed to load session";
        update((state) => ({ ...state, loading: false, error }));
      }
    },

    /** Start a fresh session. */
    newSession() {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(STORAGE_KEY);
      }
      set({
        sessionId: null,
        messages: [],
        loading: false,
        currentToolCall: null,
        error: null,
      });
    },

    /** Get stored session ID from localStorage. */
    getStoredSessionId(): string | null {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(STORAGE_KEY);
    },
  };
}

/**
 * Convert Anthropic MessageParam[] to simple display messages.
 * Extracts text from content blocks, skips tool_use/tool_result internals.
 */
function convertToDisplayMessages(rawMessages: unknown[]): BuilderMessage[] {
  const display: BuilderMessage[] = [];

  for (const msg of rawMessages) {
    const m = msg as { role: string; content: unknown };
    if (m.role === "user") {
      if (typeof m.content === "string") {
        display.push({ role: "user", content: m.content });
      }
      // Skip tool_result arrays (they're internal)
    } else if (m.role === "assistant") {
      if (typeof m.content === "string") {
        display.push({ role: "assistant", content: m.content });
      } else if (Array.isArray(m.content)) {
        const textParts = (m.content as Array<{ type: string; text?: string }>)
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text as string);
        if (textParts.length > 0) {
          display.push({ role: "assistant", content: textParts.join("\n") });
        }
      }
    }
  }

  return display;
}

export const builderStore = createBuilderStore();
