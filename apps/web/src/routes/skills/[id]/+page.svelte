<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { api, type ApiSkill, type SkillModel } from "$lib/api/client";

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
  let editMcpServers = "";
  let editToolPermissions = "";
  let editNotifications = "";
  let editKnowledge = "";
  let editModel: SkillModel = "sonnet";

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
    editMcpServers = JSON.stringify(skill.mcpServers ?? {}, null, 2);
    editToolPermissions = JSON.stringify(
      skill.toolPermissions ?? { allow: ["*"], deny: [] },
      null,
      2
    );
    editNotifications = JSON.stringify(
      skill.notifications ?? { onComplete: false, onError: true },
      null,
      2
    );
    editKnowledge = (skill.knowledge ?? []).join("\n");
    editModel = skill.model ?? "sonnet";
  }

  function openEditModal() {
    initEditForm();
    showEditModal = true;
  }

  function closeEditModal() {
    showEditModal = false;
  }

  function parseJsonSafe(str: string, fieldName: string): { value: unknown; error: string | null } {
    try {
      return { value: JSON.parse(str), error: null };
    } catch {
      return { value: null, error: `Invalid JSON in ${fieldName}` };
    }
  }

  async function saveSkill() {
    if (!skill) return;

    saving = true;
    error = null;

    // Parse all JSON fields
    const triggersResult = parseJsonSafe(editTriggers, "Triggers");
    if (triggersResult.error) {
      error = triggersResult.error;
      saving = false;
      return;
    }

    const mcpServersResult = parseJsonSafe(editMcpServers, "MCP Servers");
    if (mcpServersResult.error) {
      error = mcpServersResult.error;
      saving = false;
      return;
    }

    const toolPermissionsResult = parseJsonSafe(editToolPermissions, "Tool Permissions");
    if (toolPermissionsResult.error) {
      error = toolPermissionsResult.error;
      saving = false;
      return;
    }

    const notificationsResult = parseJsonSafe(editNotifications, "Notifications");
    if (notificationsResult.error) {
      error = notificationsResult.error;
      saving = false;
      return;
    }

    try {
      const response = await api.updateSkill(skill.id, {
        name: editName,
        description: editDescription || undefined,
        instructions: editInstructions,
        triggers: triggersResult.value as ApiSkill["triggers"],
        mcpServers: mcpServersResult.value as ApiSkill["mcpServers"],
        toolPermissions: toolPermissionsResult.value as ApiSkill["toolPermissions"],
        notifications: notificationsResult.value as ApiSkill["notifications"],
        knowledge: editKnowledge.trim()
          ? editKnowledge.split("\n").filter((k) => k.trim())
          : undefined,
        model: editModel,
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
      <p class="text-gray-400 mb-4">{skill.description}</p>
    {/if}
    <div class="flex items-center gap-2 mb-8">
      <span class="text-sm text-gray-400">Model:</span>
      <span class="bg-purple-500/20 text-purple-400 text-sm px-2 py-1 rounded capitalize"
        >{skill.model ?? "sonnet"}</span
      >
    </div>

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
              {#if trigger.filters}
                <div class="text-sm text-gray-400 mt-1">
                  {#if trigger.filters.repository}
                    <span>Repository: {trigger.filters.repository}</span>
                  {/if}
                  {#if trigger.filters.ref}
                    <span class="ml-2">Refs: {trigger.filters.ref.join(", ")}</span>
                  {/if}
                </div>
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

      <!-- MCP Servers -->
      {#if skill.mcpServers && Object.keys(skill.mcpServers).length > 0}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">MCP Servers</h2>
          <div class="space-y-3">
            {#each Object.entries(skill.mcpServers) as [name, config]}
              <div class="bg-gray-900 rounded-lg p-4">
                <div class="font-mono text-blue-400 mb-2">{name}</div>
                <div class="text-sm text-gray-400">
                  <div>Command: <code class="text-gray-300">{config.command}</code></div>
                  {#if config.args && config.args.length > 0}
                    <div>Args: <code class="text-gray-300">{config.args.join(" ")}</code></div>
                  {/if}
                  {#if config.env && Object.keys(config.env).length > 0}
                    <div>
                      Env: <code class="text-gray-300">{Object.keys(config.env).join(", ")}</code>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Tool Permissions -->
      {#if skill.toolPermissions}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">Tool Permissions</h2>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-sm text-gray-400 mb-2">Allow</div>
              <div class="flex flex-wrap gap-2">
                {#each skill.toolPermissions.allow ?? ["*"] as pattern}
                  <span class="bg-green-500/20 text-green-400 text-xs px-2 py-1 rounded font-mono"
                    >{pattern}</span
                  >
                {/each}
              </div>
            </div>
            <div>
              <div class="text-sm text-gray-400 mb-2">Deny</div>
              <div class="flex flex-wrap gap-2">
                {#if skill.toolPermissions.deny && skill.toolPermissions.deny.length > 0}
                  {#each skill.toolPermissions.deny as pattern}
                    <span class="bg-red-500/20 text-red-400 text-xs px-2 py-1 rounded font-mono"
                      >{pattern}</span
                    >
                  {/each}
                {:else}
                  <span class="text-gray-500 text-sm">None</span>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Notifications -->
      {#if skill.notifications}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">Notifications</h2>
          <div class="flex gap-4">
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full {skill.notifications.onComplete
                  ? 'bg-green-500'
                  : 'bg-gray-600'}"
              ></span>
              <span class="text-sm text-gray-400">On Complete</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-full {skill.notifications.onError
                  ? 'bg-green-500'
                  : 'bg-gray-600'}"
              ></span>
              <span class="text-sm text-gray-400">On Error</span>
            </div>
          </div>
        </div>
      {/if}

      <!-- Knowledge -->
      {#if skill.knowledge && skill.knowledge.length > 0}
        <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h2 class="text-lg font-semibold mb-4">Knowledge Files</h2>
          <div class="space-y-2">
            {#each skill.knowledge as file}
              <div class="bg-gray-900 rounded px-3 py-2 font-mono text-sm text-gray-300">
                {file}
              </div>
            {/each}
          </div>
        </div>
      {/if}

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
      class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto m-4"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="document"
    >
      <h2 class="text-xl font-bold mb-4">Edit Skill</h2>

      {#if error}
        <div
          class="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 mb-4 text-sm"
        >
          {error}
        </div>
      {/if}

      <form on:submit|preventDefault={saveSkill} class="space-y-4">
        <div class="grid grid-cols-3 gap-4">
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
            <label for="model" class="block text-sm font-medium text-gray-400 mb-1">Model</label>
            <select
              id="model"
              bind:value={editModel}
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              <option value="haiku">Haiku (Fast, cheap)</option>
              <option value="sonnet">Sonnet (Balanced)</option>
              <option value="opus">Opus (Most capable)</option>
            </select>
          </div>
        </div>

        <div>
          <label for="instructions" class="block text-sm font-medium text-gray-400 mb-1"
            >Instructions</label
          >
          <textarea
            id="instructions"
            bind:value={editInstructions}
            required
            rows="8"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="triggers" class="block text-sm font-medium text-gray-400 mb-1"
              >Triggers (JSON)</label
            >
            <textarea
              id="triggers"
              bind:value={editTriggers}
              required
              rows="6"
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            ></textarea>
          </div>

          <div>
            <label for="mcpServers" class="block text-sm font-medium text-gray-400 mb-1"
              >MCP Servers (JSON)</label
            >
            <textarea
              id="mcpServers"
              bind:value={editMcpServers}
              rows="6"
              placeholder={'{\n  "server-name": {\n    "command": "npx",\n    "args": ["-y", "@example/mcp-server"]\n  }\n}'}
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            ></textarea>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label for="toolPermissions" class="block text-sm font-medium text-gray-400 mb-1"
              >Tool Permissions (JSON)</label
            >
            <textarea
              id="toolPermissions"
              bind:value={editToolPermissions}
              rows="4"
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            ></textarea>
          </div>

          <div>
            <label for="notifications" class="block text-sm font-medium text-gray-400 mb-1"
              >Notifications (JSON)</label
            >
            <textarea
              id="notifications"
              bind:value={editNotifications}
              rows="4"
              class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
            ></textarea>
          </div>
        </div>

        <div>
          <label for="knowledge" class="block text-sm font-medium text-gray-400 mb-1"
            >Knowledge Files (one per line)</label
          >
          <textarea
            id="knowledge"
            bind:value={editKnowledge}
            rows="3"
            placeholder={"./docs/example.md\n./knowledge/guide.txt"}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
        </div>

        <div class="flex justify-end gap-3 pt-4 border-t border-gray-700">
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
