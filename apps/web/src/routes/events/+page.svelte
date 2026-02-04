<script lang="ts">
  import { onMount } from "svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { api, type ApiEvent } from "$lib/api/client";

  let events: ApiEvent[] = [];
  let loading = true;
  let error: string | null = null;
  let offset = 0;
  const limit = 20;

  onMount(async () => {
    await loadEvents();
  });

  async function loadEvents() {
    loading = true;
    error = null;
    try {
      const response = await api.getEvents({ limit, offset });
      events = response.events;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load events";
    } finally {
      loading = false;
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  async function nextPage() {
    offset += limit;
    await loadEvents();
  }

  async function prevPage() {
    offset = Math.max(0, offset - limit);
    await loadEvents();
  }
</script>

<svelte:head>
  <title>Events | Clawback</title>
</svelte:head>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-8">Events</h1>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if events.length === 0}
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400">No events yet</div>
    </div>
  {:else}
    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full">
        <thead class="bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Type</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Source</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Created</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-700">
          {#each events as event}
            <tr class="hover:bg-gray-700/50 transition-colors">
              <td class="px-4 py-3">
                <a href="/events/{event.id}" class="text-blue-400 hover:text-blue-300">
                  {event.type}
                </a>
              </td>
              <td class="px-4 py-3 text-gray-400">{event.source}</td>
              <td class="px-4 py-3">
                <StatusBadge status={event.status} size="sm" />
              </td>
              <td class="px-4 py-3 text-gray-400 text-sm">
                {formatDate(event.createdAt)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="flex justify-between items-center mt-4">
      <button
        class="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={offset === 0}
        on:click={prevPage}
      >
        Previous
      </button>
      <span class="text-gray-400 text-sm">Page {Math.floor(offset / limit) + 1}</span>
      <button
        class="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        disabled={events.length < limit}
        on:click={nextPage}
      >
        Next
      </button>
    </div>
  {/if}
</div>
