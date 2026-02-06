const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

export interface ApiStatus {
  status: string;
  version: string;
  skills: number;
  uptime: number;
}

export interface ApiEvent {
  id: string;
  source: string;
  type: string;
  payload: string;
  metadata: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface ApiRun {
  id: string;
  eventId: string;
  skillId: string;
  parentRunId: string | null;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  toolCalls: string;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ApiSkill {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  triggers: Array<{
    source: string;
    events?: string[];
    schedule?: string;
    filters?: { repository?: string; ref?: string[] };
  }>;
  mcpServers?:
    | string[]
    | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  toolPermissions?: { allow?: string[]; deny?: string[] };
  notifications?: { onComplete?: boolean; onError?: boolean };
  knowledge?: string[];
}

export interface ApiNotification {
  id: string;
  runId: string;
  skillId: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  read: boolean;
  createdAt: number;
}

export interface ApiMcpServer {
  id: string;
  name: string;
  description?: string;
  command: string;
  args: string[];
  env: Record<string, string>; // Values are masked in responses
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ApiWorkflow {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  triggers: Array<{
    source: string;
    events?: string[];
    schedule?: string;
    filters?: { repository?: string; ref?: string[] };
  }>;
  skills: string[];
  orchestratorModel: "opus" | "sonnet";
  enabled: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface ApiWorkflowRun {
  id: string;
  workflowId: string;
  eventId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  input: unknown;
  output?: unknown;
  error?: string;
  skillRuns: string[];
  startedAt?: number;
  completedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async getStatus(): Promise<ApiStatus> {
    return this.fetch<ApiStatus>("/api/status");
  }

  async getEvents(params?: { limit?: number; offset?: number }): Promise<{ events: ApiEvent[] }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const query = searchParams.toString();
    return this.fetch<{ events: ApiEvent[] }>(`/api/events${query ? `?${query}` : ""}`);
  }

  async getEvent(id: string): Promise<{ event: ApiEvent; runs: ApiRun[] }> {
    return this.fetch<{ event: ApiEvent; runs: ApiRun[] }>(`/api/events/${id}`);
  }

  async getSkills(): Promise<{ skills: ApiSkill[] }> {
    return this.fetch<{ skills: ApiSkill[] }>("/api/skills");
  }

  async getSkill(id: string): Promise<{ skill: ApiSkill }> {
    return this.fetch<{ skill: ApiSkill }>(`/api/skills/${id}`);
  }

  async updateSkill(
    id: string,
    updates: Partial<Omit<ApiSkill, "id">>
  ): Promise<{ skill: ApiSkill }> {
    return this.fetch<{ skill: ApiSkill }>(`/api/skills/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async createSkill(input: {
    name: string;
    description?: string;
    instructions: string;
    triggers: Array<{
      source: string;
      events?: string[];
      schedule?: string;
      filters?: { repository?: string; ref?: string[] };
    }>;
    mcpServers?:
      | string[]
      | Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
    toolPermissions?: { allow?: string[]; deny?: string[] };
    notifications?: { onComplete?: boolean; onError?: boolean };
    knowledge?: string[];
  }): Promise<{ skill: ApiSkill }> {
    return this.fetch<{ skill: ApiSkill }>("/api/skills", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async deleteSkill(id: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/skills/${id}`, {
      method: "DELETE",
    });
  }

  async getRuns(params?: {
    limit?: number;
    offset?: number;
    skillId?: string;
  }): Promise<{ runs: ApiRun[] }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));
    if (params?.skillId) searchParams.set("skillId", params.skillId);

    const query = searchParams.toString();
    return this.fetch<{ runs: ApiRun[] }>(`/api/runs${query ? `?${query}` : ""}`);
  }

  async getRun(id: string): Promise<{ run: ApiRun }> {
    return this.fetch<{ run: ApiRun }>(`/api/runs/${id}`);
  }

