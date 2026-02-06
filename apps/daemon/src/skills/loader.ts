import matter from "gray-matter";
import type {
  Trigger,
  McpServerConfig,
  ToolPermissions,
  NotificationSettings,
} from "@clawback/shared";

export interface SkillMarkdownResult {
  name?: string;
  description?: string;
  triggers: Trigger[];
  mcpServers?: Record<string, McpServerConfig>;
  toolPermissions?: ToolPermissions;
  notifications?: NotificationSettings;
  instructions: string;
  knowledge?: string[];
}

export function parseSkillMarkdown(content: string): SkillMarkdownResult {
  const { data, content: body } = matter(content);

  const frontmatter = data as Record<string, unknown>;

  return {
    name: typeof frontmatter.name === "string" ? frontmatter.name : undefined,
    description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
    triggers: Array.isArray(frontmatter.triggers) ? (frontmatter.triggers as Trigger[]) : [],
    mcpServers: frontmatter.mcpServers as Record<string, McpServerConfig> | undefined,
    toolPermissions: frontmatter.toolPermissions as ToolPermissions | undefined,
    notifications: frontmatter.notifications as NotificationSettings | undefined,
    instructions: body.trim(),
    knowledge: Array.isArray(frontmatter.knowledge)
      ? (frontmatter.knowledge as string[])
      : undefined,
  };
}
