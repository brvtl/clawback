<script lang="ts">
  import { page } from "$app/stores";
  import { notifications } from "$lib/stores/notifications";
  import { onMount } from "svelte";

  let showNotifications = false;

  onMount(() => {
    notifications.load();
  });

  function toggleNotifications() {
    showNotifications = !showNotifications;
    if (showNotifications) {
      notifications.load();
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }

  const navItems = [
    { href: "/", label: "Dashboard", icon: "home" },
    { href: "/builder", label: "Builder", icon: "wand" },
    { href: "/skills", label: "Skills", icon: "cpu" },
    { href: "/workflows", label: "Workflows", icon: "workflow" },
    { href: "/events", label: "Events", icon: "inbox" },
    { href: "/runs", label: "Runs", icon: "play" },
    { href: "/settings", label: "Settings", icon: "settings" },
  ];

  function isActive(href: string): boolean {
    if (href === "/") {
      return $page.url.pathname === "/";
    }
    return $page.url.pathname.startsWith(href);
  }
</script>

<aside class="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
  <div class="p-4 border-b border-gray-700">
    <h1 class="text-xl font-bold text-white">Clawback</h1>
    <p class="text-xs text-gray-400 mt-1">Claude Automation Engine</p>
  </div>

  <nav class="flex-1 p-4">
    <ul class="space-y-2">
      {#each navItems as item}
        <li>
          <a
            href={item.href}
            class="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
              {isActive(item.href)
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:bg-gray-700 hover:text-white'}"
          >
            <span class="w-5 h-5"
              >{item.icon === "home"
                ? "🏠"
                : item.icon === "wand"
                  ? "✨"
                  : item.icon === "cpu"
                    ? "⚙️"
                    : item.icon === "workflow"
                      ? "🔀"
                      : item.icon === "inbox"
                        ? "📥"
                        : item.icon === "play"
                          ? "▶️"
                          : "⚙️"}</span
            >
            <span>{item.label}</span>
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="p-4 border-t border-gray-700 relative">
    <button
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      on:click={toggleNotifications}
    >
      <span class="relative">
        🔔
        {#if $notifications.unreadCount > 0}
          <span
            class="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center"
          >
            {$notifications.unreadCount}
          </span>
        {/if}
      </span>
      <span>Notifications</span>
    </button>

    {#if showNotifications}
      <div
        class="absolute bottom-full left-0 w-80 mb-2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-h-96 overflow-hidden"
      >
        <div class="p-3 border-b border-gray-700 flex items-center justify-between">
          <h3 class="font-semibold text-white">Notifications</h3>
          {#if $notifications.unreadCount > 0}
            <button
              class="text-xs text-blue-400 hover:text-blue-300"
              on:click={() => notifications.markAllRead()}
            >
              Mark all read
            </button>
          {/if}
        </div>

        <div class="overflow-y-auto max-h-72">
          {#if $notifications.loading}
            <div class="p-4 text-center text-gray-400">Loading...</div>
          {:else if $notifications.notifications.length === 0}
            <div class="p-4 text-center text-gray-400">No notifications</div>
          {:else}
            {#each $notifications.notifications as notif}
              <button
                class="w-full p-3 text-left border-b border-gray-700 hover:bg-gray-700 transition-colors
                  {notif.read ? 'opacity-60' : ''}"
                on:click={() => notifications.markRead(notif.id)}
              >
                <div class="flex items-start gap-2">
                  <span class="text-lg">
                    {notif.type === "success" ? "✅" : notif.type === "error" ? "❌" : "ℹ️"}
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-white truncate">{notif.title}</p>
                    <p class="text-xs text-gray-400 truncate">{notif.message}</p>
                    <p class="text-xs text-gray-500 mt-1">{formatTime(notif.createdAt)}</p>
                  </div>
                  {#if !notif.read}
                    <span class="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1"></span>
                  {/if}
                </div>
              </button>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Backdrop to close dropdown -->
      <button
        class="fixed inset-0 z-[-1]"
        on:click={() => (showNotifications = false)}
        aria-label="Close notifications"
      ></button>
    {/if}
  </div>
</aside>
