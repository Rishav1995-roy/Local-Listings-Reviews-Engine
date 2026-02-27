import { prisma } from '../../../db/prisma';
import { PaginationParams } from '../../../types';
import { PlacesRepository } from '../../places/repositories/places.repository';

const placesRepo = new PlacesRepository();

export class AdminRepository {
  // ── Moderation Queue ──────────────────────────────────────

  async findFlaggedReviews(pagination: PaginationParams) {
    const [items, total] = await Promise.all([
      prisma.review.findMany({
        where: { status: 'FLAGGED' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          place: { select: { id: true, name: true, city: true, category: true } },
          moderationJobs: {
            select: { jobId: true, result: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'asc' },
        skip: pagination.offset,
        take: pagination.limit,
      }),
      prisma.review.count({ where: { status: 'FLAGGED' } }),
    ]);
    return { items, total };
  }

  // ── Review Actions ────────────────────────────────────────

  async findReviewById(id: string) {
    return prisma.review.findUnique({ where: { id } });
  }

  async approveReview(id: string, moderatorId: string, note?: string) {
    return prisma.review.update({
      where: { id },
      data: {
        status: 'APPROVED',
        moderatedBy: moderatorId,
        moderatedAt: new Date(),
        moderationNote: note,
      },
    });
  }

  async rejectReview(id: string, moderatorId: string, note?: string) {
    return prisma.review.update({
      where: { id },
      data: {
        status: 'REJECTED',
        moderatedBy: moderatorId,
        moderatedAt: new Date(),
        moderationNote: note,
      },
    });
  }

  // ── Places Merge Queue ────────────────────────────────────

  async findPlacesPendingMerge(pagination: PaginationParams) {
    const [items, total] = await Promise.all([
      prisma.place.findMany({
        where: { needsMergeReview: true, status: 'NEEDS_MERGE_REVIEW' },
        orderBy: { createdAt: 'asc' },
        skip: pagination.offset,
        take: pagination.limit,
        include: { _count: { select: { reviews: true } } },
      }),
      prisma.place.count({ where: { needsMergeReview: true } }),
    ]);
    return { items, total };
  }

  async findPlaceById(id: string) {
    return prisma.place.findUnique({ where: { id } });
  }

  async mergePlaces(sourceId: string, canonicalId: string) {
    return placesRepo.mergePlaces(sourceId, canonicalId);
  }
}
