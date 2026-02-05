<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ApiMcpServer } from "$lib/api/client";

  let status = { status: "unknown", version: "0.0.0", skills: 0, uptime: 0 };
  let mcpServers: ApiMcpServer[] = [];
  let loading = true;

  // MCP Server form state
  let showAddModal = false;
  let showEditModal = false;
  let editingServer: ApiMcpServer | null = null;
  let saving = false;
  let formError: string | null = null;

  // Form fields
  let formName = "";
  let formDescription = "";
  let formCommand = "";
  let formArgs = "";
  let formEnvJson = "{}";

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    loading = true;
    try {
      const [statusRes, serversRes] = await Promise.all([api.getStatus(), api.getMcpServers()]);
      status = statusRes;
      mcpServers = serversRes.servers;
    } catch (e) {
      console.error("Failed to load data:", e);
    } finally {
      loading = false;
    }
  }

  function openAddModal() {
    formName = "";
    formDescription = "";
    formCommand = "";
    formArgs = "";
    formEnvJson = "{}";
    formError = null;
    showAddModal = true;
  }

  function openEditModal(server: ApiMcpServer) {
    editingServer = server;
    formName = server.name;
    formDescription = server.description ?? "";
    formCommand = server.command;
    formArgs = server.args.join(" ");
    // Note: env values are masked, so we start with empty for editing
    formEnvJson = "{}";
    formError = null;
    showEditModal = true;
  }

  function closeModals() {
    showAddModal = false;
    showEditModal = false;
    editingServer = null;
    formError = null;
  }

  function parseEnvJson(): Record<string, string> | null {
    try {
      const parsed = JSON.parse(formEnvJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, string>;
    } catch {
      return null;
    }
  }

  async function saveNewServer() {
    const env = parseEnvJson();
    if (env === null) {
      formError = "Invalid JSON in environment variables";
      return;
    }

    saving = true;
    formError = null;

    try {
      await api.createMcpServer({
        name: formName,
        description: formDescription || undefined,
        command: formCommand,
        args: formArgs.trim() ? formArgs.trim().split(/\s+/) : [],
        env,
      });
      await loadData();
      closeModals();
    } catch (e) {
      formError = e instanceof Error ? e.message : "Failed to create MCP server";
    } finally {
      saving = false;
    }
  }

  async function updateServer() {
    if (!editingServer) return;

    const env = parseEnvJson();
    if (env === null) {
      formError = "Invalid JSON in environment variables";
      return;
    }

    saving = true;
    formError = null;

    try {
      const updates: Parameters<typeof api.updateMcpServer>[1] = {
        name: formName,
        description: formDescription || undefined,
        command: formCommand,
        args: formArgs.trim() ? formArgs.trim().split(/\s+/) : [],
      };

      // Only include env if it was modified (not empty)
      if (formEnvJson !== "{}") {
        updates.env = env;
      }

      await api.updateMcpServer(editingServer.id, updates);
      await loadData();
      closeModals();
    } catch (e) {
      formError = e instanceof Error ? e.message : "Failed to update MCP server";
    } finally {
      saving = false;
    }
  }

  async function deleteServer(server: ApiMcpServer) {
    if (
      !confirm(`Delete MCP server "${server.name}"? Skills using this server will stop working.`)
    ) {
      return;
    }

    try {
      await api.deleteMcpServer(server.id);
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete server");
    }
  }

  async function toggleServer(server: ApiMcpServer) {
    try {
      await api.updateMcpServer(server.id, { enabled: !server.enabled });
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to toggle server");
    }
  }
</script>

<svelte:head>
  <title>Settings | Clawback</title>
</svelte:head>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-8">Settings</h1>

  <div class="space-y-8 max-w-4xl">
    <!-- Server Info -->
    <section class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-semibold mb-4">Server Information</h2>

      <dl class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <dt class="text-sm text-gray-400">Status</dt>
          <dd class="text-lg font-medium">{status.status}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-400">Version</dt>
          <dd class="text-lg font-medium">{status.version}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-400">Skills Loaded</dt>
          <dd class="text-lg font-medium">{status.skills}</dd>
        </div>
        <div>
          <dt class="text-sm text-gray-400">Uptime</dt>
          <dd class="text-lg font-medium">{Math.floor(status.uptime / 60)}m</dd>
        </div>
      </dl>
    </section>

    <!-- MCP Servers -->
    <section class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-lg font-semibold">MCP Servers</h2>
        <button
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-sm"
          on:click={openAddModal}
        >
          Add Server
        </button>
      </div>

      <p class="text-sm text-gray-400 mb-4">
        Configure MCP (Model Context Protocol) servers that can be used by skills. Credentials are
        stored securely and referenced by name in skill configurations.
      </p>

      {#if loading}
        <div class="text-gray-400">Loading...</div>
      {:else if mcpServers.length === 0}
        <div class="text-gray-500 text-center py-8">
          No MCP servers configured. Add one to get started.
        </div>
      {:else}
        <div class="space-y-3">
          {#each mcpServers as server}
            <div
              class="bg-gray-900 rounded-lg p-4 border border-gray-700 {server.enabled
                ? ''
                : 'opacity-60'}"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-blue-400 font-medium">{server.name}</span>
                    {#if !server.enabled}
                      <span class="text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded"
                        >Disabled</span
                      >
                    {/if}
                  </div>
                  {#if server.description}
                    <p class="text-sm text-gray-400 mt-1">{server.description}</p>
                  {/if}
                  <div class="text-sm text-gray-500 mt-2 font-mono">
                    {server.command}
                    {server.args.join(" ")}
                  </div>
                  {#if Object.keys(server.env).length > 0}
                    <div class="text-xs text-gray-500 mt-1">
                      Env: {Object.keys(server.env).join(", ")}
                    </div>
                  {/if}
                </div>
                <div class="flex items-center gap-2">
                  <button
                    class="text-gray-400 hover:text-white text-sm px-2 py-1"
                    on:click={() => toggleServer(server)}
                  >
                    {server.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    class="text-blue-400 hover:text-blue-300 text-sm px-2 py-1"
                    on:click={() => openEditModal(server)}
                  >
                    Edit
                  </button>
                  <button
                    class="text-red-400 hover:text-red-300 text-sm px-2 py-1"
                    on:click={() => deleteServer(server)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- API Configuration -->
    <section class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-semibold mb-4">API Configuration</h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1" for="api-url">API URL</label>
          <input
            id="api-url"
            type="text"
            value={import.meta.env.VITE_API_URL ?? "http://localhost:3000"}
            readonly
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-gray-300"
          />
          <p class="text-xs text-gray-500 mt-1">Set via VITE_API_URL environment variable</p>
        </div>
      </div>
    </section>

    <!-- Quick Actions -->
    <section class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-semibold mb-4">Quick Actions</h2>

      <div class="space-y-3">
        <button
          class="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors text-left"
          on:click={async () => {
            try {
              await api.injectEvent({ test: true, timestamp: Date.now() });
              alert("Test event injected!");
            } catch (e) {
              alert("Failed to inject test event");
            }
          }}
        >
          Inject Test Event
        </button>
      </div>
    </section>
  </div>
</div>

<!-- Add MCP Server Modal -->
{#if showAddModal}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    on:click={closeModals}
    on:keydown={(e) => e.key === "Escape" && closeModals()}
    role="dialog"
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-lg m-4"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="document"
    >
      <h2 class="text-xl font-bold mb-4">Add MCP Server</h2>

      {#if formError}
        <div
          class="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 mb-4 text-sm"
        >
          {formError}
        </div>
      {/if}

      <form on:submit|preventDefault={saveNewServer} class="space-y-4">
        <div>
          <label for="name" class="block text-sm font-medium text-gray-400 mb-1">Name</label>
          <input
            id="name"
            bind:value={formName}
            required
            placeholder="e.g., github"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Unique identifier to reference this server</p>
        </div>

        <div>
          <label for="description" class="block text-sm font-medium text-gray-400 mb-1"
            >Description</label
          >
          <input
            id="description"
            bind:value={formDescription}
            placeholder="e.g., GitHub API access"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="command" class="block text-sm font-medium text-gray-400 mb-1">Command</label>
          <input
            id="command"
            bind:value={formCommand}
            required
            placeholder="e.g., npx"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="args" class="block text-sm font-medium text-gray-400 mb-1">Arguments</label>
          <input
            id="args"
            bind:value={formArgs}
            placeholder="e.g., -y @modelcontextprotocol/server-github"
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Space-separated arguments</p>
        </div>

        <div>
          <label for="env" class="block text-sm font-medium text-gray-400 mb-1"
            >Environment Variables (JSON)</label
          >
          <textarea
            id="env"
            bind:value={formEnvJson}
            rows="4"
            placeholder={'{\n  "GITHUB_TOKEN": "ghp_xxx"\n}'}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
          <p class="text-xs text-gray-500 mt-1">Credentials and tokens for this server</p>
        </div>

        <div class="flex justify-end gap-3 pt-4">
          <button
            type="button"
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            on:click={closeModals}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {saving ? "Creating..." : "Create Server"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Edit MCP Server Modal -->
{#if showEditModal && editingServer}
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    on:click={closeModals}
    on:keydown={(e) => e.key === "Escape" && closeModals()}
    role="dialog"
  >
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
      class="bg-gray-800 rounded-lg border border-gray-700 p-6 w-full max-w-lg m-4"
      on:click|stopPropagation
      on:keydown|stopPropagation
      role="document"
    >
      <h2 class="text-xl font-bold mb-4">Edit MCP Server</h2>

      {#if formError}
        <div
          class="bg-red-500/20 border border-red-500/30 rounded-lg p-3 text-red-400 mb-4 text-sm"
        >
          {formError}
        </div>
      {/if}

      <form on:submit|preventDefault={updateServer} class="space-y-4">
        <div>
          <label for="edit-name" class="block text-sm font-medium text-gray-400 mb-1">Name</label>
          <input
            id="edit-name"
            bind:value={formName}
            required
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="edit-description" class="block text-sm font-medium text-gray-400 mb-1"
            >Description</label
          >
          <input
            id="edit-description"
            bind:value={formDescription}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="edit-command" class="block text-sm font-medium text-gray-400 mb-1"
            >Command</label
          >
          <input
            id="edit-command"
            bind:value={formCommand}
            required
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="edit-args" class="block text-sm font-medium text-gray-400 mb-1"
            >Arguments</label
          >
          <input
            id="edit-args"
            bind:value={formArgs}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label for="edit-env" class="block text-sm font-medium text-gray-400 mb-1"
            >Environment Variables (JSON)</label
          >
          <textarea
            id="edit-env"
            bind:value={formEnvJson}
            rows="4"
            placeholder={'Leave as {} to keep existing values\n{\n  "GITHUB_TOKEN": "new_token"\n}'}
            class="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-blue-500"
          ></textarea>
          <p class="text-xs text-gray-500 mt-1">
            Leave as {"{ }"} to keep existing credentials, or provide new values
          </p>
        </div>

        <div class="flex justify-end gap-3 pt-4">
          <button
            type="button"
            class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            on:click={closeModals}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
