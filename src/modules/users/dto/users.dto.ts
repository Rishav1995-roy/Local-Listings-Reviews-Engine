import { z } from 'zod';

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
