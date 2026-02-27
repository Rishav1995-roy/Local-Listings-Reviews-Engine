/**
 * @file feed.service.ts
 * @description Ranked feed computation for the GET /feed endpoint.
 *
 * Ranking Formula:
 * ─────────────────
 *   score = (0.4 × recency_score)
 *         + (0.3 × engagement_score)
 *         + (0.2 × location_match)
 *         + (0.1 × category_match)
 *         - flagged_penalty
 *
 * Component Definitions:
 * ──────────────────────
 *   recency_score    = e^(-λ × age_in_days)   where λ = 0.05
 *                      A review 14 days old scores 0.496 vs 1.0 for today's
 *
 *   engagement_score = min(helpful_count / 50, 1.0)
 *                      50+ helpful votes → score 1.0 (capped)
 *
 *   location_match   = 1.0 (city matched, already filtered in WHERE clause)
 *                      0.5 (nearby city — future geo-radius extension)
 *
 *   category_match   = 1.0 if query category matches place category, else 0.0
 *
 *   flagged_penalty  = 0.5 if review was ever flagged/rejected (now approved)
 *
 * Example Scores:
 * ───────────────
 *   Review A: 3 days old, 20 helpful votes, city match, category match
 *     = (0.4 × 0.86) + (0.3 × 0.40) + (0.2 × 1.0) + (0.1 × 1.0) - 0
 *     = 0.344 + 0.12 + 0.2 + 0.1 = 0.764
 *
 *   Review B: 30 days old, 5 helpful votes, city match, no category match
 *     = (0.4 × 0.22) + (0.3 × 0.10) + (0.2 × 1.0) + (0.1 × 0.0) - 0
 *     = 0.088 + 0.03 + 0.2 + 0 = 0.318
 *
 * Review A ranks significantly higher.
 */

import { prisma } from '../../../db/prisma';
import { FeedItem, FeedQueryParams } from '../../../types';
import { parsePagination, buildPaginatedResult } from '../../../utils/pagination';
import { logger } from '../../../config/logger';

const DECAY_LAMBDA = 0.05;      // Recency decay rate
const ENGAGEMENT_CAP = 50;      // Helpful votes for max engagement score
const FLAGGED_PENALTY = 0.5;    // Score penalty for previously-flagged reviews

/**
 * Compute recency score: exponential decay over age_in_days.
 * Fresh reviews score close to 1.0; old reviews approach 0.
 */
const recencyScore = (createdAt: Date): number => {
  const ageMs = Date.now() - createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_LAMBDA * ageDays);
};

/**
 * Compute engagement score: normalised helpful vote count.
 */
const engagementScore = (helpfulCount: number): number => {
  return Math.min(helpfulCount / ENGAGEMENT_CAP, 1.0);
};

/**
 * Full ranking score combining all signals.
 */
export const computeRankingScore = (params: {
  createdAt: Date;
  helpfulCount: number;
  cityMatch: boolean;
  categoryMatch: boolean;
  wasFlagged: boolean;
}): number => {
  const recency = recencyScore(params.createdAt);
  const engagement = engagementScore(params.helpfulCount);
  const locationMatch = params.cityMatch ? 1.0 : 0.5;
  const catMatch = params.categoryMatch ? 1.0 : 0.0;
  const penalty = params.wasFlagged ? FLAGGED_PENALTY : 0;

  const score =
    0.4 * recency +
    0.3 * engagement +
    0.2 * locationMatch +
    0.1 * catMatch -
    penalty;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
};

export class FeedService {
  async getFeed(params: FeedQueryParams) {
    const pagination = parsePagination(params.page, params.limit);

    // Fetch approved reviews for the requested city
    // We over-fetch (10×) to have enough data for ranking, then paginate
    const OVER_FETCH_MULTIPLIER = 10;
    const fetchLimit = pagination.limit * OVER_FETCH_MULTIPLIER;

    const reviews = await prisma.review.findMany({
      where: {
        status: 'APPROVED',
        place: {
          city: { contains: params.city, mode: 'insensitive' },
          status: 'ACTIVE',
          ...(params.category && {
            category: { contains: params.category, mode: 'insensitive' },
          }),
        },
      },
      include: {
        place: {
          select: { id: true, name: true, city: true, category: true },
        },
        user: { select: { id: true, name: true } },
        // Resolved tag names via the ReviewTag join table
        tags: { include: { tag: { select: { name: true } } } },
        mediaItems: { select: { url: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
    });

    logger.debug('Feed: fetched reviews for ranking', {
      city: params.city,
      category: params.category,
      fetchedCount: reviews.length,
    });

    // ── Rank reviews in-process ───────────────────────────
    const scored: FeedItem[] = reviews.map((review) => {
      const categoryMatch =
        !params.category ||
        review.place.category?.toLowerCase().includes(params.category.toLowerCase()) ||
        false;

      const score = computeRankingScore({
        createdAt: review.createdAt,
        helpfulCount: review.helpfulCount,
        cityMatch: true, // Already filtered in WHERE
        categoryMatch,
        wasFlagged: review.aiLabel === 'NEEDS_HUMAN_REVIEW',
      });

      return {
        reviewId: review.id,
        placeId: review.place.id,
        placeName: review.place.name,
        city: review.place.city,
        category: review.place.category,
        rating: review.rating,
        text: review.text,
        aiSummary: review.aiSummary,
        tags: (review as any).tags?.map((rt: any) => rt.tag.name) ?? [],
        mediaUrls: review.mediaItems.map((m) => m.url),
        authorName: review.user.name,
        helpfulCount: review.helpfulCount,
        createdAt: review.createdAt,
        score,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Paginate after ranking
    const total = scored.length;
    const paginated = scored.slice(pagination.offset, pagination.offset + pagination.limit);

    return buildPaginatedResult(paginated, total, pagination);
  }
}
