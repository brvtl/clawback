import { z } from "zod";

export const NotificationTypeSchema = z.enum(["success", "error", "info", "warning"]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NotificationSchema = z.object({
  id: z.string(),
  runId: z.string(),
  skillId: z.string(),
  type: NotificationTypeSchema,
  title: z.string(),
  message: z.string(),
  read: z.boolean().default(false),
  createdAt: z.date(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const CreateNotificationSchema = NotificationSchema.omit({
  id: true,
  read: true,
  createdAt: true,
});

export type CreateNotification = z.infer<typeof CreateNotificationSchema>;
