/**
 * @file places.repository.ts
 * @description Data access layer for the places module.
 *
 * The core of the deduplication system lives in findSimilar():
 * it calls the PostgreSQL pg_trgm similarity function via a raw query,
 * which leverages the GIN index for sub-millisecond lookups.
 *
 * SQL Example (what Prisma executes under the hood):
 * ─────────────────────────────────────────────────
 * SELECT
 *   id, name, normalized_name, city, category, status,
 *   similarity(normalized_name, 'sweet oven bakery bangalore') AS score
 * FROM places
 * WHERE city ILIKE 'Bangalore'
 *   AND status != 'MERGED'
 *   AND similarity(normalized_name, 'sweet oven bakery bangalore') >= 0.6
 * ORDER BY score DESC
 * LIMIT 10;
 *
 * Input:  "Sweet-Oven Bakery – Bangalore"
 * After normalise(): "sweet oven bakery bangalore"
 * Matches: "Sweet Oven Bakery – Bangalore" (normalised → same string)
 * Similarity score: ~0.89 → DEDUPED
 */

import { Place, PlaceStatus, Category, Prisma } from '@prisma/client';
import { prisma } from '../../../db/prisma';
import { normalizePlaceName } from '../../../utils/normalize';
import { env } from '../../../config/env';

export interface SimilarPlace {
  id: string;
  name: string;
  normalizedName: string;
  city: string;
  category: string | null;
  status: string;
  similarityScore: number;
}

export class PlacesRepository {
  /**
   * Find existing places with fuzzy-similar names in the same city.
   * Uses pg_trgm similarity() which is indexed for fast lookups.
   */
  async findSimilar(
    normalizedName: string,
    city: string,
    threshold = env.SIMILARITY_THRESHOLD,
  ): Promise<SimilarPlace[]> {
    const results = await prisma.$queryRaw<SimilarPlace[]>`
      SELECT
        id::text,
        name,
        normalized_name   AS "normalizedName",
        city,
        category,
        status::text,
        similarity(normalized_name, ${normalizedName})::float AS "similarityScore"
      FROM places
      WHERE
        city ILIKE ${city}
        AND status != 'MERGED'
        AND similarity(normalized_name, ${normalizedName}) >= ${threshold}
      ORDER BY "similarityScore" DESC
      LIMIT 10
    `;

    return results;
  }

  /**
   * Resolve a category by its slug. Returns the Category record or null.
   * Used by PlacesService to set categoryId FK when a known category is given.
   */
  async findCategoryBySlug(slug: string): Promise<Category | null> {
    return prisma.category.findUnique({ where: { slug } });
  }

  async create(data: {
    name: string;
    normalizedName: string;
    city: string;
    state?: string;
    country?: string;
    category?: string;       // denormalised slug for raw-SQL queries
    categoryId?: string;     // FK — set when slug matched a Category row
    address?: string;
    latitude?: number;
    longitude?: number;
    needsMergeReview?: boolean;
    status?: PlaceStatus;
  }): Promise<Place> {
    return prisma.place.create({
      data: {
        name: data.name,
        normalizedName: data.normalizedName,
        city: data.city,
        state: data.state,
        country: data.country ?? 'IN',
        category: data.category,
        categoryId: data.categoryId,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        needsMergeReview: data.needsMergeReview ?? false,
        status: data.status ?? 'ACTIVE',
      },
    });
  }

  async findById(id: string): Promise<Place | null> {
    return prisma.place.findUnique({
      where: { id },
      include: { category_rel: true },
    }) as Promise<Place | null>;
  }

  async findMany(params: {
    city?: string;
    category?: string;
    limit: number;
    offset: number;
  }): Promise<{ places: Place[]; total: number }> {
    const where: Prisma.PlaceWhereInput = {
      status: 'ACTIVE',
      ...(params.city && { city: { contains: params.city, mode: 'insensitive' } }),
      ...(params.category && { category: { contains: params.category, mode: 'insensitive' } }),
    };

    const [places, total] = await Promise.all([
      prisma.place.findMany({
        where,
        skip: params.offset,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: { category_rel: true },
      }),
      prisma.place.count({ where }),
    ]);

    return { places, total };
  }

  async markNeedsMergeReview(id: string): Promise<void> {
    await prisma.place.update({
      where: { id },
      data: { needsMergeReview: true, status: 'NEEDS_MERGE_REVIEW' },
    });
  }

  async mergePlaces(fromId: string, intoId: string): Promise<void> {
    await prisma.$transaction([
      prisma.review.updateMany({
        where: { placeId: fromId },
        data: { placeId: intoId },
      }),
      prisma.place.update({
        where: { id: fromId },
        data: { status: 'MERGED', canonicalPlaceId: intoId },
      }),
    ]);
  }
}
