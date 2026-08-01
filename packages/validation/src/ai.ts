import { z } from 'zod';

// AI Assistant API (apps/admin/app/api/v1/ai/** -- API_SPEC.md §9, TASKS.md M18).

export const aiConversationCreateSchema = z.object({
  orgId: z.string().uuid('orgId must be a valid UUID'),
});
export type AiConversationCreateInput = z.infer<typeof aiConversationCreateSchema>;

export const aiMessageCreateSchema = z.object({
  text: z.string().min(1, 'Message text is required').max(4000),
});
export type AiMessageCreateInput = z.infer<typeof aiMessageCreateSchema>;
