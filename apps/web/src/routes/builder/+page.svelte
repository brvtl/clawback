<script lang="ts">
  import { onMount } from "svelte";
  import { api, type ApiSkill, type ApiMcpServer, type ApiWorkflow } from "$lib/api/client";

  interface Message {
    role: "user" | "assistant";
    content: string;
  }

  let messages: Message[] = [];
  let input = "";
  let loading = false;
  let skills: ApiSkill[] = [];
  let workflows: ApiWorkflow[] = [];
  let mcpServers: ApiMcpServer[] = [];

  onMount(async () => {
    await loadContext();
    // Add welcome message
    messages = [
      {
        role: "assistant",
        content: `Welcome to the Automation Builder! I can help you:

- **Create skills** - Single-purpose automations with MCP tools
- **Create workflows** - AI-orchestrated multi-skill automations
- **Configure MCP servers** - Set up GitHub, Slack, or other integrations
- **Update existing automations** - Modify triggers, instructions, or permissions

What would you like to build today?`,
      },
    ];
  });

  async function loadContext() {
    try {
      const [skillsRes, workflowsRes, serversRes] = await Promise.all([
        api.getSkills(),
        api.getWorkflows(),
        api.getMcpServers(),
      ]);
      skills = skillsRes.skills;
      workflows = workflowsRes.workflows;
      mcpServers = serversRes.servers;
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    input = "";
    messages = [...messages, { role: "user", content: userMessage }];
    loading = true;

    try {
      // Build context about current state
      const context = buildContext();

      // Call the builder API
      const response = await fetch(
        `${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/api/builder/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage,
            context,
            history: messages.slice(-10), // Last 10 messages for context
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = (await response.json()) as { response: string; actions?: Action[] };

      // Build response with action summary
      let responseText = data.response;
      if (data.actions && data.actions.length > 0) {
        responseText += "\n\n---\n*Actions executed:*\n";
        for (const action of data.actions) {
          const name = action.data.name as string | undefined;
          responseText += `- ${formatActionType(action.type)}${name ? `: ${name}` : ""}\n`;
        }
      }

      messages = [...messages, { role: "assistant", content: responseText }];

      // Reload context after actions
      await loadContext();
    } catch (e) {
      messages = [
        ...messages,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${e instanceof Error ? e.message : "Unknown error"}`,
        },
      ];
    } finally {
      loading = false;
    }
  }

  interface Action {
    type:
      | "create_skill"
      | "update_skill"
      | "create_mcp_server"
      | "update_mcp_server"
      | "create_workflow"
      | "update_workflow"
      | "trigger_workflow";
    data: Record<string, unknown>;
  }

  function formatActionType(type: Action["type"]): string {
    switch (type) {
      case "create_skill":
        return "Created skill";
      case "update_skill":
        return "Updated skill";
      case "create_mcp_server":
        return "Created MCP server";
      case "update_mcp_server":
        return "Updated MCP server";
      case "create_workflow":
        return "Created workflow";
      case "update_workflow":
        return "Updated workflow";
      case "trigger_workflow":
        return "Triggered workflow";
    }
  }

  function buildContext(): string {
    const lines: string[] = [];

    lines.push("## Current Skills");
    if (skills.length === 0) {
      lines.push("No skills configured yet.");
    } else {
      for (const skill of skills) {
        lines.push(`- **${skill.name}** (${skill.id})`);
        lines.push(
          `  Triggers: ${skill.triggers.map((t) => `${t.source}:${t.events?.join(",") ?? "*"}`).join(", ")}`
        );
        if (skill.mcpServers) {
          const servers = Array.isArray(skill.mcpServers)
            ? skill.mcpServers.join(", ")
            : Object.keys(skill.mcpServers).join(", ");
          lines.push(`  MCP Servers: ${servers || "none"}`);
        }
      }
    }

    lines.push("");
    lines.push("## Current Workflows");
    if (workflows.length === 0) {
      lines.push("No workflows configured yet.");
    } else {
      for (const workflow of workflows) {
        const status = workflow.enabled ? "enabled" : "disabled";
        lines.push(`- **${workflow.name}** (${workflow.id}) [${status}]`);
        lines.push(
          `  Triggers: ${workflow.triggers.map((t) => `${t.source}:${t.events?.join(",") ?? "*"}`).join(", ")}`
        );
        lines.push(`  Skills: ${workflow.skills.length} | Model: ${workflow.orchestratorModel}`);
      }
    }

    lines.push("");
    lines.push("## Available MCP Servers");
    if (mcpServers.length === 0) {
      lines.push("No MCP servers configured. User needs to add credentials in Settings.");
    } else {
      for (const server of mcpServers) {
        const status = server.enabled ? "enabled" : "disabled";
        lines.push(`- **${server.name}** (${status}): ${server.command} ${server.args.join(" ")}`);
      }
    }

    return lines.join("\n");
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }
</script>

<svelte:head>
  <title>Automation Builder | Clawback</title>
</svelte:head>

<div class="flex flex-col h-[calc(100vh-2rem)] p-4">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold">Automation Builder</h1>
    <div class="text-sm text-gray-400">
      {skills.length} skills | {workflows.length} workflows | {mcpServers.length} MCP servers
    </div>
  </div>

  <!-- Chat messages -->
  <div class="flex-1 overflow-y-auto space-y-4 mb-4 bg-gray-900 rounded-lg p-4">
    {#each messages as message}
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

    {#if loading}
      <div class="flex justify-start">
        <div class="bg-gray-800 rounded-lg p-4 text-gray-400">
          <span class="animate-pulse">Thinking...</span>
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
      class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-white resize-none focus:outline-none focus:border-blue-500"
    ></textarea>
    <button
      on:click={sendMessage}
      disabled={loading || !input.trim()}
      class="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg transition-colors"
    >
      Send
    </button>
  </div>
</div>
