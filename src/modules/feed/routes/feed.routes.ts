/**
 * GET /api/v1/feed?city=Bangalore&category=bakery&page=1&limit=20
 *
 * Returns ranked, approved reviews for a given city.
 * city is required. category, page, limit are optional.
 */

import { Router } from 'express';
import { FeedController } from '../controllers/feed.controller';
import { validate } from '../../../middleware/validate';
import { FeedQuerySchema } from '../dto/feed.dto';

const router = Router();
const controller = new FeedController();

router.get(
  '/',
  validate(FeedQuerySchema, 'query'),
  (req, res, next) => controller.getFeed(req, res, next),
);

export { router as feedRouter };
