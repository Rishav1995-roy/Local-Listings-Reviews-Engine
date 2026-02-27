/**
 * @file moderation.worker.ts
 * @description BullMQ worker that processes AI moderation jobs.
 *
 * Lifecycle per job:
 * 1. Receive ModerationJobData from the queue
 * 2. Call AI provider (mock or real)
 * 3. Map AI label → ReviewStatus:
 *      safe           → APPROVED
 *      needs_human_review → FLAGGED (goes to human moderation queue)
 *      spam/toxic/self_promo/medical_risk → REJECTED
 * 4. Update Review record with AI results
 * 5. Update ModerationJob record with completion timestamp
 *
 * Error handling:
 * - BullMQ retries automatically up to BULL_JOB_ATTEMPTS times
 * - After all retries exhausted, job moves to "failed" state
 * - Failed jobs are monitored via CloudWatch alerts on queue depth
 */

import { Worker, Job } from 'bullmq';
import { ReviewStatus, ModerationLabel } from '@prisma/client';
import { createBullMQConnection } from '../config/redis';
import { MODERATION_QUEUE_NAME } from '../jobs/moderation.queue';
import { ModerationJobData, AiLabel } from '../types';
import { MockAiProvider } from './ai-providers/mock.provider';
import { IAiProvider } from './ai-providers/ai-provider.interface';
import { prisma } from '../db/prisma';
import { logger } from '../config/logger';
import { env } from '../config/env';

// ── Map AI labels to DB enum values ──────────────────────────
const AI_LABEL_TO_DB: Record<AiLabel, ModerationLabel> = {
  safe: 'SAFE',
  spam: 'SPAM',
  toxic: 'TOXIC',
  self_promo: 'SELF_PROMO',
  medical_risk: 'MEDICAL_RISK',
  needs_human_review: 'NEEDS_HUMAN_REVIEW',
};

// ── Map AI labels to review status ───────────────────────────
const AI_LABEL_TO_REVIEW_STATUS: Record<AiLabel, ReviewStatus> = {
  safe: 'APPROVED',
  spam: 'REJECTED',
  toxic: 'REJECTED',
  self_promo: 'REJECTED',
  medical_risk: 'FLAGGED',      // Medical claims need human eyes
  needs_human_review: 'FLAGGED',
};

const getAiProvider = (): IAiProvider => {
  // Swap in real provider based on env
  // if (env.AI_PROVIDER === 'openai') return new OpenAiProvider(env.AI_API_KEY);
  return new MockAiProvider();
};

export const startModerationWorker = (): Worker<ModerationJobData> => {
  const aiProvider = getAiProvider();

  const worker = new Worker<ModerationJobData>(
    MODERATION_QUEUE_NAME,
    async (job: Job<ModerationJobData>) => {
      const { reviewId, text, placeName, jobDbId } = job.data;

      logger.info('Processing moderation job', {
        jobId: job.id,
        reviewId,
        attempt: job.attemptsMade + 1,
      });

      // ── 1. Call AI provider ───────────────────────────────
      const aiResult = await aiProvider.moderate({
        reviewText: text,
        placeName,
        category: undefined, // Could fetch from DB if needed
      });

      // ── 2. Determine review status from label ─────────────
      const newStatus = AI_LABEL_TO_REVIEW_STATUS[aiResult.label];
      const dbLabel = AI_LABEL_TO_DB[aiResult.label];

      // ── 3. Update review + moderation job atomically ──────
      await prisma.$transaction([
        prisma.review.update({
          where: { id: reviewId },
          data: {
            status: newStatus,
            aiLabel: dbLabel,
            aiSummary: aiResult.summary,
            aiScore: aiResult.score,
          },
        }),
        prisma.moderationJob.update({
          where: { id: jobDbId },
          data: {
            completedAt: new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            result: aiResult.rawResponse as any,
          },
        }),
      ]);

      // ── 4. Persist AI-generated tags ───────────────────────
      // Each tag is upserted into the shared Tag dictionary then linked to
      // this review via the ReviewTag join table.  Done outside the main
      // transaction so a single bad tag doesn't roll back the status update.
      if (aiResult.tags.length > 0) {
        await Promise.all(
          aiResult.tags.map(async (tagName) => {
            const tag = await prisma.tag.upsert({
              where:  { name: tagName },
              create: { name: tagName },
              update: {},
            });
            await prisma.reviewTag.upsert({
              where:  { reviewId_tagId: { reviewId, tagId: tag.id } },
              create: { reviewId, tagId: tag.id },
              update: {},
            });
          }),
        );
        logger.debug('Tags linked to review', { reviewId, tags: aiResult.tags });
      }

      logger.info('Moderation job completed', {
        reviewId,
        label: aiResult.label,
        status: newStatus,
        score: aiResult.score,
      });

      return { reviewId, label: aiResult.label, status: newStatus };
    },
    {
      connection: createBullMQConnection(),
      concurrency: env.BULL_CONCURRENCY,
    },
  );

  // ── Worker event listeners ────────────────────────────────
  worker.on('completed', (job) => {
    logger.debug('Job completed', { jobId: job.id });
  });

  worker.on('failed', async (job, err) => {
    logger.error('Moderation job failed', {
      jobId: job?.id,
      reviewId: job?.data?.reviewId,
      error: err.message,
      attempt: job?.attemptsMade,
    });

    // On final failure, mark review as flagged for human review
    if (job && job.attemptsMade >= env.BULL_JOB_ATTEMPTS) {
      await prisma.review.update({
        where: { id: job.data.reviewId },
        data: { status: 'FLAGGED' },
      }).catch(() => {
        logger.error('Failed to flag review after job exhaustion', {
          reviewId: job.data.reviewId,
        });
      });

      await prisma.moderationJob.update({
        where: { id: job.data.jobDbId },
        data: { failedAt: new Date(), error: err.message },
      }).catch(() => {});
    }
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  return worker;
};
