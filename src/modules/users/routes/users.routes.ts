/**
 * GET   /api/v1/users/me   — Own profile (authenticated)
 * PATCH /api/v1/users/me   — Update own profile (authenticated)
 * GET   /api/v1/users/:id  — Public profile
 */

import { Router } from 'express';
import { UsersController } from '../controllers/users.controller';
import { authenticate } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { UpdateUserSchema } from '../dto/users.dto';

const router = Router();
const controller = new UsersController();

router.get('/me', authenticate, (req, res, next) => controller.getMe(req, res, next));

router.patch('/me', authenticate, validate(UpdateUserSchema), (req, res, next) =>
  controller.updateMe(req, res, next),
);

router.get('/:id', (req, res, next) => controller.getById(req, res, next));

export { router as usersRouter };
