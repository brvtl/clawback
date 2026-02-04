import type { Event } from "@clawback/shared";
import type { EventRepository } from "@clawback/db";
import type { SkillRegistry } from "../skills/registry.js";

export interface EnqueueInput {
  source: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface QueuedEvent {
  id: string;
  source: string;
  type: string;
}

export class EventQueue {
  private processing = false;
  private onEventCallback?: (event: Event) => Promise<void>;

  constructor(
    private eventRepo: EventRepository,
    private skillRegistry: SkillRegistry
  ) {}

  async enqueue(input: EnqueueInput): Promise<QueuedEvent> {
    const event = await this.eventRepo.create(input);

    // Trigger async processing
    if (this.onEventCallback && !this.processing) {
      void this.processQueue();
    }

    return {
      id: event.id,
      source: event.source,
      type: event.type,
    };
  }

  onEvent(callback: (event: Event) => Promise<void>): void {
    this.onEventCallback = callback;
  }

  async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      const pendingEvents = await this.eventRepo.findPending();

      for (const event of pendingEvents) {
        if (!this.onEventCallback) {
          break;
        }

        try {
          await this.eventRepo.updateStatus(event.id, "processing");
          await this.onEventCallback(event);
          await this.eventRepo.updateStatus(event.id, "completed");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          console.error(`Failed to process event ${event.id}:`, message);
          await this.eventRepo.updateStatus(event.id, "failed");
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async processPending(): Promise<number> {
    const pending = await this.eventRepo.findPending();
    return pending.length;
  }
}
