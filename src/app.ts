/**
 * @file app.ts
 * @description Express application factory.
 *
 * Separating the app factory from server.ts allows supertest to import
 * the app without binding to a port, making integration tests cleaner.
 */

import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middleware/errorHandler';

// Module routers
import { authRouter } from './modules/auth/routes/auth.routes';
import { usersRouter } from './modules/users/routes/users.routes';
import { placesRouter } from './modules/places/routes/places.routes';
import { reviewsRouter } from './modules/reviews/routes/reviews.routes';
import { feedRouter } from './modules/feed/routes/feed.routes';
import { adminRouter } from './modules/admin/routes/admin.routes';
import { categoriesRouter } from './modules/categories/routes/categories.routes';

export const createApp = (): Application => {
  const app = express();

  // ── Security headers ─────────────────────────────────────
  app.use(helmet());

  // ── CORS ─────────────────────────────────────────────────
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  // ── Body parsing ─────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── Compression ───────────────────────────────────────────
  app.use(compression());

  // ── HTTP request logging ─────────────────────────────────
  app.use(
    morgan('combined', {
      stream: { write: (msg) => logger.http(msg.trim()) },
      skip: (req) => req.url === '/health',
    }),
  );

  // ── Rate limiting ─────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: 'Too many requests, please try again later.',
    },
  });
  app.use(limiter);

  // ── Health check ─────────────────────────────────────────
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      env: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  // ── API Routes ────────────────────────────────────────────
  const apiRouter = express.Router();

  apiRouter.use('/auth', authRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/places', placesRouter);
  apiRouter.use('/reviews', reviewsRouter);
  apiRouter.use('/feed', feedRouter);
  apiRouter.use('/admin', adminRouter);
  apiRouter.use('/categories', categoriesRouter);

  app.use(env.API_PREFIX, apiRouter);

  // ── 404 handler ───────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ success: false, message: 'Route not found' });
  });

  // ── Global error handler (MUST be last) ──────────────────
  app.use(
    (err: unknown, req: Request, res: Response, next: NextFunction) =>
      errorHandler(err, req, res, next),
  );

  return app;
};
