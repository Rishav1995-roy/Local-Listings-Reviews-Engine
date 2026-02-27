/**
 * @file middleware/auth.ts
 * @description JWT verification + RBAC middleware factory.
 *
 * Usage:
 *   router.get('/admin', authenticate, authorize('ADMIN'), handler)
 *   router.get('/profile', authenticate, handler)
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';
import { AppError } from '../utils/ApiError';
import { JwtPayload, AuthenticatedRequest } from '../types';

/**
 * Verifies the Bearer JWT in the Authorization header.
 * Attaches the decoded payload to req.user.
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(AppError.unauthorized('Missing or malformed Authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(AppError.unauthorized('Token has expired'));
    }
    return next(AppError.unauthorized('Invalid token'));
  }
};

/**
 * Role-based access control middleware factory.
 * Must be used after `authenticate`.
 *
 * @param allowedRoles - One or more roles permitted to access the route.
 */
export const authorize = (...allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      return next(AppError.unauthorized());
    }

    const hasRole = user.roles.some((role) => allowedRoles.includes(role));

    if (!hasRole) {
      return next(
        AppError.forbidden(
          `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        ),
      );
    }

    next();
  };
};
