import Anthropic from "@anthropic-ai/sdk";
import type { ReviewResult, ToolPermissions } from "@clawback/shared";

export interface ReviewInput {
  instructions: string;
  knowledgeContent?: string;
  toolPermissions?: ToolPermissions;
  mcpServers?: string[];
}

export interface SkillReviewerOptions {
  anthropicApiKey?: string;
}

const REVIEW_SYSTEM_PROMPT = `You are a security reviewer for automation skills. Your job is to analyze skill definitions and identify potential security concerns.

Analyze the skill for these specific risks:
1. **Data Exfiltration**: Does it send data to external services, log sensitive info, or copy data to unexpected locations?
2. **Malicious Code Execution**: Does it run arbitrary code, install packages, or modify system files?
3. **Privilege Escalation**: Does it request more permissions than needed, try to bypass restrictions, or access protected resources?
4. **Social Engineering**: Does it impersonate users, send deceptive messages, or manipulate other systems?
5. **Resource Abuse**: Does it consume excessive resources, create infinite loops, or spam external services?

Respond with a JSON object (no markdown formatting):
{
  "approved": boolean,
  "concerns": ["list of specific concerns if any"],
  "riskLevel": "low" | "medium" | "high",
  "summary": "brief explanation of your assessment"
}

Be conservative - if something seems suspicious, flag it. Remote skills run with restricted permissions by default, so focus on risks that could occur even with read-only access.`;

export class SkillReviewer {
  private anthropic: Anthropic | null = null;
  private reviewCache = new Map<string, ReviewResult>();

  constructor(options: SkillReviewerOptions = {}) {
    if (options.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: options.anthropicApiKey });
    }
  }

  async review(contentHash: string, input: ReviewInput): Promise<ReviewResult> {
    // Check cache first
    const cached = this.reviewCache.get(contentHash);
    if (cached) {
      console.log(`[SkillReviewer] Using cached review for hash ${contentHash.slice(0, 8)}...`);
      return cached;
    }

    if (!this.anthropic) {
      // No API key - return pending review that requires manual approval
      console.warn("[SkillReviewer] No Anthropic API key, returning pending review");
      return {
        approved: false,
        concerns: ["No AI review available - manual approval required"],
        riskLevel: "medium",
        summary: "Automatic review unavailable. Please review manually before enabling.",
      };
    }

    console.log(`[SkillReviewer] Reviewing skill with hash ${contentHash.slice(0, 8)}...`);

    const result = await this.performReview(input);

    // Cache the result
    this.reviewCache.set(contentHash, result);

    return result;
  }

  private async performReview(input: ReviewInput): Promise<ReviewResult> {
    const userPrompt = this.buildReviewPrompt(input);

    try {
      const response = await this.anthropic!.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: REVIEW_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text response from reviewer");
      }

      return this.parseReviewResponse(textContent.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("[SkillReviewer] Review failed:", message);

      return {
        approved: false,
        concerns: [`Review failed: ${message}`],
        riskLevel: "high",
        summary: "Automatic review failed. Please review manually.",
      };
    }
  }

  private buildReviewPrompt(input: ReviewInput): string {
    let prompt = `Please review this automation skill:\n\n`;
    prompt += `## Instructions\n\n${input.instructions}\n\n`;

    if (input.knowledgeContent) {
      prompt += `## Knowledge Files\n\n${input.knowledgeContent}\n\n`;
    }

    if (input.toolPermissions) {
      prompt += `## Tool Permissions\n\n`;
      prompt += `Allowed: ${JSON.stringify(input.toolPermissions.allow)}\n`;
      prompt += `Denied: ${JSON.stringify(input.toolPermissions.deny)}\n\n`;
    }

    if (input.mcpServers && input.mcpServers.length > 0) {
      prompt += `## MCP Servers\n\n${input.mcpServers.join(", ")}\n\n`;
    }

    return prompt;
  }

  parseReviewResponse(text: string): ReviewResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        approved?: boolean;
        concerns?: string[];
        riskLevel?: string;
        summary?: string;
      };

      return {
        approved: parsed.approved === true,
        concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
        riskLevel: this.normalizeRiskLevel(parsed.riskLevel),
        summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
        reviewedAt: Date.now(),
      };
    } catch (error) {
      console.error("[SkillReviewer] Failed to parse review response:", text);
      return {
        approved: false,
        concerns: ["Failed to parse review response"],
        riskLevel: "high",
        summary: "Review parsing failed. Please review manually.",
      };
    }
  }

  private normalizeRiskLevel(level: string | undefined): "low" | "medium" | "high" {
    if (level === "low" || level === "medium" || level === "high") {
      return level;
    }
    return "medium";
  }

  clearCache(): void {
    this.reviewCache.clear();
  }

  getCachedReview(contentHash: string): ReviewResult | undefined {
    return this.reviewCache.get(contentHash);
  }
}
