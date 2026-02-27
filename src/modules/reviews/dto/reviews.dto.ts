import { z } from 'zod';

export const CreateReviewSchema = z.object({
  // Client can provide a known place ID OR supply place details for dedup
  placeId: z.string().uuid().optional(),

  // Place details (used when placeId is not provided)
  placeName: z.string().min(2).max(255).optional(),
  city: z.string().min(2).max(100).optional(),
  category: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  address: z.string().max(500).optional(),

  // z.coerce.number() handles both JSON (number) and multipart/form-data (string)
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().min(10, 'Review must be at least 10 characters').max(5000),
  // Media is now attached as files via multipart/form-data — no mediaUrls field needed
}).refine(
  (data) => data.placeId || (data.placeName && data.city),
  { message: 'Either placeId or (placeName + city) must be provided' },
);

export const ReviewsQuerySchema = z.object({
  placeId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED']).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type CreateReviewDto = z.infer<typeof CreateReviewSchema>;
export type ReviewsQueryDto = z.infer<typeof ReviewsQuerySchema>;
