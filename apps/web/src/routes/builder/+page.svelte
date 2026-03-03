<script lang="ts">
  import { onMount, tick } from "svelte";
  import { builderStore } from "$lib/stores/builder";

  let input = "";
  let chatContainer: HTMLDivElement;

  onMount(async () => {
    // Restore existing session from localStorage
    const storedId = builderStore.getStoredSessionId();
    if (storedId) {
      await builderStore.loadSession(storedId);
    }
  });

  async function sendMessage() {
    const message = input.trim();
    if (!message || $builderStore.loading) return;

    input = "";
    await builderStore.sendMessage(message);
    await scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  function startNewChat() {
    builderStore.newSession();
  }

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // Auto-scroll when messages or loading state changes
  $: if ($builderStore.messages.length || $builderStore.loading || $builderStore.currentToolCall) {
    void scrollToBottom();
  }
</script>

<svelte:head>
  <title>Automation Builder | Clawback</title>
</svelte:head>

<div class="flex flex-col h-[calc(100vh-2rem)] p-4">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold">Automation Builder</h1>
    <div class="flex items-center gap-3">
      {#if $builderStore.sessionId}
        <span class="text-xs text-gray-500 font-mono">{$builderStore.sessionId}</span>
      {/if}
      <button
        on:click={startNewChat}
        class="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
      >
        New Chat
      </button>
    </div>
  </div>

  <!-- Chat messages -->
  <div
    bind:this={chatContainer}
    class="flex-1 overflow-y-auto space-y-4 mb-4 bg-gray-900 rounded-lg p-4"
  >
    {#if $builderStore.messages.length === 0 && !$builderStore.loading}
      <div class="flex justify-start">
        <div class="max-w-[80%] rounded-lg p-4 bg-gray-800 text-gray-100">
          <div class="prose prose-invert prose-sm max-w-none">
            <p>Welcome to the Automation Builder! I can help you:</p>
            <ul>
              <li><strong>Create skills</strong> - Single-purpose automations with MCP tools</li>
              <li>
                <strong>Create workflows</strong> - AI-orchestrated multi-skill automations
              </li>
              <li>
                <strong>Configure MCP servers</strong> - Set up GitHub, Slack, or other integrations
              </li>
              <li>
                <strong>Update existing automations</strong> - Modify triggers, instructions, or permissions
              </li>
            </ul>
            <p>What would you like to build today?</p>
          </div>
        </div>
      </div>
    {/if}

    {#each $builderStore.messages as message}
      <div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div
          class="max-w-[80%] rounded-lg p-4 {message.role === 'user'
            ? 'bg-blue-600 text-white'
            : 'bg-gray-800 text-gray-100'}"
        >
          {#if message.role === "assistant"}
            <div class="prose prose-invert prose-sm max-w-none">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html message.content
                .replace(/\n/g, "<br>")
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/`(.+?)`/g, "<code class='bg-gray-700 px-1 rounded'>$1</code>")}
            </div>
          {:else}
            <p class="whitespace-pre-wrap">{message.content}</p>
          {/if}
        </div>
      </div>
    {/each}

    {#if $builderStore.currentToolCall}
      <div class="flex justify-start">
        <div class="bg-gray-800 rounded-lg p-3 text-gray-400 text-sm flex items-center gap-2">
          <span
            class="animate-spin inline-block w-4 h-4 border-2 border-gray-500 border-t-blue-400 rounded-full"
          ></span>
          Calling
          <code class="bg-gray-700 px-1 rounded text-blue-300">{$builderStore.currentToolCall}</code
          >...
        </div>
      </div>
    {:else if $builderStore.loading}
      <div class="flex justify-start">
        <div class="bg-gray-800 rounded-lg p-4 text-gray-400">
          <span class="animate-pulse">Thinking...</span>
        </div>
      </div>
    {/if}

    {#if $builderStore.error}
      <div class="flex justify-start">
        <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          Error: {$builderStore.error}
        </div>
      </div>
    {/if}
  </div>

  <!-- Input area -->
  <div class="flex gap-2">
    <textarea
      bind:value={input}
      on:keydown={handleKeydown}
      placeholder="Describe what you want to build..."
      rows="2"
      disabled={$builderStore.loading}
      class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
    ></textarea>
    <button
      on:click={sendMessage}
      disabled={$builderStore.loading || !input.trim()}
      class="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
    >
      Send
    </button>
  </div>
</div>
