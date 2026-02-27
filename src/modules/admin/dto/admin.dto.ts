import { z } from 'zod';

export const ModerationNoteSchema = z.object({
  note: z.string().max(500).optional(),
});

export const MergePlaceSchema = z.object({
  canonicalPlaceId: z.string().uuid('canonicalPlaceId must be a valid UUID'),
});

export const AdminQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export type ModerationNoteDto = z.infer<typeof ModerationNoteSchema>;
export type MergePlaceDto = z.infer<typeof MergePlaceSchema>;
export type AdminQueryDto = z.infer<typeof AdminQuerySchema>;
