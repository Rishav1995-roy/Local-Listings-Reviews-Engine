/**
 * @file server.ts
 * @description Application entry point.
 *
 * Responsibilities:
 * 1. Load environment (dotenv already loaded in env.ts via config/env import)
 * 2. Create the Express app
 * 3. Start BullMQ workers
 * 4. Start HTTP server
 * 5. Handle graceful shutdown (SIGTERM / SIGINT)
 */

import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './db/prisma';
import { redis } from './config/redis';
import { startModerationWorker } from './workers/moderation.worker';

const bootstrap = async (): Promise<void> => {
  // ── Verify DB connection ──────────────────────────────────
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.error('Failed to connect to database', { error: err });
    process.exit(1);
  }

  // ── Start background workers ──────────────────────────────
  const moderationWorker = startModerationWorker();
  logger.info('BullMQ moderation worker started');

  // ── Start HTTP server ─────────────────────────────────────
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on port ${env.PORT}`, {
      env: env.NODE_ENV,
      prefix: env.API_PREFIX,
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────
  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.warn(`${signal} received. Starting graceful shutdown…`);

    // Stop accepting new HTTP connections
    server.close(async () => {
      logger.info('HTTP server closed');

      // Close BullMQ worker (waits for current job to finish)
      await moderationWorker.close();
      logger.info('BullMQ worker closed');

      // Disconnect Prisma
      await prisma.$disconnect();
      logger.info('Database disconnected');

      // Disconnect Redis
      redis.disconnect();
      logger.info('Redis disconnected');

      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force kill if graceful shutdown takes too long (> 30 s)
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30_000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle unhandled promise rejections — log and exit so the process
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    process.exit(1);
  });
};

bootstrap();
