import matter from "gray-matter";
import YAML from "yaml";
import type {
  Skill,
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

export interface SkillConfigResult {
  name?: string;
  description?: string;
  triggers?: Trigger[];
  mcpServers?: Record<string, McpServerConfig>;
  toolPermissions?: ToolPermissions;
  notifications?: NotificationSettings;
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

export function parseSkillConfig(yamlContent: string): SkillConfigResult {
  const data = YAML.parse(yamlContent) as Record<string, unknown>;

  return {
    name: typeof data.name === "string" ? data.name : undefined,
    description: typeof data.description === "string" ? data.description : undefined,
    triggers: Array.isArray(data.triggers) ? (data.triggers as Trigger[]) : undefined,
    mcpServers: data.mcpServers as Record<string, McpServerConfig> | undefined,
    toolPermissions: data.toolPermissions as ToolPermissions | undefined,
    notifications: data.notifications as NotificationSettings | undefined,
    knowledge: Array.isArray(data.knowledge) ? (data.knowledge as string[]) : undefined,
  };
}

export function mergeSkillConfig(
  id: string,
  markdown: SkillMarkdownResult,
  config?: SkillConfigResult
): Skill {
  return {
    id,
    name: config?.name ?? markdown.name ?? id,
    description: config?.description ?? markdown.description,
    instructions: markdown.instructions,
    triggers: config?.triggers ?? markdown.triggers,
    mcpServers: config?.mcpServers ?? markdown.mcpServers ?? {},
    toolPermissions: config?.toolPermissions ??
      markdown.toolPermissions ?? { allow: ["*"], deny: [] },
    notifications: config?.notifications ??
      markdown.notifications ?? { onComplete: false, onError: true },
    knowledge: config?.knowledge ?? markdown.knowledge,
  };
}
