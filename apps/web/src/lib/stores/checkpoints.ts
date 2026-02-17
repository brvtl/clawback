import { writable } from "svelte/store";

export interface CheckpointData {
  id: string;
  sequence: number;
  type: string;
  data: unknown;
  createdAt: number;
}

interface CheckpointState {
  /** Checkpoints keyed by runId or workflowRunId */
  byRunId: Record<string, CheckpointData[]>;
}

function createCheckpointStore() {
  const { subscribe, update } = writable<CheckpointState>({
    byRunId: {},
  });

  return {
    subscribe,

    /** Add a checkpoint received from WebSocket */
    addCheckpoint(runId: string, checkpoint: CheckpointData) {
      update((state) => {
        const existing = state.byRunId[runId] ?? [];
        // Avoid duplicates by id
        if (existing.some((cp) => cp.id === checkpoint.id)) {
          return state;
        }
        return {
          ...state,
          byRunId: {
            ...state.byRunId,
            [runId]: [...existing, checkpoint].sort((a, b) => a.sequence - b.sequence),
          },
        };
      });
    },

    /** Set checkpoints from API fetch (replaces existing) */
    setCheckpoints(runId: string, checkpoints: CheckpointData[]) {
      update((state) => ({
        ...state,
        byRunId: {
          ...state.byRunId,
          [runId]: checkpoints.sort((a, b) => a.sequence - b.sequence),
        },
      }));
    },

    /** Clear checkpoints for a run */
    clear(runId: string) {
      update((state) => {
        const byRunId = { ...state.byRunId };
        delete byRunId[runId];
        return { ...state, byRunId };
      });
    },
  };
}

export const checkpointStore = createCheckpointStore();
