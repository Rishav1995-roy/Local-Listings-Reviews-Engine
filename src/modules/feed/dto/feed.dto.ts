import { z } from 'zod';

export const FeedQuerySchema = z.object({
  city: z.string().min(1, 'city is required'),
  category: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type FeedQueryDto = z.infer<typeof FeedQuerySchema>;
