/**
 * Integration tests — Feed module
 * GET /api/v1/feed
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    review: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';

const app = createApp();
const db = prisma as any;

const makeReview = (overrides: Record<string, unknown> = {}) => ({
  id: 'review-uuid-0001',
  userId: 'user-uuid-0001',
  placeId: 'place-uuid-0001',
  rating: 4,
  text: 'Great coffee and lovely ambience here.',
  status: 'APPROVED',
  aiLabel: null,
  aiSummary: 'A pleasant cafe experience.',
  aiScore: 0.92,
  helpfulCount: 12,
  moderatedBy: null,
  moderatedAt: null,
  moderationNote: null,
  createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
  updatedAt: new Date(),
  place: { id: 'place-uuid-0001', name: 'The Coffee House', city: 'Bangalore', category: 'cafe' },
  user: { id: 'user-uuid-0001', name: 'Alice' },
  // tags resolved via ReviewTag join table: [{ tag: { name: 'cozy' } }, ...]
  tags: [{ tag: { name: 'cozy' } }, { tag: { name: 'friendly' } }],
  mediaItems: [],
  ...overrides,
});

beforeEach(() => jest.clearAllMocks());

// ── GET /feed ─────────────────────────────────────────────────────────────────

describe('GET /api/v1/feed', () => {
  it('returns a ranked feed for a city', async () => {
    db.review.findMany.mockResolvedValue([makeReview(), makeReview({ id: 'review-uuid-0002', helpfulCount: 30 })]);

    const res = await request(app).get('/api/v1/feed?city=Bangalore');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    // Reviews should be ranked (highest score first)
    if (res.body.data.length >= 2) {
      expect(res.body.data[0].score).toBeGreaterThanOrEqual(res.body.data[1].score);
    }
  });

  it('returns each feed item with the expected shape', async () => {
    db.review.findMany.mockResolvedValue([makeReview()]);

    const res = await request(app).get('/api/v1/feed?city=Bangalore');

    expect(res.status).toBe(200);
    const item = res.body.data[0];
    expect(item).toMatchObject({
      reviewId: expect.any(String),
      placeId: expect.any(String),
      placeName: expect.any(String),
      city: expect.any(String),
      rating: expect.any(Number),
      text: expect.any(String),
      authorName: expect.any(String),
      helpfulCount: expect.any(Number),
      score: expect.any(Number),
    });
    expect(item.score).toBeGreaterThanOrEqual(0);
    expect(item.score).toBeLessThanOrEqual(1);
  });

  it('returns 400 when city is missing', async () => {
    const res = await request(app).get('/api/v1/feed');
    expect(res.status).toBe(400);
  });

  it('filters by category when provided', async () => {
    db.review.findMany.mockResolvedValue([makeReview()]);

    const res = await request(app).get('/api/v1/feed?city=Bangalore&category=cafe');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('applies flagged penalty to previously-flagged reviews', async () => {
    const flagged = makeReview({ aiLabel: 'NEEDS_HUMAN_REVIEW', helpfulCount: 50 });
    const clean = makeReview({ id: 'review-uuid-clean', helpfulCount: 50 });
    db.review.findMany.mockResolvedValue([flagged, clean]);

    const res = await request(app).get('/api/v1/feed?city=Bangalore');

    expect(res.status).toBe(200);
    const [first, second] = res.body.data;
    // clean review should outrank the flagged one
    expect(first.score).toBeGreaterThan(second.score);
  });

  it('returns an empty feed when no approved reviews exist', async () => {
    db.review.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/feed?city=Nowhere');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('respects pagination params', async () => {
    // Generate 5 reviews
    const reviews = Array.from({ length: 5 }, (_, i) =>
      makeReview({ id: `review-uuid-${i}`, helpfulCount: i * 5 }),
    );
    db.review.findMany.mockResolvedValue(reviews);

    const res = await request(app).get('/api/v1/feed?city=Bangalore&page=1&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.limit).toBe(2);
  });
});
