<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { api, type ApiSkill } from "$lib/api/client";

  let skill: ApiSkill | null = null;
  let loading = true;
  let error: string | null = null;
  let showEditModal = false;
  let saving = false;
  let deleting = false;

  // Edit form state
  let editName = "";
  let editDescription = "";
  let editInstructions = "";
  let editTriggers = "";

  onMount(async () => {
    try {
      const response = await api.getSkill($page.params.id);
      skill = response.skill;
      initEditForm();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load skill";
    } finally {
      loading = false;
    }
  });

  function initEditForm() {
    if (!skill) return;
    editName = skill.name;
    editDescription = skill.description ?? "";
    editInstructions = skill.instructions;
    editTriggers = JSON.stringify(skill.triggers, null, 2);
  }

  function openEditModal() {
    initEditForm();
    showEditModal = true;
  }

  function closeEditModal() {
    showEditModal = false;
  }

  async function saveSkill() {
    if (!skill) return;

    saving = true;
    try {
      let parsedTriggers;
      try {
        parsedTriggers = JSON.parse(editTriggers);
      } catch {
        error = "Invalid triggers JSON";
        saving = false;
        return;
      }

      const response = await api.updateSkill(skill.id, {
        name: editName,
        description: editDescription || undefined,
        instructions: editInstructions,
        triggers: parsedTriggers,
      });

      skill = response.skill;
      showEditModal = false;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to save skill";
    } finally {
      saving = false;
    }
  }

  async function deleteSkill() {
    if (!skill) return;
    if (!confirm(`Are you sure you want to delete "${skill.name}"? This cannot be undone.`)) {
      return;
    }

    deleting = true;
    try {
      await api.deleteSkill(skill.id);
      await goto("/skills");
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to delete skill";
      deleting = false;
    }
  }
</script>

<svelte:head>
  <title>{skill?.name ?? "Skill"} | Clawback</title>
</svelte:head>

<div class="p-8">
  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error && !skill}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if skill}
    <div class="mb-6 flex items-center justify-between">
      <a href="/skills" class="text-blue-400 hover:text-blue-300 text-sm">&larr; Back to Skills</a>
      <div class="flex gap-2">
        <button
          on:click={openEditModal}
          class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Edit Skill
        </button>
        <button
          on:click={deleteSkill}
          disabled={deleting}
          class="bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>

    {#if error}
      <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400 mb-6">
        {error}
      </div>
    {/if}

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

<!-- Edit Modal -->
{#if showEditModal}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    on:click={closeEditModal}
    on:keydown={(e) => e.key === "Escape" && closeEditModal()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="document"
    >
      <h2 class="text-xl font-bold mb-4">Edit Skill</h2>

      <form on:submit|preventDefault={saveSkill} class="space-y-4">
        <div>
          <label for="name" class="block text-sm font-medium text-gray-400 mb-1">Name</label>
          <input
            id="name"
            type="text"
            bind:value={editName}
            required
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="description" class="block text-sm font-medium text-gray-400 mb-1"
            >Description</label
          >
          <input
            id="description"
            type="text"
            bind:value={editDescription}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="instructions" class="block text-sm font-medium text-gray-400 mb-1"
            >Instructions</label
          >
          <textarea
            id="instructions"
            bind:value={editInstructions}
            required
            rows="10"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
        </div>

        <div>
          <label for="triggers" class="block text-sm font-medium text-gray-400 mb-1"
            >Triggers (JSON)</label
          >
          <textarea
            id="triggers"
            bind:value={editTriggers}
            required
            rows="6"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
        </div>

        <div class="flex justify-end gap-3 pt-4">
          <button
            type="button"
            on:click={closeEditModal}
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            class="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
