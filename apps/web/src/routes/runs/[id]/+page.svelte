<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { api, type ApiRun } from "$lib/api/client";
  import { checkpointStore, type CheckpointData } from "$lib/stores/checkpoints";

  let run: ApiRun | null = null;
  let loading = true;
  let error: string | null = null;

  $: runId = $page.params.id as string;
  $: checkpoints = ($checkpointStore.byRunId[runId] ?? []) as CheckpointData[];

  onMount(async () => {
    try {
      const response = await api.getRun(runId);
      run = response.run;

      // Fetch checkpoints
      try {
        const cpResponse = await api.getRunCheckpoints(runId);
        checkpointStore.setCheckpoints(runId, cpResponse.checkpoints);
      } catch {
        // Checkpoints may not exist yet
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load run";
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    checkpointStore.clear(runId);
  });

  function formatDuration(start: number | null, end: number | null): string {
    if (!start) return "N/A";
    const endTime = end ?? Date.now();
    const duration = endTime - start;
    if (duration < 1000) return `${duration}ms`;
    if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`;
    return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function parseJson(str: string | null): unknown {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  function formatJson(data: unknown): string {
    if (typeof data === "string") return data;
    return JSON.stringify(data, null, 2);
  }

  function toRecord(data: unknown): Record<string, unknown> {
    return (data ?? {}) as Record<string, unknown>;
  }

  function getCheckpointIcon(type: string): string {
    switch (type) {
      case "assistant_message":
        return "💬";
      case "tool_call":
        return "🔧";
      case "tool_result":
        return "📤";
      case "skill_spawn":
        return "🚀";
      case "skill_complete":
        return "✅";
      case "hitl_request":
        return "🙋";
      case "hitl_response":
        return "💡";
      case "error":
        return "❌";
      default:
        return "📍";
    }
  }

  function getCheckpointLabel(type: string): string {
    switch (type) {
      case "assistant_message":
        return "Message";
      case "tool_call":
        return "Tool Call";
      case "tool_result":
        return "Tool Result";
      case "error":
        return "Error";
      default:
        return type;
    }
  }

  $: parsedOutput = run?.output ? parseJson(run.output) : null;
  $: parsedInput = run?.input ? parseJson(run.input) : null;
  $: parsedToolCalls = run?.toolCalls ? parseJson(run.toolCalls) : [];
</script>

<svelte:head>
  <title>Run {run?.id ?? ""} | Clawback</title>
</svelte:head>

<div class="p-8">
  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if run}
    <div class="mb-6">
      <a href="/runs" class="text-blue-400 hover:text-blue-300 text-sm">&larr; Back to Runs</a>
    </div>

    <div class="flex items-center gap-4 mb-6">
      <h1 class="text-2xl font-bold font-mono">{run.id}</h1>
      <span
        class="px-3 py-1 rounded-full text-sm font-medium {run.status === 'completed'
          ? 'bg-green-500/20 text-green-400'
          : run.status === 'failed'
            ? 'bg-red-500/20 text-red-400'
            : run.status === 'running'
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-gray-500/20 text-gray-400'}"
      >
        {run.status}
      </span>
    </div>

    <div class="grid gap-6">
      <!-- Summary -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-lg font-semibold mb-4">Summary</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div class="text-gray-400">Skill ID</div>
            <a href="/skills/{run.skillId}" class="text-blue-400 hover:text-blue-300 font-mono"
              >{run.skillId}</a
            >
          </div>
          <div>
            <div class="text-gray-400">Event ID</div>
            <a href="/events/{run.eventId}" class="text-blue-400 hover:text-blue-300 font-mono"
              >{run.eventId}</a
            >
          </div>
          <div>
            <div class="text-gray-400">Duration</div>
            <div class="font-mono">{formatDuration(run.startedAt, run.completedAt)}</div>
          </div>
          <div>
            <div class="text-gray-400">Created</div>
            <div>{formatDate(run.createdAt)}</div>
          </div>
        </div>
      </div>

      <!-- Live Activity Timeline (Checkpoints) -->
      {#if checkpoints.length > 0}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">
            Activity Timeline
            {#if run.status === "running"}
              <span class="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse ml-2"></span>
            {/if}
          </h2>
          <div class="space-y-3">
            {#each checkpoints as cp}
              {@const cpData = toRecord(cp.data)}
              <div class="flex gap-3 items-start">
                <span class="text-lg mt-0.5">{getCheckpointIcon(cp.type)}</span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-medium text-gray-300"
                      >{getCheckpointLabel(cp.type)}</span
                    >
                    <span class="text-xs text-gray-500"
                      >{new Date(cp.createdAt).toLocaleTimeString()}</span
                    >
                  </div>
                  {#if cp.type === "assistant_message" && cpData.text}
                    <p class="text-sm text-gray-400 whitespace-pre-wrap line-clamp-3">
                      {cpData.text}
                    </p>
                  {:else if cp.type === "tool_call" && cpData.toolName}
                    <div class="text-sm">
                      <span class="font-mono text-blue-400">{cpData.toolName}</span>
                    </div>
                  {:else if cp.type === "tool_result"}
                    <details class="text-sm">
                      <summary class="text-gray-400 cursor-pointer hover:text-gray-300"
                        >Result details</summary
                      >
                      <pre
                        class="mt-1 bg-gray-900 rounded p-2 text-xs text-gray-400 overflow-x-auto max-h-32">{formatJson(
                          cpData
                        )}</pre>
                    </details>
                  {:else if cp.type === "error"}
                    <p class="text-sm text-red-400">{cpData.error ?? "Unknown error"}</p>
                  {:else}
                    <details class="text-sm">
                      <summary class="text-gray-400 cursor-pointer hover:text-gray-300"
                        >Details</summary
                      >
                      <pre
                        class="mt-1 bg-gray-900 rounded p-2 text-xs text-gray-400 overflow-x-auto max-h-32">{formatJson(
                          cpData
                        )}</pre>
                    </details>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Output -->
      {#if parsedOutput}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">Output</h2>
          {#if typeof parsedOutput === "object" && parsedOutput !== null && "response" in parsedOutput}
            <div class="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap">
              {parsedOutput.response}
            </div>
          {:else}
            <pre
              class="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">{formatJson(
                parsedOutput
              )}</pre>
          {/if}
        </div>
      {/if}

      <!-- Error -->
      {#if run.error}
        <div class="bg-red-900/20 rounded-lg border border-red-500/30 p-6">
          <h2 class="text-lg font-semibold mb-4 text-red-400">Error</h2>
          <pre
            class="bg-gray-900 rounded-lg p-4 text-sm text-red-300 overflow-x-auto">{run.error}</pre>
        </div>
      {/if}

      <!-- Tool Calls -->
      {#if Array.isArray(parsedToolCalls) && parsedToolCalls.length > 0}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">Tool Calls ({parsedToolCalls.length})</h2>
          <div class="space-y-4">
            {#each parsedToolCalls as toolCall, i}
              <div class="bg-gray-900 rounded-lg p-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-gray-400 text-sm">#{i + 1}</span>
                  <span class="font-mono font-medium text-blue-400">{toolCall.name}</span>
                  {#if toolCall.error}
                    <span class="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded">error</span
                    >
                  {:else}
                    <span class="bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded"
                      >success</span
                    >
                  {/if}
                </div>
                <details class="text-sm">
                  <summary class="cursor-pointer text-gray-400 hover:text-gray-300">Details</summary
                  >
                  <div class="mt-2 space-y-2">
                    <div>
                      <div class="text-gray-500 text-xs mb-1">Input:</div>
                      <pre class="bg-gray-800 rounded p-2 text-xs overflow-x-auto">{formatJson(
                          toolCall.input
                        )}</pre>
                    </div>
                    {#if toolCall.output}
                      <div>
                        <div class="text-gray-500 text-xs mb-1">Output:</div>
                        <pre class="bg-gray-800 rounded p-2 text-xs overflow-x-auto">{formatJson(
                            toolCall.output
                          )}</pre>
                      </div>
                    {/if}
                    {#if toolCall.error}
                      <div>
                        <div class="text-gray-500 text-xs mb-1">Error:</div>
                        <pre
                          class="bg-gray-800 rounded p-2 text-xs text-red-400 overflow-x-auto">{toolCall.error}</pre>
                      </div>
                    {/if}
                  </div>
                </details>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Input -->
      <details class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <summary class="text-lg font-semibold cursor-pointer">Input (Event Data)</summary>
        <pre
          class="mt-4 bg-gray-900 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">{formatJson(
            parsedInput
          )}</pre>
      </details>
    </div>
  {/if}
</div>
