<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { api, type ApiWorkflow, type ApiWorkflowRun, type ApiSkill } from "$lib/api/client";
  import StatusBadge from "$lib/components/StatusBadge.svelte";

  let workflow: ApiWorkflow | null = null;
  let skills: ApiSkill[] = [];
  let runs: ApiWorkflowRun[] = [];
  let loading = true;
  let error: string | null = null;
  let triggering = false;
  let expandedRunId: string | null = null;

  $: workflowId = $page.params.id;

  onMount(async () => {
    await loadWorkflow();
    await loadRuns();
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
    } catch (e) {
      console.error("Failed to load runs:", e);
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

  function formatDate(timestamp: number | undefined): string {
    if (!timestamp) return "N/A";
    return new Date(timestamp).toLocaleString();
  }

  function formatTriggers(wf: ApiWorkflow): string {
    return wf.triggers.map((t) => `${t.source}:${t.events?.join(",") ?? "*"}`).join(", ");
  }

  function toggleRun(runId: string) {
    expandedRunId = expandedRunId === runId ? null : runId;
  }

  function getRunOutput(
    run: ApiWorkflowRun
  ): {
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

                  {#if !output && !run.error}
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
