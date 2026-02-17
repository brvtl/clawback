<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { ApiCheckpoint } from "$lib/api/client";
  import { hitlStore } from "$lib/stores/hitl";

  let loading = true;
  let error: string | null = null;
  let responses: Record<string, string> = {};
  let submitting: Record<string, boolean> = {};
  let checkpoints: Record<string, ApiCheckpoint[]> = {};
  let expandedTimelines: Record<string, boolean> = {};

  $: requests = $hitlStore.requests;

  onMount(async () => {
    try {
      await hitlStore.load();
      // Fetch checkpoints for each request's workflow run
      for (const req of $hitlStore.requests) {
        try {
          const cpResponse = await api.getCheckpointsByWorkflowRunId(req.workflowRunId);
          checkpoints[req.workflowRunId] = cpResponse.checkpoints;
        } catch {
          // Checkpoints may not exist
        }
      }
      checkpoints = checkpoints; // trigger reactivity
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load HITL requests";
    } finally {
      loading = false;
    }
  });

  async function submitResponse(requestId: string) {
    const response = responses[requestId];
    if (!response?.trim()) return;

    submitting[requestId] = true;
    try {
      await api.respondToHitlRequest(requestId, response);
      hitlStore.removeRequest(requestId);
      delete responses[requestId];
    } catch (e) {
      console.error("Failed to submit response:", e);
    } finally {
      submitting[requestId] = false;
    }
  }

  async function cancelRequest(requestId: string) {
    try {
      await api.cancelHitlRequest(requestId);
      hitlStore.removeRequest(requestId);
    } catch (e) {
      console.error("Failed to cancel request:", e);
    }
  }

  function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function toRecord(data: unknown): Record<string, unknown> {
    return (data ?? {}) as Record<string, unknown>;
  }

  /** Get the assistant messages from checkpoints - the actual conversation content */
  function getConversationMessages(
    cps: ApiCheckpoint[]
  ): { type: string; text: string; time: number }[] {
    const messages: { type: string; text: string; time: number }[] = [];
    for (const cp of cps) {
      const data = toRecord(cp.data);
      if (cp.type === "assistant_message" && data.text) {
        messages.push({ type: "assistant", text: String(data.text), time: cp.createdAt });
      } else if (cp.type === "skill_spawn" && data.skillId) {
        messages.push({
          type: "skill",
          text: `Spawned skill: ${String(data.skillName ?? data.skillId)}`,
          time: cp.createdAt,
        });
      } else if (cp.type === "skill_complete") {
        const output = data.output ? String(data.output).slice(0, 500) : "completed";
        messages.push({ type: "result", text: `Skill result: ${output}`, time: cp.createdAt });
      }
    }
    return messages;
  }
</script>

<svelte:head>
  <title>Human Input Requests | Clawback</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold">Human Input Requests</h1>
      <p class="text-gray-400 mt-1">Workflows paused and waiting for your input</p>
    </div>
    <button
      on:click={() => hitlStore.load()}
      class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
    >
      Refresh
    </button>
  </div>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
      {error}
    </div>
  {:else if requests.length === 0}
    <div class="bg-gray-800 rounded-lg p-12 text-center">
      <div class="text-4xl mb-4">✅</div>
      <h2 class="text-xl font-semibold text-gray-300 mb-2">No pending requests</h2>
      <p class="text-gray-500">When a workflow needs human input, it will appear here.</p>
    </div>
  {:else}
    <div class="space-y-6">
      {#each requests as request}
        {@const wfCheckpoints = checkpoints[request.workflowRunId] ?? []}
        {@const conversation = getConversationMessages(wfCheckpoints)}
        <div class="bg-gray-800 rounded-lg border border-purple-700/50 overflow-hidden">
          <!-- Conversation history -->
          {#if conversation.length > 0}
            <div class="border-b border-gray-700">
              <button
                class="w-full flex items-center justify-between px-6 py-3 text-sm text-gray-400 hover:bg-gray-750 transition-colors"
                on:click={() => {
                  expandedTimelines[request.id] = !expandedTimelines[request.id];
                }}
              >
                <span class="flex items-center gap-2">
                  <span>📋</span>
                  <span>Conversation History ({conversation.length} messages)</span>
                </span>
                <span class="text-xs">{expandedTimelines[request.id] ? "▼" : "▶"}</span>
              </button>

              {#if expandedTimelines[request.id]}
                <div class="px-6 pb-4 space-y-3 max-h-96 overflow-y-auto">
                  {#each conversation as msg}
                    <div class="flex gap-3 items-start">
                      <span class="text-sm mt-0.5 flex-shrink-0">
                        {msg.type === "assistant" ? "💬" : msg.type === "skill" ? "🚀" : "📤"}
                      </span>
                      <div class="min-w-0">
                        <p class="text-sm text-gray-300 whitespace-pre-wrap break-words">
                          {msg.text}
                        </p>
                        <span class="text-xs text-gray-500"
                          >{new Date(msg.time).toLocaleTimeString()}</span
                        >
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}

              <!-- Always show last assistant message as context preview -->
              {#if !expandedTimelines[request.id]}
                {@const lastMsg = conversation.filter((m) => m.type === "assistant").at(-1)}
                {#if lastMsg}
                  <div class="px-6 pb-4">
                    <div
                      class="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap"
                    >
                      {lastMsg.text.length > 600
                        ? lastMsg.text.slice(0, 600) + "..."
                        : lastMsg.text}
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}

          <!-- HITL prompt and response -->
          <div class="p-6 space-y-4">
            <div class="flex items-start justify-between">
              <div class="flex items-center gap-3">
                <span class="text-2xl">🙋</span>
                <div>
                  <h3 class="font-semibold text-lg">{request.prompt}</h3>
                  <div class="flex items-center gap-3 text-sm text-gray-400 mt-1">
                    <a href="/workflows" class="text-blue-400 hover:text-blue-300">
                      Workflow Run: <code>{request.workflowRunId}</code>
                    </a>
                    <span>{formatTimeAgo(request.createdAt)}</span>
                  </div>
                </div>
              </div>
              {#if request.timeoutAt}
                <span
                  class="text-xs text-orange-400 bg-orange-900/30 px-2 py-1 rounded flex-shrink-0"
                >
                  Expires {formatTime(request.timeoutAt)}
                </span>
              {/if}
            </div>

            {#if request.context}
              <div class="bg-gray-900 rounded-lg p-4 text-sm text-gray-400">
                {typeof request.context === "object" &&
                request.context !== null &&
                "text" in request.context
                  ? request.context.text
                  : JSON.stringify(request.context, null, 2)}
              </div>
            {/if}

            {#if request.options?.length}
              <div>
                <span class="text-sm text-gray-400 mb-2 block">Suggested responses:</span>
                <div class="flex flex-wrap gap-2">
                  {#each request.options as option}
                    <button
                      on:click={() => {
                        responses[request.id] = option;
                      }}
                      class="px-4 py-2 rounded-lg text-sm {responses[request.id] === option
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} transition-colors"
                    >
                      {option}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="flex gap-3">
              <input
                type="text"
                bind:value={responses[request.id]}
                placeholder="Type your response..."
                class="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                on:keydown={(e) => {
                  if (e.key === "Enter") void submitResponse(request.id);
                }}
              />
              <button
                on:click={() => void submitResponse(request.id)}
                disabled={!responses[request.id]?.trim() || submitting[request.id]}
                class="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
              >
                {submitting[request.id] ? "Sending..." : "Send Response"}
              </button>
              <button
                on:click={() => void cancelRequest(request.id)}
                class="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
