<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { api, type ApiEvent, type ApiRun } from "$lib/api/client";

  let event: ApiEvent | null = null;
  let runs: ApiRun[] = [];
  let loading = true;
  let error: string | null = null;

  $: eventId = $page.params.id;

  onMount(async () => {
    await loadEvent();
  });

  async function loadEvent() {
    loading = true;
    error = null;
    try {
      const response = await api.getEvent(eventId);
      event = response.event;
      runs = response.runs;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load event";
    } finally {
      loading = false;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function formatJson(str: string): string {
    try {
      return JSON.stringify(JSON.parse(str), null, 2);
    } catch {
      return str;
    }
  }
</script>

<svelte:head>
  <title>Event {eventId} | Clawback</title>
</svelte:head>

<div class="p-8">
  <div class="mb-6">
    <a href="/events" class="text-blue-400 hover:text-blue-300 text-sm">← Back to Events</a>
  </div>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if event}
    <div class="flex items-center gap-4 mb-8">
      <h1 class="text-3xl font-bold">{event.type}</h1>
      <StatusBadge status={event.status} />
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Event Details -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-xl font-semibold mb-4">Details</h2>
        <dl class="space-y-3">
          <div>
            <dt class="text-sm text-gray-400">ID</dt>
            <dd class="font-mono text-sm">{event.id}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-400">Source</dt>
            <dd>{event.source}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-400">Type</dt>
            <dd>{event.type}</dd>
          </div>
          <div>
            <dt class="text-sm text-gray-400">Status</dt>
            <dd><StatusBadge status={event.status} size="sm" /></dd>
          </div>
          <div>
            <dt class="text-sm text-gray-400">Created</dt>
            <dd>{formatDate(event.createdAt)}</dd>
          </div>
        </dl>
      </div>

      <!-- Runs triggered by this event -->
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-xl font-semibold mb-4">Runs</h2>
        {#if runs.length === 0}
          <p class="text-gray-400">No runs triggered by this event</p>
        {:else}
          <div class="space-y-2">
            {#each runs as run}
              <a
                href="/runs?id={run.id}"
                class="block p-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition-colors"
              >
                <div class="flex items-center justify-between">
                  <span class="font-mono text-sm">{run.id}</span>
                  <StatusBadge status={run.status} size="sm" />
                </div>
                <div class="text-sm text-gray-400 mt-1">
                  {formatDate(run.createdAt)}
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Payload -->
    <div class="mt-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
      <h2 class="text-xl font-semibold mb-4">Payload</h2>
      <pre
        class="bg-gray-900 rounded-lg p-4 overflow-x-auto text-sm font-mono text-gray-300">{formatJson(
          event.payload
        )}</pre>
    </div>

    <!-- Metadata -->
    {#if event.metadata && event.metadata !== "{}"}
      <div class="mt-6 bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h2 class="text-xl font-semibold mb-4">Metadata</h2>
        <pre
          class="bg-gray-900 rounded-lg p-4 overflow-x-auto text-sm font-mono text-gray-300">{formatJson(
            event.metadata
          )}</pre>
      </div>
    {/if}
  {/if}
</div>
