<script lang="ts">
  import "../app.css";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import { onMount } from "svelte";
  import { notifications } from "$lib/stores/notifications";

  onMount(() => {
    notifications.load();
    notifications.connectWebSocket();

    return () => {
      notifications.disconnectWebSocket();
    };
  });
</script>

<div class="min-h-screen bg-gray-900 text-white flex">
  <Sidebar />

  <main class="flex-1 overflow-auto">
    <slot />
  </main>
</div>
