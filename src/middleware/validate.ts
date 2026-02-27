/**
 * @file middleware/validate.ts
 * @description Zod request validation middleware factory.
 *
 * Validates req.body, req.query, or req.params against a Zod schema.
 * Throws a ZodError on failure which is caught by the global error handler.
 *
 * Usage:
 *   router.post('/reviews', authenticate, validate(CreateReviewSchema), handler)
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

type ValidateTarget = 'body' | 'query' | 'params';

export const validate = (schema: ZodSchema, target: ValidateTarget = 'body') => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse(req[target]);
      // Overwrite with parsed (coerced/defaulted) values
      req[target] = parsed;
      next();
    } catch (err) {
      next(err);
    }
  };
};
