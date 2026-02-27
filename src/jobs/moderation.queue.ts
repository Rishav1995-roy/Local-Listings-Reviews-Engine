/**
 * @file moderation.queue.ts
 * @description BullMQ queue for AI moderation jobs.
 *
 * Architecture:
 * ┌──────────────┐   enqueue   ┌──────────────────┐   process   ┌─────────────────┐
 * │ ReviewService│ ──────────▶ │ ModerationQueue   │ ──────────▶ │ ModerationWorker │
 * └──────────────┘             │  (Redis-backed)   │             │  (AI provider)  │
 *                              └──────────────────┘             └─────────────────┘
 *
 * The API request returns immediately after enqueueing.
 * The worker runs asynchronously and updates the review record when done.
 *
 * BullMQ config:
 * - removeOnComplete: keep last 1000 successful jobs (for debugging)
 * - removeOnFail:     keep last 5000 failed jobs (for re-processing)
 * - attempts: 3 with exponential back-off
 * - backoff: exponential, starting at 5 seconds
 */

import { Queue } from 'bullmq';
import { createBullMQConnection } from '../config/redis';
import { ModerationJobData } from '../types';
import { logger } from '../config/logger';

export const MODERATION_QUEUE_NAME = 'moderation';

// Singleton queue instance — shared by all modules that need to enqueue
let moderationQueue: Queue<ModerationJobData> | null = null;

export const getModerationQueue = (): Queue<ModerationJobData> => {
  if (!moderationQueue) {
    moderationQueue = new Queue<ModerationJobData>(MODERATION_QUEUE_NAME, {
      connection: createBullMQConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s → 10s → 20s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });

    moderationQueue.on('error', (err) => {
      logger.error('BullMQ queue error', { queue: MODERATION_QUEUE_NAME, error: err.message });
    });
  }

  return moderationQueue;
};

/**
 * Enqueue a review for AI moderation.
 * Returns the BullMQ job ID for tracking.
 */
export const enqueueModerationJob = async (
  data: ModerationJobData,
): Promise<string> => {
  const queue = getModerationQueue();
  const job = await queue.add(`moderate-review-${data.reviewId}`, data, {
    jobId: `moderation:${data.reviewId}`, // Idempotent: prevents duplicate jobs
  });

  logger.info('Moderation job enqueued', {
    jobId: job.id,
    reviewId: data.reviewId,
  });

  return job.id ?? data.reviewId;
};
