import { AppError } from '../../../utils/ApiError';
import { buildPaginatedResult, parsePagination } from '../../../utils/pagination';
import { ModerationNoteDto, MergePlaceDto, AdminQueryDto } from '../dto/admin.dto';
import { AdminRepository } from '../repositories/admin.repository';

export class AdminService {
  constructor(private readonly repo: AdminRepository) {}

  // ── Moderation Queue ──────────────────────────────────────

  async getModerationQueue(query: AdminQueryDto) {
    const pagination = parsePagination(query.page, query.limit, 100);
    const { items, total } = await this.repo.findFlaggedReviews(pagination);
    return buildPaginatedResult(items, total, pagination);
  }

  // ── Review Actions ────────────────────────────────────────

  async approveReview(reviewId: string, moderatorId: string, dto: ModerationNoteDto) {
    const review = await this.repo.findReviewById(reviewId);
    if (!review) throw AppError.notFound('Review');
    return this.repo.approveReview(reviewId, moderatorId, dto.note);
  }

  async rejectReview(reviewId: string, moderatorId: string, dto: ModerationNoteDto) {
    const review = await this.repo.findReviewById(reviewId);
    if (!review) throw AppError.notFound('Review');
    return this.repo.rejectReview(reviewId, moderatorId, dto.note);
  }

  // ── Places Merge Queue ────────────────────────────────────

  async getMergeQueue(query: AdminQueryDto) {
    const pagination = parsePagination(query.page, query.limit, 100);
    const { items, total } = await this.repo.findPlacesPendingMerge(pagination);
    return buildPaginatedResult(items, total, pagination);
  }

  async mergePlaces(sourceId: string, dto: MergePlaceDto) {
    if (sourceId === dto.canonicalPlaceId) {
      throw AppError.badRequest('Cannot merge a place into itself');
    }

    const [source, target] = await Promise.all([
      this.repo.findPlaceById(sourceId),
      this.repo.findPlaceById(dto.canonicalPlaceId),
    ]);

    if (!source) throw AppError.notFound('Source place');
    if (!target) throw AppError.notFound('Target (canonical) place');

    await this.repo.mergePlaces(sourceId, dto.canonicalPlaceId);

    return {
      mergedPlaceId: sourceId,
      canonicalPlaceId: dto.canonicalPlaceId,
      message: `All reviews from "${source.name}" reassigned to "${target.name}"`,
    };
  }
}
