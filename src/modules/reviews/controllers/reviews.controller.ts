import { Request, Response, NextFunction } from 'express';
import { ReviewsService } from '../services/reviews.service';
import { ReviewsRepository } from '../repositories/reviews.repository';
import { CreateReviewDto, ReviewsQueryDto } from '../dto/reviews.dto';
import { AuthenticatedRequest } from '../../../types';
import { sendCreated, sendSuccess, sendPaginated } from '../../../utils/response';

const service = new ReviewsService(new ReviewsRepository());

export class ReviewsController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const files = (req.files as Express.Multer.File[]) ?? [];
      const result = await service.createReview(req.body as CreateReviewDto, userId, files);
      sendCreated(res, result, result.message);
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.listReviews(req.query as unknown as ReviewsQueryDto);
      sendPaginated(res, result);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const review = await service.getReviewById(req.params.id);
      sendSuccess(res, review);
    } catch (err) {
      next(err);
    }
  }
}
