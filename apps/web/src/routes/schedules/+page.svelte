<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ApiScheduledJob } from "$lib/api/client";

  let jobs: ApiScheduledJob[] = [];
  let loading = true;
  let error: string | null = null;

  onMount(async () => {
    await loadJobs();
  });

  async function loadJobs() {
    loading = true;
    error = null;
    try {
      const response = await api.getScheduledJobs();
      jobs = response.jobs;
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load scheduled jobs";
    } finally {
      loading = false;
    }
  }

  async function toggleJob(job: ApiScheduledJob) {
    try {
      await api.toggleScheduledJob(job.id, !job.enabled);
      await loadJobs();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to toggle job";
    }
  }

  function formatDate(timestamp: number | null): string {
    if (!timestamp) return "Never";
    return new Date(timestamp).toLocaleString();
  }

  function formatCron(schedule: string): string {
    // Common cron patterns with human-readable descriptions
    const patterns: Record<string, string> = {
      "* * * * *": "Every minute",
      "*/5 * * * *": "Every 5 minutes",
      "*/15 * * * *": "Every 15 minutes",
      "*/30 * * * *": "Every 30 minutes",
      "0 * * * *": "Every hour",
      "0 */2 * * *": "Every 2 hours",
      "0 */6 * * *": "Every 6 hours",
      "0 */12 * * *": "Every 12 hours",
      "0 0 * * *": "Daily at midnight",
      "0 9 * * *": "Daily at 9 AM",
      "0 0 * * 0": "Weekly on Sunday",
      "0 0 * * 1": "Weekly on Monday",
      "0 0 1 * *": "Monthly on 1st",
    };
    return patterns[schedule] ?? schedule;
  }

  function getTargetLink(job: ApiScheduledJob): string {
    if (job.workflowId) {
      return `/workflows/${job.workflowId}`;
    }
    if (job.skillId) {
      return `/skills/${job.skillId}`;
    }
    return "#";
  }

  function getTargetName(job: ApiScheduledJob): string {
    return job.workflowName ?? job.skillName ?? "Unknown";
  }

  function getTargetType(job: ApiScheduledJob): string {
    if (job.workflowId) return "Workflow";
    if (job.skillId) return "Skill";
    return "Unknown";
  }
</script>

<svelte:head>
  <title>Schedules | Clawback</title>
</svelte:head>

<div class="p-8">
  <div class="flex items-center justify-between mb-8">
    <h1 class="text-3xl font-bold">Scheduled Jobs</h1>
    <button
      class="px-4 py-2 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
      on:click={loadJobs}
    >
      Refresh
    </button>
  </div>

  {#if loading}
    <div class="text-gray-400">Loading...</div>
  {:else if error}
    <div class="bg-red-500/20 border border-red-500/30 rounded-lg p-4 text-red-400">
      {error}
    </div>
  {:else if jobs.length === 0}
    <div class="bg-gray-800 rounded-lg border border-gray-700 p-8 text-center">
      <div class="text-gray-400 mb-2">No scheduled jobs</div>
      <p class="text-gray-500 text-sm">
        Create a skill or workflow with a cron trigger to schedule automated runs.
      </p>
    </div>
  {:else}
    <div class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
      <table class="w-full">
        <thead class="bg-gray-700/50">
          <tr>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Schedule</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Target</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Type</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Last Run</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Next Run</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
            <th class="px-4 py-3 text-left text-sm font-medium text-gray-300">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-700">
          {#each jobs as job}
            <tr class="hover:bg-gray-700/50 transition-colors">
              <td class="px-4 py-3">
                <div class="text-white font-mono text-sm">{job.schedule}</div>
                <div class="text-gray-500 text-xs">{formatCron(job.schedule)}</div>
              </td>
              <td class="px-4 py-3">
                <a href={getTargetLink(job)} class="text-blue-400 hover:text-blue-300">
                  {getTargetName(job)}
                </a>
              </td>
              <td class="px-4 py-3">
                <span
                  class="px-2 py-1 rounded text-xs font-medium
                    {job.workflowId
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-blue-500/20 text-blue-400'}"
                >
                  {getTargetType(job)}
                </span>
              </td>
              <td class="px-4 py-3 text-gray-400 text-sm">
                {formatDate(job.lastRunAt)}
              </td>
              <td class="px-4 py-3 text-gray-400 text-sm">
                {formatDate(job.nextRunAt)}
              </td>
              <td class="px-4 py-3">
                <span
                  class="px-2 py-1 rounded text-xs font-medium
                    {job.enabled
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-500/20 text-gray-400'}"
                >
                  {job.enabled ? "Enabled" : "Disabled"}
                </span>
              </td>
              <td class="px-4 py-3">
                <button
                  class="px-3 py-1 rounded text-xs font-medium transition-colors
                    {job.enabled
                    ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'}"
                  on:click={() => toggleJob(job)}
                >
                  {job.enabled ? "Disable" : "Enable"}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
