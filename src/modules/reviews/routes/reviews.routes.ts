/**
 * POST /api/v1/reviews        — Submit a review (authenticated)
 * GET  /api/v1/reviews        — List reviews (filterable by placeId, userId, status)
 * GET  /api/v1/reviews/:id    — Get single review
 */

import { Router } from 'express';
import { ReviewsController } from '../controllers/reviews.controller';
import { authenticate } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { CreateReviewSchema, ReviewsQuerySchema } from '../dto/reviews.dto';
import { upload } from '../../../utils/s3Upload';

const router = Router();
const controller = new ReviewsController();

// upload.array runs before validate so req.body is populated from multipart fields.
// For plain JSON requests multer is a no-op (passes through unchanged).
router.post('/', authenticate, upload.array('files', 10), validate(CreateReviewSchema), (req, res, next) =>
  controller.create(req, res, next),
);

router.get('/', validate(ReviewsQuerySchema, 'query'), (req, res, next) =>
  controller.list(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

export { router as reviewsRouter };
