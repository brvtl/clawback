<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";

  let status = { status: "unknown", version: "0.0.0", skills: 0, uptime: 0 };

  onMount(async () => {
    try {
      status = await api.getStatus();
    } catch (e) {
      console.error("Failed to load status:", e);
    }
  });
</script>

<svelte:head>
  <title>Settings | Clawback</title>
</svelte:head>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-8">Settings</h1>

  <div class="space-y-8 max-w-2xl">
    <!-- Server Info -->
    <section class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-lg font-semibold mb-4">Server Information</h2>

      <dl class="grid grid-cols-2 gap-4">
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
