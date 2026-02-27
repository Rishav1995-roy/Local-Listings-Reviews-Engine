/**
 * @file types/index.ts
 * @description Shared TypeScript types used across all modules.
 */

import { Role } from '@prisma/client';
import { Request } from 'express';

// ── Pagination ─────────────────────────────────────────────
export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// ── HTTP / API ──────────────────────────────────────────────
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  errors?: Record<string, string[]>;
}

export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
}

// ── Auth ────────────────────────────────────────────────────
export interface JwtPayload {
  sub: string;      // User ID
  email: string;
  roles: Role[];
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

// ── BullMQ Job Data ─────────────────────────────────────────
export interface ModerationJobData {
  reviewId: string;
  text: string;
  placeName: string;
  userId: string;
  jobDbId: string; // DB record ID for the ModerationJob model
}

// ── AI Moderation ───────────────────────────────────────────
export type AiLabel =
  | 'safe'
  | 'spam'
  | 'toxic'
  | 'self_promo'
  | 'medical_risk'
  | 'needs_human_review';

export interface AiModerationResult {
  label: AiLabel;
  score: number;       // Confidence 0.0–1.0
  tags: string[];      // e.g. ['food', 'atmosphere', 'price']
  summary: string;     // 1-sentence AI summary of review
  rawResponse?: unknown;
}

// ── Feed ─────────────────────────────────────────────────────
export interface FeedQueryParams {
  city: string;
  category?: string;
  page?: number;
  limit?: number;
}

export interface FeedItem {
  reviewId: string;
  placeId: string;
  placeName: string;
  city: string;
  category: string | null;
  rating: number;
  text: string;
  aiSummary: string | null;
  tags: string[];
  mediaUrls: string[];
  authorName: string;
  helpfulCount: number;
  createdAt: Date;
  score: number; // Computed ranking score
}
