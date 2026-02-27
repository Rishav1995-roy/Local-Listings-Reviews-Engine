/**
 * @file env.ts
 * @description Centralised, type-safe environment variable loader.
 *
 * All env vars are validated at startup using zod so the app fails fast
 * with a clear error message rather than silently using undefined values
 * deep in runtime code.
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.coerce.number().default(2),
  DATABASE_POOL_MAX: z.coerce.number().default(10),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.preprocess(
    (v) => v === 'true' || v === '1' || v === true,
    z.boolean(),
  ).default(false),

  // AWS
  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET: z.string().default('local-listings-media'),

  // BullMQ
  BULL_CONCURRENCY: z.coerce.number().default(5),
  BULL_JOB_ATTEMPTS: z.coerce.number().default(3),

  // Deduplication
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.6),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  CLOUDWATCH_LOG_GROUP: z.string().optional(),
  CLOUDWATCH_LOG_STREAM: z.string().optional(),

  // AI Moderation
  AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4o-mini'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌  Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
