/**
 * GET  /api/v1/places          — List places with optional city/category filter
 * POST /api/v1/places          — Find or create (with deduplication)
 * GET  /api/v1/places/:id      — Get place by ID
 */

import { Router } from 'express';
import { PlacesController } from '../controllers/places.controller';
import { authenticate } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { CreatePlaceSchema, PlacesQuerySchema } from '../dto/places.dto';

const router = Router();
const controller = new PlacesController();

router.get('/', validate(PlacesQuerySchema, 'query'), (req, res, next) =>
  controller.list(req, res, next),
);

router.post('/', authenticate, validate(CreatePlaceSchema), (req, res, next) =>
  controller.create(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

export { router as placesRouter };