  async getNotifications(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{ notifications: ApiNotification[]; unreadCount: number }> {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set("limit", String(params.limit));
    if (params?.offset) searchParams.set("offset", String(params.offset));

    const query = searchParams.toString();
    return this.fetch<{ notifications: ApiNotification[]; unreadCount: number }>(
      `/api/notifications${query ? `?${query}` : ""}`
    );
  }

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/notifications/${id}/read`, {
      method: "POST",
    });
  }

  async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>("/api/notifications/read-all", {
      method: "POST",
    });
  }

  async injectEvent(payload: Record<string, unknown>): Promise<{ eventId: string }> {
    return this.fetch<{ eventId: string }>("/webhook/test", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // MCP Server methods
  async getMcpServers(): Promise<{ servers: ApiMcpServer[] }> {
    return this.fetch<{ servers: ApiMcpServer[] }>("/api/mcp-servers");
  }

  async getMcpServer(id: string): Promise<{ server: ApiMcpServer }> {
    return this.fetch<{ server: ApiMcpServer }>(`/api/mcp-servers/${id}`);
  }

  async createMcpServer(input: {
    name: string;
    description?: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }): Promise<{ server: ApiMcpServer }> {
    return this.fetch<{ server: ApiMcpServer }>("/api/mcp-servers", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateMcpServer(
    id: string,
    updates: {
      name?: string;
      description?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      enabled?: boolean;
    }
  ): Promise<{ server: ApiMcpServer }> {
    return this.fetch<{ server: ApiMcpServer }>(`/api/mcp-servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deleteMcpServer(id: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/mcp-servers/${id}`, {
      method: "DELETE",
    });
  }

  // Workflow methods
  async getWorkflows(): Promise<{ workflows: ApiWorkflow[] }> {
    return this.fetch<{ workflows: ApiWorkflow[] }>("/api/workflows");
  }

  async getWorkflow(id: string): Promise<{ workflow: ApiWorkflow; skills: ApiSkill[] }> {
    return this.fetch<{ workflow: ApiWorkflow; skills: ApiSkill[] }>(`/api/workflows/${id}`);
  }

  async createWorkflow(input: {
    name: string;
    description?: string;
    instructions: string;
    triggers: Array<{
      source: string;
      events?: string[];
      schedule?: string;
      filters?: { repository?: string; ref?: string[] };
    }>;
    skills: string[];
    orchestratorModel?: "opus" | "sonnet";
  }): Promise<{ workflow: ApiWorkflow }> {
    return this.fetch<{ workflow: ApiWorkflow }>("/api/workflows", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async updateWorkflow(
    id: string,
    updates: Partial<Omit<ApiWorkflow, "id">>
  ): Promise<{ workflow: ApiWorkflow }> {
    return this.fetch<{ workflow: ApiWorkflow }>(`/api/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  }

  async deleteWorkflow(id: string): Promise<{ success: boolean }> {
    return this.fetch<{ success: boolean }>(`/api/workflows/${id}`, {
      method: "DELETE",
    });
  }

  async getWorkflowRuns(workflowId: string): Promise<{ runs: ApiWorkflowRun[] }> {
    return this.fetch<{ runs: ApiWorkflowRun[] }>(`/api/workflows/${workflowId}/runs`);
  }

  async getWorkflowRun(
    workflowId: string,
    runId: string
  ): Promise<{ run: ApiWorkflowRun; skillRuns: ApiRun[] }> {
    return this.fetch<{ run: ApiWorkflowRun; skillRuns: ApiRun[] }>(
      `/api/workflows/${workflowId}/runs/${runId}`
    );
  }

  async triggerWorkflow(
    id: string,
    payload?: Record<string, unknown>
  ): Promise<{ workflowRun: ApiWorkflowRun; event: ApiEvent }> {
    return this.fetch<{ workflowRun: ApiWorkflowRun; event: ApiEvent }>(
      `/api/workflows/${id}/trigger`,
      {
        method: "POST",
        body: JSON.stringify({ payload }),
      }
    );
  }
}

export const api = new ApiClient();
