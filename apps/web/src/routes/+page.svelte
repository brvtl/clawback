<script lang="ts">
  import { onMount } from "svelte";
  import StatusBadge from "$lib/components/StatusBadge.svelte";
  import { api, type ApiStatus, type ApiEvent, type ApiRun } from "$lib/api/client";

  let status: ApiStatus | null = null;
  let recentEvents: ApiEvent[] = [];
  let recentRuns: ApiRun[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    try {
      const [statusRes, eventsRes, runsRes] = await Promise.all([
        api.getStatus(),
        api.getEvents({ limit: 5 }),
        api.getRuns({ limit: 5 }),
      ]);

      status = statusRes;
      recentEvents = eventsRes.events;
      recentRuns = runsRes.runs;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load dashboard";
    } finally {
      loading = false;
    }
  });

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }
</script>

<svelte:head>
  <title>Dashboard | Clawback</title>
</svelte:head>

<div class="p-8">
  <h1 class="text-3xl font-bold mb-8">Dashboard</h1>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else}
    <!-- Status Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div class="text-gray-400 text-sm mb-1">Status</div>
        <div class="text-2xl font-bold text-green-400">{status?.status ?? "unknown"}</div>
      </div>

      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div class="text-gray-400 text-sm mb-1">Version</div>
        <div class="text-2xl font-bold">{status?.version ?? "0.0.0"}</div>
      </div>

      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div class="text-gray-400 text-sm mb-1">Skills Loaded</div>
        <div class="text-2xl font-bold">{status?.skills ?? 0}</div>
      </div>

      <div class="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div class="text-gray-400 text-sm mb-1">Uptime</div>
        <div class="text-2xl font-bold">
          {status?.uptime ? Math.floor(status.uptime / 60) : 0}m
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <!-- Recent Events -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 class="text-lg font-semibold">Recent Events</h2>
          <a href="/events" class="text-sm text-blue-400 hover:text-blue-300">View all</a>
        </div>

        {#if recentEvents.length === 0}
          <div class="p-4 text-gray-400 text-center">No events yet</div>
        {:else}
          <ul class="divide-y divide-gray-700">
            {#each recentEvents as event}
              <li class="p-4 hover:bg-gray-700/50 transition-colors">
                <a href="/events/{event.id}" class="block">
                  <div class="flex justify-between items-start mb-1">
                    <span class="font-medium">{event.type}</span>
                    <StatusBadge status={event.status} size="sm" />
                  </div>
                  <div class="text-sm text-gray-400">
                    {event.source} • {formatDate(event.createdAt)}
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <!-- Recent Runs -->
      <div class="bg-gray-800 rounded-lg border border-gray-700">
        <div class="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 class="text-lg font-semibold">Recent Runs</h2>
          <a href="/runs" class="text-sm text-blue-400 hover:text-blue-300">View all</a>
        </div>

        {#if recentRuns.length === 0}
          <div class="p-4 text-gray-400 text-center">No runs yet</div>
        {:else}
          <ul class="divide-y divide-gray-700">
            {#each recentRuns as run}
              <li class="p-4 hover:bg-gray-700/50 transition-colors">
                <a href="/runs/{run.id}" class="block">
                  <div class="flex justify-between items-start mb-1">
                    <span class="font-medium">{run.skillId}</span>
                    <StatusBadge status={run.status} size="sm" />
                  </div>
                  <div class="text-sm text-gray-400">
                    {formatDate(run.createdAt)}
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}
</div>
