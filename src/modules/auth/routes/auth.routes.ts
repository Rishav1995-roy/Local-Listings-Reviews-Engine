/**
 * @file auth.routes.ts
 * @description Auth module routes.
 *
 * POST /api/v1/auth/register  — Create account
 * POST /api/v1/auth/login     — Obtain access + refresh tokens
 * POST /api/v1/auth/refresh   — Exchange refresh token for new access token
 */

import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validate } from '../../../middleware/validate';
import { RegisterSchema, LoginSchema, RefreshTokenSchema } from '../dto/auth.dto';

const router = Router();
const controller = new AuthController();

router.post('/register', validate(RegisterSchema), (req, res, next) =>
  controller.register(req, res, next),
);

router.post('/login', validate(LoginSchema), (req, res, next) =>
  controller.login(req, res, next),
);

router.post('/refresh', validate(RefreshTokenSchema), (req, res, next) =>
  controller.refresh(req, res, next),
);

export { router as authRouter };
