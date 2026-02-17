import { writable, derived } from "svelte/store";
import { api, type ApiHitlRequest } from "$lib/api/client";

interface HitlState {
  requests: ApiHitlRequest[];
  loading: boolean;
  error: string | null;
}

function createHitlStore() {
  const { subscribe, update } = writable<HitlState>({
    requests: [],
    loading: false,
    error: null,
  });

  return {
    subscribe,

    async load() {
      update((state) => ({ ...state, loading: true, error: null }));
      try {
        const { requests } = await api.getHitlRequests();
        update((state) => ({ ...state, requests, loading: false }));
      } catch (e) {
        const error = e instanceof Error ? e.message : "Failed to load HITL requests";
        update((state) => ({ ...state, loading: false, error }));
      }
    },

    /** Add a HITL request received from WebSocket */
    addRequest(request: ApiHitlRequest) {
      update((state) => {
        if (state.requests.some((r) => r.id === request.id)) {
          return state;
        }
        return { ...state, requests: [request, ...state.requests] };
      });
    },

    /** Remove a request after it's been responded to or cancelled */
    removeRequest(id: string) {
      update((state) => ({
        ...state,
        requests: state.requests.filter((r) => r.id !== id),
      }));
    },
  };
}

export const hitlStore = createHitlStore();

export const pendingHitlCount = derived(hitlStore, ($store) => $store.requests.length);
