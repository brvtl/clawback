<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import {
    api,
    type ApiWorkflow,
    type ApiWorkflowRun,
    type ApiSkill,
    type ApiHitlRequest,
  } from "$lib/api/client";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { checkpointStore, type CheckpointData } from "$lib/stores/checkpoints";

  let workflow: ApiWorkflow | null = null;
  let skills: ApiSkill[] = [];
  let runs: ApiWorkflowRun[] = [];
  let loading = true;
  let error: string | null = null;
  let triggering = false;
  let expandedRunId: string | null = null;
  let hitlResponses: Record<string, string> = {};
  let hitlSubmitting: Record<string, boolean> = {};
  let hitlRequests: Record<string, ApiHitlRequest[]> = {};

  $: workflowId = $page.params.id as string;

  // Get checkpoints for the expanded run
  $: expandedRunCheckpoints = expandedRunId
    ? (($checkpointStore.byRunId[expandedRunId] ?? []) as CheckpointData[])
    : [];

  onMount(async () => {
    await loadWorkflow();
    await loadRuns();
  });

  onDestroy(() => {
    if (expandedRunId) {
      checkpointStore.clear(expandedRunId);
    }
  });

  async function loadWorkflow() {
    loading = true;
    error = null;
    try {
      const response = await api.getWorkflow(workflowId);
      workflow = response.workflow;
      skills = response.skills;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load workflow";
    } finally {
      loading = false;
    }
  }

  async function loadRuns() {
    try {
      const response = await api.getWorkflowRuns(workflowId);
      runs = response.runs;

      // Load HITL requests for waiting runs
      for (const run of runs) {
        if (run.status === "waiting_for_input") {
          await loadHitlForRun(run.id);
        }
      }
    } catch (e) {
      console.error("Failed to load runs:", e);
    }
  }

  async function loadHitlForRun(_runId: string) {
    try {
      const { requests } = await api.getHitlRequests();
      // Filter for this workflow's runs
      const relevant = requests.filter((r) => runs.some((run) => run.id === r.workflowRunId));
      for (const req of relevant) {
        hitlRequests[req.workflowRunId] = [...(hitlRequests[req.workflowRunId] ?? []), req];
      }
      hitlRequests = hitlRequests;
    } catch {
      // Ignore
    }
  }

  async function triggerWorkflow() {
    if (!workflow) return;
    triggering = true;

    try {
      await api.triggerWorkflow(workflow.id, { manual: true });
      await loadRuns();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to trigger workflow";
    } finally {
      triggering = false;
    }
  }

  async function submitHitlResponse(requestId: string) {
    const response = hitlResponses[requestId];
    if (!response?.trim()) return;

    hitlSubmitting[requestId] = true;
    try {
      await api.respondToHitlRequest(requestId, response);
      // Remove from local state
      for (const runId of Object.keys(hitlRequests)) {
        hitlRequests[runId] = (hitlRequests[runId] ?? []).filter((r) => r.id !== requestId);
      }
      hitlRequests = hitlRequests;
      delete hitlResponses[requestId];
      // Reload runs to see status change
      setTimeout(() => void loadRuns(), 1000);
    } catch (e) {
      console.error("Failed to submit HITL response:", e);
    } finally {
      hitlSubmitting[requestId] = false;
    }
  }

  async function cancelHitl(requestId: string) {
    try {
      await api.cancelHitlRequest(requestId);
      for (const runId of Object.keys(hitlRequests)) {
        hitlRequests[runId] = (hitlRequests[runId] ?? []).filter((r) => r.id !== requestId);
      }
      hitlRequests = hitlRequests;
      await loadRuns();
    } catch (e) {
      console.error("Failed to cancel HITL request:", e);
    }
  }

  function formatDate(timestamp: number | undefined): string {
    if (!timestamp) return "N/A";
    return new Date(timestamp).toLocaleString();
  }

  function formatTriggers(wf: ApiWorkflow): string {
    return wf.triggers.map((t) => `${t.source}:${t.events?.join(",") ?? "*"}`).join(", ");
  }

  async function toggleRun(runId: string) {
    if (expandedRunId) {
      checkpointStore.clear(expandedRunId);
    }
    expandedRunId = expandedRunId === runId ? null : runId;

    // Load checkpoints for expanded run
    if (expandedRunId && workflow) {
      try {
        const cpResponse = await api.getWorkflowRunCheckpoints(workflow.id, expandedRunId);
        checkpointStore.setCheckpoints(expandedRunId, cpResponse.checkpoints);
      } catch {
        // May not have checkpoints yet
      }
    }
  }

  function getRunOutput(run: ApiWorkflowRun): {
    summary?: string;
    results?: Record<string, unknown>;
    skillRuns?: Array<{ skillName: string; status: string; output?: { response?: string } }>;
  } | null {
    if (!run.output) return null;
    return run.output as {
      summary?: string;
      results?: Record<string, unknown>;
      skillRuns?: Array<{ skillName: string; status: string; output?: { response?: string } }>;
    };
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

  function formatJson(data: unknown): string {
    if (typeof data === "string") return data;
    return JSON.stringify(data, null, 2);
  }

  function toRecord(data: unknown): Record<string, unknown> {
    return (data ?? {}) as Record<string, unknown>;
  }
</script>

<svelte:head>
  <title>{workflow?.name ?? "Workflow"} | Clawback</title>
</svelte:head>

<div class="p-6">
  {#if loading}
    <div class="text-gray-400">Loading workflow...</div>
  {:else if error}
    <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
      {error}
    </div>
  {:else if workflow}
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <div class="flex items-center gap-2 text-gray-400 text-sm mb-2">
          <a href="/workflows" class="hover:text-white">Workflows</a>
          <span>/</span>
          <span>{workflow.id}</span>
        </div>
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-bold">{workflow.name}</h1>
          <StatusBadge
            status={workflow.enabled ? "completed" : "failed"}
            label={workflow.enabled ? "Enabled" : "Disabled"}
          />
          <span class="text-xs px-2 py-1 bg-purple-900/50 text-purple-300 rounded">
            {workflow.orchestratorModel}
          </span>
        </div>
        {#if workflow.description}
          <p class="text-gray-400 mt-2">{workflow.description}</p>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        <button
          on:click={triggerWorkflow}
          disabled={triggering}
          class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 rounded-lg transition-colors"
        >
          {triggering ? "Triggering..." : "Trigger Manually"}
        </button>
        <a
          href="/workflows/{workflow.id}/edit"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          Edit
        </a>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Configuration -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Configuration</h2>

        <div class="space-y-4">
          <div>
            <span class="block text-sm text-gray-400 mb-1">Triggers</span>
            <div class="text-white">{formatTriggers(workflow)}</div>
          </div>

          <div>
            <span class="block text-sm text-gray-400 mb-1">Available Skills</span>
            <div class="space-y-2">
              {#each skills as skill}
                <a
                  href="/skills/{skill.id}"
                  class="block bg-gray-700 rounded p-2 hover:bg-gray-600 transition-colors"
                >
                  <div class="font-medium">{skill.name}</div>
                  {#if skill.description}
                    <div class="text-sm text-gray-400">{skill.description}</div>
                  {/if}
                </a>
              {:else}
                <div class="text-gray-500">No skills assigned</div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- Instructions -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Orchestrator Instructions</h2>
        <pre
          class="bg-gray-900 rounded p-4 text-sm text-gray-300 whitespace-pre-wrap overflow-auto max-h-64">{workflow.instructions}</pre>
      </div>
    </div>

    <!-- Recent Runs -->
    <div class="mt-6 bg-gray-800 rounded-lg p-6">
      <h2 class="text-lg font-semibold mb-4">Recent Runs</h2>

      {#if runs.length === 0}
        <div class="text-gray-500 text-center py-8">
          No runs yet. Trigger the workflow manually or wait for a matching event.
        </div>
      {:else}
        <div class="space-y-3">
          {#each runs.slice(0, 10) as run}
            <div class="bg-gray-700 rounded overflow-hidden">
              <button
                on:click={() => toggleRun(run.id)}
                class="w-full flex items-center justify-between p-3 hover:bg-gray-600 transition-colors text-left"
              >
                <div class="flex items-center gap-3">
                  <StatusBadge status={run.status} />
                  <span class="font-mono text-sm text-gray-400">{run.id}</span>
                </div>
                <div class="flex items-center gap-4 text-sm text-gray-400">
                  <span>{run.skillRuns.length} skills executed</span>
                  <span>{formatDate(run.createdAt)}</span>
                  <span class="text-lg">{expandedRunId === run.id ? "▼" : "▶"}</span>
                </div>
              </button>

              {#if expandedRunId === run.id}
                {@const output = getRunOutput(run)}
                <div class="border-t border-gray-600 p-4 space-y-4">
                  <!-- HITL Response Form -->
                  {#if run.status === "waiting_for_input" && hitlRequests[run.id]?.length}
                    {#each hitlRequests[run.id] as hitl}
                      <div
                        class="bg-purple-900/30 border border-purple-700 rounded-lg p-4 space-y-3"
                      >
                        <div class="flex items-center gap-2">
                          <span class="text-lg">🙋</span>
                          <h4 class="font-semibold text-purple-300">Human Input Requested</h4>
                        </div>
                        <p class="text-gray-300">{hitl.prompt}</p>
                        {#if hitl.context}
                          <p class="text-sm text-gray-400">
                            {typeof hitl.context === "object" &&
                            hitl.context !== null &&
                            "text" in hitl.context
                              ? hitl.context.text
                              : JSON.stringify(hitl.context)}
                          </p>
                        {/if}

                        {#if hitl.options?.length}
                          <div class="flex flex-wrap gap-2">
                            {#each hitl.options as option}
                              <button
                                on:click={() => {
                                  hitlResponses[hitl.id] = option;
                                }}
                                class="px-3 py-1.5 rounded-lg text-sm {hitlResponses[hitl.id] ===
                                option
                                  ? 'bg-purple-600 text-white'
                                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} transition-colors"
                              >
                                {option}
                              </button>
                            {/each}
                          </div>
                        {/if}

                        <div class="flex gap-2">
                          <input
                            type="text"
                            bind:value={hitlResponses[hitl.id]}
                            placeholder="Type your response..."
                            class="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
                            on:keydown={(e) => {
                              if (e.key === "Enter") void submitHitlResponse(hitl.id);
                            }}
                          />
                          <button
                            on:click={() => void submitHitlResponse(hitl.id)}
                            disabled={!hitlResponses[hitl.id]?.trim() || hitlSubmitting[hitl.id]}
                            class="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm transition-colors"
                          >
                            {hitlSubmitting[hitl.id] ? "Sending..." : "Send"}
                          </button>
                          <button
                            on:click={() => void cancelHitl(hitl.id)}
                            class="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    {/each}
                  {:else if run.status === "waiting_for_input"}
                    <div
                      class="bg-purple-900/30 border border-purple-700 rounded-lg p-4 text-purple-300"
                    >
                      Waiting for human input...
                    </div>
                  {/if}

                  <!-- Checkpoint Timeline -->
                  {#if expandedRunCheckpoints.length > 0}
                    <div>
                      <h4 class="text-sm font-semibold text-gray-300 mb-2">
                        Activity Timeline
                        {#if run.status === "running"}
                          <span
                            class="inline-block w-2 h-2 bg-blue-400 rounded-full animate-pulse ml-1"
                          ></span>
                        {/if}
                      </h4>
                      <div class="space-y-2 max-h-64 overflow-y-auto">
                        {#each expandedRunCheckpoints as cp}
                          {@const cpData = toRecord(cp.data)}
                          <div class="flex gap-2 items-start text-sm">
                            <span>{getCheckpointIcon(cp.type)}</span>
                            <div class="flex-1 min-w-0">
                              {#if cp.type === "assistant_message" && cpData.text}
                                <p class="text-gray-400 line-clamp-2">{cpData.text}</p>
                              {:else if cp.type === "tool_call"}
                                <span class="font-mono text-blue-400">{cpData.toolName}</span>
                              {:else if cp.type === "skill_spawn"}
                                <span class="text-gray-400">Spawning skill {cpData.skillId}</span>
                              {:else if cp.type === "skill_complete"}
                                <span class="text-gray-400">{cpData.skillId} - {cpData.status}</span
                                >
                              {:else if cp.type === "hitl_request"}
                                <span class="text-purple-400">{cpData.prompt}</span>
                              {:else if cp.type === "hitl_response"}
                                <span class="text-green-400">Response: {cpData.response}</span>
                              {:else if cp.type === "error"}
                                <span class="text-red-400">{cpData.error}</span>
                              {:else}
                                <details>
                                  <summary class="text-gray-400 cursor-pointer">{cp.type}</summary>
                                  <pre class="text-xs text-gray-500 mt-1">{formatJson(cpData)}</pre>
                                </details>
                              {/if}
                            </div>
                            <span class="text-xs text-gray-600 whitespace-nowrap">
                              {new Date(cp.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if run.error}
                    <div class="bg-red-900/30 border border-red-700 rounded p-3 text-red-300">
                      <strong>Error:</strong>
                      {run.error}
                    </div>
                  {/if}

                  {#if output?.summary}
                    <div>
                      <h4 class="text-sm font-semibold text-gray-300 mb-2">Summary</h4>
                      <p class="text-gray-400">{output.summary}</p>
                    </div>
                  {/if}

                  {#if output?.results}
                    <div>
                      <h4 class="text-sm font-semibold text-gray-300 mb-2">Results</h4>
                      <div class="bg-gray-900 rounded p-3 text-sm">
                        <dl class="grid grid-cols-2 gap-2">
                          {#each Object.entries(output.results) as [key, value]}
                            <dt class="text-gray-500">{key}:</dt>
                            <dd class="text-gray-300">
                              {typeof value === "object" ? JSON.stringify(value) : value}
                            </dd>
                          {/each}
                        </dl>
                      </div>
                    </div>
                  {/if}

                  {#if output?.skillRuns && output.skillRuns.length > 0}
                    <div>
                      <h4 class="text-sm font-semibold text-gray-300 mb-2">Skill Runs</h4>
                      <div class="space-y-3">
                        {#each output.skillRuns as skillRun}
                          <details class="bg-gray-900 rounded overflow-hidden">
                            <summary
                              class="p-3 cursor-pointer hover:bg-gray-800 flex items-center gap-3"
                            >
                              <StatusBadge status={skillRun.status} />
                              <span class="font-medium">{skillRun.skillName}</span>
                            </summary>
                            <div class="p-3 border-t border-gray-700">
                              {#if skillRun.output?.response}
                                <pre
                                  class="text-sm text-gray-300 whitespace-pre-wrap overflow-auto max-h-96">{skillRun
                                    .output.response}</pre>
                              {:else}
                                <span class="text-gray-500">No output</span>
                              {/if}
                            </div>
                          </details>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if !output && !run.error && run.status !== "waiting_for_input"}
                    <div class="text-gray-500">
                      {run.status === "running"
                        ? "Workflow is still running..."
                        : "No output available"}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
