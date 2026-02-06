import { eq } from "drizzle-orm";
import { skills, type DbSkill } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import type {
  Skill,
  Trigger,
  McpServerConfig,
  ToolPermissions,
  NotificationSettings,
  ReviewStatus,
  ReviewResult,
} from "@clawback/shared";
import { generateSkillId } from "@clawback/shared";

// MCP servers can be array of strings (global refs) or record of configs
export type McpServersInput = string[] | Record<string, McpServerConfig>;

export interface CreateSkillInput {
  name: string;
  description?: string;
  instructions: string;
  triggers: Trigger[];
  mcpServers?: McpServersInput;
  toolPermissions?: ToolPermissions;
  notifications?: NotificationSettings;
  knowledge?: string[];
  source?: "file" | "api" | "remote";
  filePath?: string;
  // Remote skill fields
  sourceUrl?: string;
  isRemote?: boolean;
  contentHash?: string;
  reviewStatus?: ReviewStatus;
  reviewResult?: ReviewResult;
}

export interface UpdateSkillInput {
  name?: string | undefined;
  description?: string | undefined;
  instructions?: string | undefined;
  triggers?: Trigger[] | undefined;
  mcpServers?: McpServersInput | undefined;
  toolPermissions?: ToolPermissions | undefined;
  notifications?: NotificationSettings | undefined;
  knowledge?: string[] | undefined;
  enabled?: boolean | undefined;
  // Remote skill fields
  contentHash?: string | undefined;
  reviewStatus?: ReviewStatus | undefined;
  reviewResult?: ReviewResult | undefined;
}

export class SkillRepository {
  constructor(private db: DatabaseConnection) {}

  /**
   * Convert database skill to domain Skill type
   */
  private toDomain(dbSkill: DbSkill): Skill {
    return {
      id: dbSkill.id,
      name: dbSkill.name,
      description: dbSkill.description ?? undefined,
      instructions: dbSkill.instructions,
      triggers: JSON.parse(dbSkill.triggers) as Trigger[],
      mcpServers: JSON.parse(dbSkill.mcpServers) as Record<string, McpServerConfig>,
      toolPermissions: JSON.parse(dbSkill.toolPermissions) as ToolPermissions,
      notifications: JSON.parse(dbSkill.notifications) as NotificationSettings,
      knowledge: dbSkill.knowledge ? (JSON.parse(dbSkill.knowledge) as string[]) : undefined,
      // Remote skill fields
      sourceUrl: dbSkill.sourceUrl ?? undefined,
      isRemote: dbSkill.isRemote ?? false,
      contentHash: dbSkill.contentHash ?? undefined,
      lastFetchedAt: dbSkill.lastFetchedAt ?? undefined,
      reviewStatus: dbSkill.reviewStatus as ReviewStatus | undefined,
      reviewResult: dbSkill.reviewResult
        ? (JSON.parse(dbSkill.reviewResult) as ReviewResult)
        : undefined,
    };
  }

