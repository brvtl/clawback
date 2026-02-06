<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { api, type ApiSkill, type ApiWorkflow } from "$lib/api/client";

  let workflow: ApiWorkflow | null = null;
  let name = "";
  let description = "";
  let instructions = "";
  let orchestratorModel: "opus" | "sonnet" = "opus";
  let enabled = true;

  // Trigger configuration
  let triggerSource = "github";
  let triggerEvents = "";
  let triggerSchedule = "";
  let filterRepository = "";

  // Skills
  let availableSkills: ApiSkill[] = [];
  let selectedSkillIds: string[] = [];

  let loading = true;
  let saving = false;
  let error: string | null = null;

  $: workflowId = $page.params.id;

  const eventSources = [
    { value: "github", label: "GitHub" },
    { value: "slack", label: "Slack" },
    { value: "linear", label: "Linear" },
    { value: "cron", label: "Scheduled (Cron)" },
    { value: "api", label: "API / Manual" },
  ];

  onMount(async () => {
    try {
      const [workflowResponse, skillsResponse] = await Promise.all([
        api.getWorkflow(workflowId),
        api.getSkills(),
      ]);

      workflow = workflowResponse.workflow;
      availableSkills = skillsResponse.skills;

      // Populate form fields
      name = workflow.name;
      description = workflow.description ?? "";
      instructions = workflow.instructions;
      orchestratorModel = workflow.orchestratorModel;
      enabled = workflow.enabled;
      selectedSkillIds = workflow.skills;

      // Parse first trigger
      if (workflow.triggers.length > 0) {
        const trigger = workflow.triggers[0];
        triggerSource = trigger.source;
        triggerEvents = trigger.events?.join(", ") ?? "";
        triggerSchedule = trigger.schedule ?? "";
        filterRepository = trigger.filters?.repository ?? "";
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load workflow";
    } finally {
      loading = false;
    }
  });

  function toggleSkill(skillId: string) {
    if (selectedSkillIds.includes(skillId)) {
      selectedSkillIds = selectedSkillIds.filter((id) => id !== skillId);
    } else {
      selectedSkillIds = [...selectedSkillIds, skillId];
    }
  }

  async function saveWorkflow() {
    if (!name.trim()) {
      error = "Name is required";
      return;
    }
    if (!instructions.trim()) {
      error = "Instructions are required";
      return;
    }
    if (selectedSkillIds.length === 0) {
      error = "At least one skill must be selected";
      return;
    }

    saving = true;
    error = null;

    try {
      // Build trigger
      const trigger: {
        source: string;
        events?: string[];
        schedule?: string;
        filters?: { repository?: string };
      } = {
        source: triggerSource,
      };

      if (triggerSource === "cron" && triggerSchedule) {
        trigger.schedule = triggerSchedule;
      } else if (triggerEvents) {
        trigger.events = triggerEvents.split(",").map((e) => e.trim());
      }

      if (filterRepository) {
        trigger.filters = { repository: filterRepository };
      }

      await api.updateWorkflow(workflowId, {
        name: name.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim(),
        triggers: [trigger],
        skills: selectedSkillIds,
        orchestratorModel,
        enabled,
      });

      await goto(`/workflows/${workflowId}`);
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save workflow";
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Edit {workflow?.name ?? "Workflow"} | Clawback</title>
</svelte:head>

<div class="p-6 max-w-4xl mx-auto">
  <div class="flex items-center gap-2 text-gray-400 text-sm mb-4">
    <a href="/workflows" class="hover:text-white">Workflows</a>
    <span>/</span>
    <a href="/workflows/{workflowId}" class="hover:text-white">{workflow?.name ?? workflowId}</a>
    <span>/</span>
    <span>Edit</span>
  </div>

  <h1 class="text-2xl font-bold mb-6">Edit Workflow</h1>

  {#if loading}
    <div class="text-gray-400">Loading workflow...</div>
  {:else if error && !workflow}
    <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300">
      {error}
    </div>
  {:else if workflow}
    {#if error}
      <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 mb-6">
        {error}
      </div>
    {/if}

    <form on:submit|preventDefault={saveWorkflow} class="space-y-6">
      <!-- Basic Info -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Basic Information</h2>

        <div class="space-y-4">
          <div>
            <label for="name" class="block text-sm text-gray-400 mb-1">Name *</label>
            <input
              id="name"
              type="text"
              bind:value={name}
              placeholder="Customer Onboarding"
              class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label for="description" class="block text-sm text-gray-400 mb-1">Description</label>
            <input
              id="description"
              type="text"
              bind:value={description}
              placeholder="Handles new customer setup across all systems"
              class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div class="flex items-center gap-6">
            <div class="flex-1">
              <label for="model" class="block text-sm text-gray-400 mb-1">Orchestrator Model</label>
              <select
                id="model"
                bind:value={orchestratorModel}
                class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              >
                <option value="opus">Opus (Most capable, higher cost)</option>
                <option value="sonnet">Sonnet (Faster, lower cost)</option>
              </select>
            </div>

            <div class="flex items-center gap-2 pt-6">
              <input
                id="enabled"
                type="checkbox"
                bind:checked={enabled}
                class="w-4 h-4 rounded bg-gray-700 border-gray-600"
              />
              <label for="enabled" class="text-sm text-gray-400">Enabled</label>
            </div>
          </div>
        </div>
      </div>

      <!-- Trigger -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Trigger</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="source" class="block text-sm text-gray-400 mb-1">Source</label>
            <select
              id="source"
              bind:value={triggerSource}
              class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
            >
              {#each eventSources as source}
                <option value={source.value}>{source.label}</option>
              {/each}
            </select>
          </div>

          {#if triggerSource === "cron"}
            <div>
              <label for="schedule" class="block text-sm text-gray-400 mb-1">Schedule (Cron)</label>
              <input
                id="schedule"
                type="text"
                bind:value={triggerSchedule}
                placeholder="0 9 * * *"
                class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">
                Cron expression (e.g., "0 9 * * *" for 9am daily)
              </p>
            </div>
          {:else}
            <div>
              <label for="events" class="block text-sm text-gray-400 mb-1">Events</label>
              <input
                id="events"
                type="text"
                bind:value={triggerEvents}
                placeholder="issues.labeled, push"
                class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              />
              <p class="text-xs text-gray-500 mt-1">Comma-separated event types</p>
            </div>
          {/if}

          {#if triggerSource === "github"}
            <div class="md:col-span-2">
              <label for="repository" class="block text-sm text-gray-400 mb-1"
                >Repository Filter (optional)</label
              >
              <input
                id="repository"
                type="text"
                bind:value={filterRepository}
                placeholder="owner/repo"
                class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 focus:outline-none focus:border-blue-500"
              />
            </div>
          {/if}
        </div>
      </div>

      <!-- Skills Selection -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">
          Available Skills
          <span class="text-sm font-normal text-gray-400">
            ({selectedSkillIds.length} selected)
          </span>
        </h2>

        {#if availableSkills.length === 0}
          <div class="text-gray-500 text-center py-8">
            <p>No skills available.</p>
            <a href="/builder" class="text-blue-400 hover:text-blue-300">
              Create skills first in the Builder
            </a>
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            {#each availableSkills as skill}
              <button
                type="button"
                on:click={() => toggleSkill(skill.id)}
                class="text-left p-4 rounded-lg border-2 transition-colors {selectedSkillIds.includes(
                  skill.id
                )
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-gray-600 bg-gray-700 hover:border-gray-500'}"
              >
                <div class="flex items-center gap-2">
                  <span class="text-lg">{selectedSkillIds.includes(skill.id) ? "✓" : "○"}</span>
                  <span class="font-medium">{skill.name}</span>
                </div>
                {#if skill.description}
                  <p class="text-sm text-gray-400 mt-1 ml-7">{skill.description}</p>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Instructions -->
      <div class="bg-gray-800 rounded-lg p-6">
        <h2 class="text-lg font-semibold mb-4">Orchestrator Instructions *</h2>
        <p class="text-sm text-gray-400 mb-3">
          Tell the AI how to orchestrate the selected skills. Be specific about the order, data
          passing, and error handling.
        </p>

        <textarea
          bind:value={instructions}
          rows="10"
          placeholder="When a new customer issue is labeled:
1. Extract customer name and email from the issue body
2. Create a HubSpot contact with their details
3. Notify #sales in Slack with the new contact info
4. Create an Asana project for their onboarding
5. Comment on the GitHub issue with links to all created resources"
          class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:border-blue-500 font-mono text-sm"
        ></textarea>
      </div>

      <!-- Submit -->
      <div class="flex items-center justify-end gap-4">
        <a
          href="/workflows/{workflowId}"
          class="px-6 py-2 text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </a>
        <button
          type="submit"
          disabled={saving}
          class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
  {/if}
</div>
