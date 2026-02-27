/**
 * @file auth.dto.ts
 * @description Zod schemas for auth request validation.
 * Schemas double as TypeScript types via z.infer<>.
 */

import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  role: z.enum(['user', 'admin'], {
    errorMap: () => ({ message: 'Role must be either user or admin' }),
  }),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type RegisterDto = z.infer<typeof RegisterSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;
