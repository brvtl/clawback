<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { api, type ApiSkill } from "$lib/api/client";

  let skill: ApiSkill | null = null;
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const response = await api.getSkill($page.params.id);
      skill = response.skill;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load skill";
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>{skill?.name ?? "Skill"} | Clawback</title>
</svelte:head>

<div class="p-8">
  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if skill}
    <div class="mb-6">
      <a href="/skills" class="text-blue-400 hover:text-blue-300 text-sm">&larr; Back to Skills</a>
    </div>

    <h1 class="text-3xl font-bold mb-2">{skill.name}</h1>
    {#if skill.description}
      <p class="text-gray-400 mb-8">{skill.description}</p>
    {/if}

    <div class="grid gap-6">
      <!-- Triggers -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-lg font-semibold mb-4">Triggers</h2>
        <div class="space-y-3">
          {#each skill.triggers as trigger}
            <div class="bg-gray-900 rounded-lg p-4">
              <div class="flex items-center gap-2 mb-2">
                <span class="bg-blue-500/20 text-blue-400 text-xs px-2 py-1 rounded"
                  >{trigger.source}</span
                >
                {#if trigger.events}
                  {#each trigger.events as event}
                    <span class="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded"
                      >{event}</span
                    >
                  {/each}
                {/if}
              </div>
              {#if trigger.schedule}
                <div class="text-sm text-gray-400">Schedule: {trigger.schedule}</div>
              {/if}
            </div>
          {/each}
        </div>
      </div>

      <!-- Instructions -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-lg font-semibold mb-4">Instructions</h2>
        <pre
          class="bg-gray-900 rounded-lg p-4 text-sm text-gray-300 whitespace-pre-wrap overflow-x-auto">{skill.instructions}</pre>
      </div>

      <!-- Skill ID -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-lg font-semibold mb-4">Skill ID</h2>
        <code class="bg-gray-900 px-3 py-2 rounded text-sm text-gray-300">{skill.id}</code>
      </div>
    </div>
  {/if}
</div>
