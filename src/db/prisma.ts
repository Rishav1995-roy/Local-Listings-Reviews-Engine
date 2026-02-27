/**
 * @file prisma.ts
 * @description Singleton PrismaClient instance.
 *
 * In serverless/test environments a new PrismaClient is created per
 * cold start. This pattern prevents connection pool exhaustion in
 * long-lived Node.js processes (EC2, ECS containers).
 *
 * Note: In production on RDS, ensure DATABASE_POOL_MAX is sized
 * appropriately relative to the RDS instance's max_connections param.
 */

import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../config/logger';

declare global {
  // Prevent multiple instances in hot-reload (ts-node-dev)
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [
            { level: 'query', emit: 'event' },
            { level: 'warn', emit: 'stdout' },
            { level: 'error', emit: 'stdout' },
          ]
        : [{ level: 'error', emit: 'stdout' }],
    datasources: {
      db: { url: env.DATABASE_URL },
    },
  });

  // Log slow queries in development to catch N+1 and missing indexes early
  if (env.NODE_ENV === 'development') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on('query', (e: { query: string; duration: number }) => {
      if (e.duration > 200) {
        logger.warn('Slow query detected', {
          query: e.query,
          durationMs: e.duration,
        });
      }
    });
  }

  return client;
};

// Re-use existing client in dev (HMR-safe)
export const prisma: PrismaClient =
  global.__prisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}
