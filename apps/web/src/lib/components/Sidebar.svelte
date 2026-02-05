<script lang="ts">
  import { page } from "$app/stores";
  import { notifications } from "$lib/stores/notifications";

  const navItems = [
    { href: "/", label: "Dashboard", icon: "home" },
    { href: "/builder", label: "Builder", icon: "wand" },
    { href: "/skills", label: "Skills", icon: "cpu" },
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

  <div class="p-4 border-t border-gray-700">
    <button
      class="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      on:click={() => notifications.load()}
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
  </div>
</aside>
