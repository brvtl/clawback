<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ApiSkill } from "$lib/api/client";

  let skills: ApiSkill[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const response = await api.getSkills();
      skills = response.skills;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load skills";
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Skills | Clawback</title>
</svelte:head>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-8">Skills</h1>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if skills.length === 0}
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400 mb-4">No skills loaded</div>
      <p class="text-sm text-gray-500">
        Add skills to the <code class="bg-gray-900 px-2 py-1 rounded">skills/</code> directory
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each skills as skill}
        <a
          href="/skills/{skill.id}"
          class="bg-gray-800 rounded-lg border border-gray-700 p-6 hover:border-gray-600 transition-colors"
        >
          <h3 class="text-lg font-semibold mb-2">{skill.name}</h3>
          {#if skill.description}
            <p class="text-gray-400 text-sm mb-4">{skill.description}</p>
          {/if}
          <div class="text-xs text-gray-500">
            {skill.triggers.length} trigger{skill.triggers.length !== 1 ? "s" : ""}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