  create(input: CreateSkillInput): Skill {
    const id = generateSkillId();
    const now = Date.now();

    const dbSkill: typeof skills.$inferInsert = {
      id,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      triggers: JSON.stringify(input.triggers),
      mcpServers: JSON.stringify(input.mcpServers ?? {}),
      toolPermissions: JSON.stringify(input.toolPermissions ?? { allow: ["*"], deny: [] }),
      notifications: JSON.stringify(input.notifications ?? { onComplete: false, onError: true }),
      knowledge: input.knowledge ? JSON.stringify(input.knowledge) : null,
      enabled: true,
      source: input.source ?? "api",
      filePath: input.filePath,
      // Remote skill fields
      sourceUrl: input.sourceUrl,
      isRemote: input.isRemote ?? false,
      contentHash: input.contentHash,
      reviewStatus: input.reviewStatus,
      reviewResult: input.reviewResult ? JSON.stringify(input.reviewResult) : null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(skills).values(dbSkill).run();

    return this.toDomain({ ...dbSkill, enabled: true } as DbSkill);
  }

  findById(id: string): Skill | undefined {
    const result = this.db.select().from(skills).where(eq(skills.id, id)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findByFilePath(filePath: string): Skill | undefined {
    const result = this.db.select().from(skills).where(eq(skills.filePath, filePath)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findAll(enabledOnly = true): Skill[] {
    let query = this.db.select().from(skills);
    if (enabledOnly) {
      query = query.where(eq(skills.enabled, true)) as typeof query;
    }
    const results = query.all();
    return results.map((r) => this.toDomain(r));
  }

  update(id: string, input: UpdateSkillInput): Skill | undefined {
    const existing = this.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!existing) {
      return undefined;
    }

    const updates: Partial<typeof skills.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.instructions !== undefined) updates.instructions = input.instructions;
    if (input.triggers !== undefined) updates.triggers = JSON.stringify(input.triggers);
    if (input.mcpServers !== undefined) updates.mcpServers = JSON.stringify(input.mcpServers);
    if (input.toolPermissions !== undefined)
      updates.toolPermissions = JSON.stringify(input.toolPermissions);
    if (input.notifications !== undefined)
      updates.notifications = JSON.stringify(input.notifications);
    if (input.knowledge !== undefined) updates.knowledge = JSON.stringify(input.knowledge);
    if (input.enabled !== undefined) updates.enabled = input.enabled;
    // Remote skill fields
    if (input.contentHash !== undefined) updates.contentHash = input.contentHash;
    if (input.reviewStatus !== undefined) updates.reviewStatus = input.reviewStatus;
    if (input.reviewResult !== undefined) updates.reviewResult = JSON.stringify(input.reviewResult);

    this.db.update(skills).set(updates).where(eq(skills.id, id)).run();

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.delete(skills).where(eq(skills.id, id)).run();
    return result.changes > 0;
  }

  upsertFromFile(filePath: string, input: CreateSkillInput): Skill {
    const existing = this.findByFilePath(filePath);

    if (existing) {
      const updated = this.update(existing.id, {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        triggers: input.triggers,
        mcpServers: input.mcpServers,
        toolPermissions: input.toolPermissions,
        notifications: input.notifications,
        knowledge: input.knowledge,
      });
      return updated!;
    }

    return this.create({
      ...input,
      source: "file",
      filePath,
    });
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db
      .update(skills)
      .set({ enabled, updatedAt: Date.now() })
      .where(eq(skills.id, id))
      .run();
    return result.changes > 0;
  }

  findBySourceUrl(sourceUrl: string): Skill | undefined {
    const result = this.db.select().from(skills).where(eq(skills.sourceUrl, sourceUrl)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findRemoteSkills(): Skill[] {
    const results = this.db.select().from(skills).where(eq(skills.isRemote, true)).all();
    return results.map((r) => this.toDomain(r));
  }

  updateReviewStatus(id: string, status: ReviewStatus, result?: ReviewResult): Skill | undefined {
    const existing = this.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!existing) {
      return undefined;
    }

    this.db
      .update(skills)
      .set({
        reviewStatus: status,
        reviewResult: result ? JSON.stringify(result) : null,
        updatedAt: Date.now(),
      })
      .where(eq(skills.id, id))
      .run();

    return this.findById(id);
  }

  updateContentHash(
    id: string,
    contentHash: string,
    lastFetchedAt: number = Date.now()
  ): Skill | undefined {
    const existing = this.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!existing) {
      return undefined;
    }

    this.db
      .update(skills)
      .set({
        contentHash,
        lastFetchedAt,
        updatedAt: Date.now(),
      })
      .where(eq(skills.id, id))
      .run();

    return this.findById(id);
  }

  upsertFromUrl(
    sourceUrl: string,
    input: Omit<CreateSkillInput, "source" | "sourceUrl" | "isRemote">
  ): Skill {
    const existing = this.findBySourceUrl(sourceUrl);

    if (existing) {
      const updated = this.update(existing.id, {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        triggers: input.triggers,
        mcpServers: input.mcpServers,
        toolPermissions: input.toolPermissions,
        notifications: input.notifications,
        knowledge: input.knowledge,
      });
      return updated!;
    }

    return this.create({
      ...input,
      source: "remote",
      sourceUrl,
      isRemote: true,
    });
  }
}
