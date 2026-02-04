import { eq, desc } from "drizzle-orm";
import { generateNotificationId } from "@clawback/shared";
import { notifications, type Notification, type NewNotification } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";

export interface CreateNotificationInput {
  runId: string;
  skillId: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
}

export class NotificationRepository {
  constructor(private db: DatabaseConnection) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const now = Date.now();
    const notification: NewNotification = {
      id: generateNotificationId(),
      runId: input.runId,
      skillId: input.skillId,
      type: input.type,
      title: input.title,
      message: input.message,
      read: false,
      createdAt: now,
    };

    await this.db.insert(notifications).values(notification);
    return notification as Notification;
  }

  async findById(id: string): Promise<Notification | undefined> {
    const [result] = await this.db.select().from(notifications).where(eq(notifications.id, id));
    return result;
  }

  async findUnread(): Promise<Notification[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.read, false))
      .orderBy(desc(notifications.createdAt));
  }

  async markRead(id: string): Promise<void> {
    await this.db.update(notifications).set({ read: true }).where(eq(notifications.id, id));
  }

  async markAllRead(): Promise<void> {
    await this.db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  }

  async list(options: ListNotificationsOptions = {}): Promise<Notification[]> {
    const { limit = 50, offset = 0 } = options;

    return this.db
      .select()
      .from(notifications)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);
  }
}
