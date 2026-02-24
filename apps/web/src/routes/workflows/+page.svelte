<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ApiWorkflow } from "$lib/api/client";
  import StatusBadge from "$lib/components/StatusBadge.svelte";

  let workflows: ApiWorkflow[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    await loadWorkflows();
  });

  async function loadWorkflows() {
    loading = true;
    error = null;
    try {
      const response = await api.getWorkflows();
      workflows = response.workflows;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load workflows";
    } finally {
      loading = false;
    }
  }

  async function deleteWorkflow(id: string, name: string) {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      await api.deleteWorkflow(id);
      await loadWorkflows();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to delete workflow";
    }
  }

  function formatTriggers(workflow: ApiWorkflow): string {
    return workflow.triggers.map((t) => `${t.source}:${t.events?.join(",") ?? "*"}`).join(", ");
  }
</script>

<svelte:head>
  <title>Workflows | Clawback</title>
</svelte:head>

<div class="p-6">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold">Workflows</h1>
      <p class="text-gray-400 mt-1">AI-orchestrated multi-skill automations</p>
    </div>
    <a
      href="/workflows/new"
      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
    >
      + New Workflow
    </a>
  </div>

  {#if loading}
    <div class="text-gray-400">Loading workflows...</div>
  {:else if error}
    <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
      {error}
    </div>
  {:else if workflows.length === 0}
    <div class="bg-gray-800 rounded-lg p-8 text-center">
      <div class="text-4xl mb-4">🔀</div>
      <h3 class="text-xl font-semibold mb-2">No workflows yet</h3>
      <p class="text-gray-400 mb-4">
        Workflows let you chain multiple skills together with AI orchestration.
      </p>
      <a
        href="/workflows/new"
        class="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
      >
        Create your first workflow
      </a>
    </div>
  {:else}
    <div class="space-y-4">
      {#each workflows as workflow}
        <div class="bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
          <div class="flex items-start justify-between">
            <a href="/workflows/{workflow.id}" class="flex-1 group">
              <div class="flex items-center gap-3">
                <h3 class="text-lg font-semibold group-hover:text-blue-400 transition-colors">
                  {workflow.name}
                </h3>
                <StatusBadge
                  status={workflow.enabled ? "completed" : "failed"}
                  label={workflow.enabled ? "Enabled" : "Disabled"}
                />
                {#if workflow.system}
                  <span class="text-xs px-2 py-1 bg-cyan-900/50 text-cyan-300 rounded">
                    System
                  </span>
                {/if}
                <span class="text-xs px-2 py-1 bg-purple-900/50 text-purple-300 rounded">
                  {workflow.orchestratorModel}
                </span>
              </div>
              {#if workflow.description}
                <p class="text-gray-400 mt-1">{workflow.description}</p>
              {/if}
              <div class="flex items-center gap-4 mt-2 text-sm text-gray-500">
                <span>Triggers: {formatTriggers(workflow)}</span>
                <span>Skills: {workflow.skills.length}</span>
              </div>
            </a>
            <div class="flex items-center gap-2">
              <a
                href="/workflows/{workflow.id}/edit"
                class="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              >
                Edit
              </a>
              {#if !workflow.system}
                <button
                  on:click={() => deleteWorkflow(workflow.id, workflow.name)}
                  class="px-3 py-1 text-sm bg-red-900/50 hover:bg-red-900 text-red-300 rounded transition-colors"
                >
                  Delete
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
