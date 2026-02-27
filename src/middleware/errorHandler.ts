/**
 * @file errorHandler.ts
 * @description Global Express error-handling middleware.
 *
 * Must be registered LAST in the Express pipeline (after all routes).
 * Differentiates between:
 *   - Operational errors (AppError): known, expected, safe to surface to client
 *   - Programmer errors (unexpected): log full stack, return 500 to client
 *   - Prisma errors: map to meaningful HTTP codes
 *   - Zod validation errors: return field-level validation messages
 */

import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../utils/ApiError';
import { logger } from '../config/logger';
import { ApiResponse } from '../types';
import { env } from '../config/env';

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void => {
  // ── 1. AppError (operational) ─────────────────────────────
  if (err instanceof AppError) {
    logger.warn('Operational error', {
      code: err.code,
      message: err.message,
      path: req.path,
      method: req.method,
    });

    const body: ApiResponse = {
      success: false,
      message: err.message,
      errors: err.details as Record<string, string[]> | undefined,
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // ── 2. Zod validation error ───────────────────────────────
  if (err instanceof ZodError) {
    const errors: Record<string, string[]> = {};
    err.errors.forEach((e) => {
      const key = e.path.join('.') || 'root';
      errors[key] = errors[key] ?? [];
      errors[key].push(e.message);
    });

    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
    });
    return;
  }

  // ── 3. Prisma errors ──────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: Unique constraint violation
    if (err.code === 'P2002') {
      const fields = (err.meta?.target as string[])?.join(', ') ?? 'field';
      res.status(409).json({
        success: false,
        message: `A record with this ${fields} already exists`,
        code: 'CONFLICT',
      });
      return;
    }

    // P2025: Record not found (e.g. update/delete on non-existent record)
    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        message: 'Record not found',
        code: 'NOT_FOUND',
      });
      return;
    }
  }

  // ── 4. Unknown / programmer error ─────────────────────────
  // Log the full stack trace but never expose internals to the client
  logger.error('Unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    // Only expose stack in dev for debugging convenience
    ...(env.NODE_ENV === 'development' && {
      stack: err instanceof Error ? err.stack : undefined,
    }),
  });
};
