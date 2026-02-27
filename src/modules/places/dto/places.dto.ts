import { z } from 'zod';

export const CreatePlaceSchema = z.object({
  name: z.string().min(2).max(255),
  city: z.string().min(2).max(100),
  state: z.string().max(100).optional(),
  country: z.string().default('IN'),
  category: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const PlacesQuerySchema = z.object({
  city: z.string().optional(),
  category: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

export type CreatePlaceDto = z.infer<typeof CreatePlaceSchema>;
export type PlacesQueryDto = z.infer<typeof PlacesQuerySchema>;
