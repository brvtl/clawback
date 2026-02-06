import { createHash } from "crypto";
import { parseSkillMarkdown, type SkillMarkdownResult } from "../skills/loader.js";

export interface FetchedRemoteSkill {
  skillMarkdown: SkillMarkdownResult;
  knowledgeFiles: Map<string, string>;
  contentHash: string;
  rawContent: string;
}

export interface FetchOptions {
  timeoutMs?: number;
}

export class RemoteSkillFetcher {
  private defaultTimeoutMs = 30000;

  async fetch(sourceUrl: string, options: FetchOptions = {}): Promise<FetchedRemoteSkill> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;

    // Fetch the main skill.md
    const rawContent = await this.fetchUrl(sourceUrl, timeoutMs);
    const skillMarkdown = parseSkillMarkdown(rawContent);

    // Fetch knowledge files if specified
    const knowledgeFiles = new Map<string, string>();
    if (skillMarkdown.knowledge && skillMarkdown.knowledge.length > 0) {
      const baseUrl = this.getBaseUrl(sourceUrl);
      for (const path of skillMarkdown.knowledge) {
        try {
          const fullUrl = this.resolveRelativePath(baseUrl, path);
          const content = await this.fetchUrl(fullUrl, timeoutMs);
          knowledgeFiles.set(path, content);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.warn(`[RemoteSkillFetcher] Failed to fetch knowledge file ${path}: ${message}`);
        }
      }
    }

    // Calculate content hash including all content
    const contentHash = this.calculateHash(rawContent, knowledgeFiles);

    return {
      skillMarkdown,
      knowledgeFiles,
      contentHash,
      rawContent,
    };
  }

  private async fetchUrl(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/plain, text/markdown, */*",
          "User-Agent": "Clawback/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getBaseUrl(url: string): string {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/");
    pathParts.pop(); // Remove filename
    parsed.pathname = pathParts.join("/");
    return parsed.toString();
  }

  private resolveRelativePath(baseUrl: string, relativePath: string): string {
    // Handle ./ prefix
    const cleanPath = relativePath.startsWith("./") ? relativePath.slice(2) : relativePath;

    // Ensure base URL ends with /
    const base = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    return new URL(cleanPath, base).toString();
  }

  private calculateHash(mainContent: string, knowledgeFiles: Map<string, string>): string {
    const hash = createHash("sha256");

    // Add main content
    hash.update(mainContent);

    // Add knowledge files in sorted order for deterministic hash
    const sortedPaths = Array.from(knowledgeFiles.keys()).sort();
    for (const path of sortedPaths) {
      hash.update(`\n---${path}---\n`);
      hash.update(knowledgeFiles.get(path)!);
    }

    return hash.digest("hex");
  }

  validateUrl(url: string): { valid: boolean; error?: string } {
    try {
      const parsed = new URL(url);

      // Only allow HTTPS
      if (parsed.protocol !== "https:") {
        return { valid: false, error: "Only HTTPS URLs are allowed" };
      }

      // Block localhost and private IPs
      const hostname = parsed.hostname.toLowerCase();
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("10.") ||
        hostname.startsWith("172.16.") ||
        hostname.endsWith(".local")
      ) {
        return { valid: false, error: "Local and private network URLs are not allowed" };
      }

      return { valid: true };
    } catch {
      return { valid: false, error: "Invalid URL format" };
    }
  }
}
