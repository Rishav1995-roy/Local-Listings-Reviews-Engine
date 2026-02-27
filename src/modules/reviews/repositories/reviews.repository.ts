/**
 * @file reviews.repository.ts
 * @description Data access layer for reviews.
 */

import { Review, ReviewStatus, Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma';

export class ReviewsRepository {
  async create(data: {
    userId: string;
    placeId: string;
    rating: number;
    text: string;
  }): Promise<Review> {
    return prisma.review.create({ data });
  }

  async findById(id: string): Promise<Review | null> {
    return prisma.review.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        place: { select: { id: true, name: true, city: true, category: true } },
        mediaItems: { select: { url: true, mimeType: true } },
      } as Prisma.ReviewInclude,
    });
  }

  async findMany(params: {
    placeId?: string;
    userId?: string;
    status?: ReviewStatus;
    limit: number;
    offset: number;
  }): Promise<{ reviews: Review[]; total: number }> {
    const where: Prisma.ReviewWhereInput = {
      ...(params.placeId && { placeId: params.placeId }),
      ...(params.userId && { userId: params.userId }),
      ...(params.status && { status: params.status }),
    };

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip: params.offset,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, avatarUrl: true } },
          mediaItems: { select: { url: true } },
        },
      }),
      prisma.review.count({ where }),
    ]);

    return { reviews, total };
  }

  async createModerationJob(data: {
    reviewId: string;
    jobId?: string;
  }) {
    return prisma.moderationJob.create({
      data: {
        reviewId: data.reviewId,
        jobId: data.jobId,
      },
    });
  }

  async updateModerationJobBullId(jobDbId: string, bullJobId: string) {
    return prisma.moderationJob.update({
      where: { id: jobDbId },
      data: { jobId: bullJobId },
    });
  }

  async updateStatus(id: string, status: ReviewStatus): Promise<Review> {
    return prisma.review.update({ where: { id }, data: { status } });
  }

  /**
   * Create a MediaUpload record and link it to a review in a single step.
   * Called after each file is uploaded to S3 during review submission.
   */
  async createMediaUpload(data: {
    userId: string;
    reviewId: string;
    s3Key: string;
    s3Bucket: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<void> {
    await prisma.mediaUpload.create({ data });
  }
}
