<script lang="ts">
  export let status: string;
  export let size: "sm" | "md" = "md";

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    processing: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    running: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    completed: "bg-green-500/20 text-green-400 border-green-500/30",
    success: "bg-green-500/20 text-green-400 border-green-500/30",
    failed: "bg-red-500/20 text-red-400 border-red-500/30",
    error: "bg-red-500/20 text-red-400 border-red-500/30",
    cancelled: "bg-gray-500/20 text-gray-400 border-gray-500/30",
    waiting_for_input: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    warning: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  };

  $: colorClass = statusColors[status] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30";
  $: sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm";
</script>

<span class="inline-flex items-center rounded-full border font-medium {colorClass} {sizeClass}">
  {status}
</span>
