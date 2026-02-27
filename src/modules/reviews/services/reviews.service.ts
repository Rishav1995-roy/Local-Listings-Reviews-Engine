/**
 * @file reviews.service.ts
 * @description Business logic for review submission and retrieval.
 *
 * Review Submission Flow:
 * ──────────────────────
 * 1. Validate request (Zod schema)
 * 2. Find or create place (deduplication via pg_trgm)
 * 3. Create review record (status = PENDING)
 * 4. Create ModerationJob DB record (for tracking)
 * 5. Enqueue BullMQ moderation job (non-blocking)
 * 6. Return review immediately — AI result arrives asynchronously
 *
 * The client must NOT poll for the review status synchronously.
 * Instead, implement a webhook or SSE endpoint for status updates
 * (future enhancement: add POST /webhooks/review-moderated).
 */

import { Review } from '@prisma/client';
import { ReviewsRepository } from '../repositories/reviews.repository';
import { PlacesService } from '../../places/services/places.service';
import { PlacesRepository } from '../../places/repositories/places.repository';
import { CreateReviewDto, ReviewsQueryDto } from '../dto/reviews.dto';
import { enqueueModerationJob } from '../../../jobs/moderation.queue';
import { AppError } from '../../../utils/ApiError';
import { parsePagination, buildPaginatedResult } from '../../../utils/pagination';
import { logger } from '../../../config/logger';
import { uploadFileToS3 } from '../../../utils/s3Upload';
import { env } from '../../../config/env';

const placesService = new PlacesService(new PlacesRepository());

export class ReviewsService {
  constructor(private readonly repo: ReviewsRepository) {}

  async createReview(dto: CreateReviewDto, userId: string, files: Express.Multer.File[] = []) {
    // ── Step 1: Resolve place ──────────────────────────────
    let placeId: string;
    let placeName: string;

    if (dto.placeId) {
      // Caller supplied an existing place ID — just look it up
      const existingPlace = await placesService.getPlaceById(dto.placeId);
      placeId = existingPlace.id;
      placeName = existingPlace.name;
    } else {
      // Run deduplication and find or create
      const { place } = await placesService.findOrCreate({
        name: dto.placeName!,
        city: dto.city!,
        country: 'IN',
        category: dto.category,
        state: dto.state,
        address: dto.address,
      });
      placeId = place.id;
      placeName = place.name;
    }

    // ── Step 2: Create the review (PENDING status) ─────────
    const review = await this.repo.create({
      userId,
      placeId,
      rating: dto.rating,
      text: dto.text,
    });

    logger.info('Review created', { reviewId: review.id, placeId, userId });

    // ── Step 2b: Upload attached files to S3 and link to review ──
    // Files arrive via multipart/form-data. Each is uploaded immediately and
    // a MediaUpload record is created referencing this review.
    if (files.length > 0) {
      await Promise.all(
        files.map(async (file) => {
          const { url, s3Key, mimeType, sizeBytes } = await uploadFileToS3(file, userId);
          await this.repo.createMediaUpload({
            userId,
            reviewId: review.id,
            s3Key,
            s3Bucket: env.AWS_S3_BUCKET,
            url,
            mimeType,
            sizeBytes,
          });
          logger.info('File uploaded and linked to review', { reviewId: review.id, s3Key });
        }),
      );
    }

    // ── Step 3: Create DB tracking record for moderation job
    const moderationJobRecord = await this.repo.createModerationJob({
      reviewId: review.id,
    });

    // ── Step 4: Enqueue moderation job ──────
    // API returns before AI processes the review
    const bullJobId = await enqueueModerationJob({
      reviewId: review.id,
      text: dto.text,
      placeName,
      userId,
      jobDbId: moderationJobRecord.id,
    });

    // Update the DB job record with the BullMQ job ID
    await this.repo.updateModerationJobBullId(moderationJobRecord.id, bullJobId);

    return {
      review,
      moderationStatus: 'PENDING',
      message: 'Review submitted. AI moderation is in progress.',
    };
  }

  async listReviews(query: ReviewsQueryDto) {
    const pagination = parsePagination(query.page, query.limit);
    const { reviews, total } = await this.repo.findMany({
      placeId: query.placeId,
      userId: query.userId,
      status: query.status,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    return buildPaginatedResult(reviews, total, pagination);
  }

  async getReviewById(id: string) {
    const review = await this.repo.findById(id);
    if (!review) throw AppError.notFound('Review');
    return review;
  }
}
