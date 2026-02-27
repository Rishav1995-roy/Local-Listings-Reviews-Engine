/**
 * @file places.service.ts
 * @description Business logic for place creation with deduplication.
 *
 * Deduplication Decision Tree:
 * ─────────────────────────────
 *  Input: "Sweet-Oven Bakery – Bangalore"
 *  Normalised: "sweet oven bakery bangalore"
 *
 *  1. Query DB via pg_trgm similarity >= threshold (default 0.6)
 *  2. Any matches?
 *     YES (score >= threshold):
 *       → Return existing place (linked dedup)
 *       → Client receives canonical place ID — no duplicate created
 *     NO match or score < threshold:
 *       → Create new place
 *       → Set needs_merge_review = true (admin reviews in moderation queue)
 */

import { Place } from '@prisma/client';
import { PlacesRepository } from '../repositories/places.repository';
import { CreatePlaceDto, PlacesQueryDto } from '../dto/places.dto';
import { AppError } from '../../../utils/ApiError';
import { normalizePlaceName } from '../../../utils/normalize';
import { parsePagination, buildPaginatedResult } from '../../../utils/pagination';
import { logger } from '../../../config/logger';
import { env } from '../../../config/env';

export interface FindOrCreatePlaceResult {
  place: Place;
  wasDeduped: boolean;        // True if matched an existing place
  similarityScore?: number;   // Score of the matched place (if deduped)
}

export class PlacesService {
  constructor(private readonly repo: PlacesRepository) {}

  /**
   * Find or create a place with deduplication.
   * Called internally by ReviewsService when a review is submitted.
   */
  async findOrCreate(dto: CreatePlaceDto): Promise<FindOrCreatePlaceResult> {
    const normalizedName = normalizePlaceName(`${dto.name} ${dto.city}`);

    logger.debug('Deduplication check', { normalizedName, city: dto.city });

    const similar = await this.repo.findSimilar(normalizedName, dto.city);

    if (similar.length > 0) {
      const best = similar[0];
      logger.info('Place deduped', {
        input: dto.name,
        matchedId: best.id,
        matchedName: best.name,
        score: best.similarityScore,
      });

      const existingPlace = await this.repo.findById(best.id);
      if (!existingPlace) throw AppError.internal('Dedup matched place not found');

      return {
        place: existingPlace,
        wasDeduped: true,
        similarityScore: best.similarityScore,
      };
    }

    // Resolve category FK: if the client supplied a slug that matches a known
    // Category row, set categoryId for referential integrity. The slug is also
    // stored as the plain `category` string for backward-compat raw SQL queries.
    let categoryId: string | undefined;
    if (dto.category) {
      const cat = await this.repo.findCategoryBySlug(dto.category);
      categoryId = cat?.id;
    }

    // No match found → create new place and flag for admin review
    // This prevents silent duplicates while still accepting the review
    const place = await this.repo.create({
      name: dto.name,
      normalizedName,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      category: dto.category,   // denormalised slug for raw queries
      categoryId,               // FK — undefined if slug didn't match a Category
      address: dto.address,
      latitude: dto.latitude,
      longitude: dto.longitude,
      needsMergeReview: true,
    });

    logger.info('New place created', { placeId: place.id, name: place.name });

    return { place, wasDeduped: false };
  }

  async listPlaces(query: PlacesQueryDto) {
    const pagination = parsePagination(query.page, query.limit);
    const { places, total } = await this.repo.findMany({
      city: query.city,
      category: query.category,
      limit: pagination.limit,
      offset: pagination.offset,
    });
    return buildPaginatedResult(places, total, pagination);
  }

  async getPlaceById(id: string): Promise<Place> {
    const place = await this.repo.findById(id);
    if (!place) throw AppError.notFound('Place');
    return place;
  }
}
