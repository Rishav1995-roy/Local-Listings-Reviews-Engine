/**
 * @file admin.routes.ts
 * @description Admin and moderator-only routes.
 *
 * All routes require authenticate + authorize('ADMIN' | 'MODERATOR').
 *
 * GET    /api/v1/admin/moderation-queue          — View FLAGGED reviews
 * PATCH  /api/v1/admin/reviews/:id/approve       — Approve a review
 * PATCH  /api/v1/admin/reviews/:id/reject        — Reject a review
 * GET    /api/v1/admin/places/merge-queue        — Places needing merge review
 * POST   /api/v1/admin/places/:id/merge          — Merge place into another
 */

import { Router } from 'express';
import { authenticate, authorize } from '../../../middleware/auth';
import { validate } from '../../../middleware/validate';
import { AdminController } from '../controllers/admin.controller';
import { ModerationNoteSchema, MergePlaceSchema, AdminQuerySchema } from '../dto/admin.dto';

const router = Router();
const controller = new AdminController();

// All admin routes require authentication + ADMIN role
router.use(authenticate, authorize('ADMIN'));

// ── Moderation Queue ─────────────────────────────────────────

router.get(
  '/moderation-queue',
  validate(AdminQuerySchema, 'query'),
  (req, res, next) => controller.getModerationQueue(req, res, next),
);

// ── Review Actions ───────────────────────────────────────────

router.patch(
  '/reviews/:id/approve',
  validate(ModerationNoteSchema),
  (req, res, next) => controller.approveReview(req, res, next),
);

router.patch(
  '/reviews/:id/reject',
  validate(ModerationNoteSchema),
  (req, res, next) => controller.rejectReview(req, res, next),
);

// ── Places Merge Queue ───────────────────────────────────────

router.get(
  '/places/merge-queue',
  validate(AdminQuerySchema, 'query'),
  (req, res, next) => controller.getMergeQueue(req, res, next),
);

router.post(
  '/places/:id/merge',
  validate(MergePlaceSchema),
  (req, res, next) => controller.mergePlaces(req, res, next),
);

export { router as adminRouter };
