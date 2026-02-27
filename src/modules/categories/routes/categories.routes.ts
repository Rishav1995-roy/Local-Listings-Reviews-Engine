/**
 * GET /api/v1/categories — List all predefined categories (public)
 */

import { Router } from 'express';
import { CategoriesController } from '../controllers/categories.controller';

const router = Router();
const controller = new CategoriesController();

router.get('/', (req, res, next) => controller.list(req, res, next));

export { router as categoriesRouter };
