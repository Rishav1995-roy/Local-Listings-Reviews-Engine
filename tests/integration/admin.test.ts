/**
 * Integration tests — Admin module
 * GET    /api/v1/admin/moderation-queue
 * PATCH  /api/v1/admin/reviews/:id/approve
 * PATCH  /api/v1/admin/reviews/:id/reject
 * GET    /api/v1/admin/places/merge-queue
 * POST   /api/v1/admin/places/:id/merge
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    review: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    place: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';
import { userToken, adminToken, TEST_ADMIN_ID } from './helpers/jwtHelper';

const app = createApp();
const db = prisma as any;

// Canonical UUID format — required by Zod uuid() schema
const SOURCE_PLACE_ID = '33333333-3333-4333-a333-333333333333';
const TARGET_PLACE_ID = '44444444-4444-4444-a444-444444444444';
const REVIEW_ID       = '55555555-5555-4555-a555-555555555555';

const flaggedReview = {
  id: REVIEW_ID,
  userId: '11111111-1111-4111-a111-111111111111',
  placeId: SOURCE_PLACE_ID,
  rating: 2,
  text: 'This place is terrible, avoid at all costs!',
  status: 'FLAGGED',
  aiLabel: 'NEEDS_HUMAN_REVIEW',
  aiTags: ['negative'],
  aiSummary: null,
  aiScore: 0.7,
  helpfulCount: 0,
  moderatedBy: null,
  moderatedAt: null,
  moderationNote: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: { id: '11111111-1111-4111-a111-111111111111', name: 'Alice', email: 'alice@example.com' },
  place: { id: SOURCE_PLACE_ID, name: 'Bad Place', city: 'Bangalore', category: 'restaurant' },
  moderationJobs: [{ jobId: 'bull-job-xyz', result: null, createdAt: new Date() }],
};

const sourcePlaceDb = {
  id: SOURCE_PLACE_ID,
  name: 'Cofee Hous',
  normalizedName: 'cofee hous bangalore',
  city: 'Bangalore',
  state: null,
  country: 'IN',
  category: 'cafe',
  address: null,
  latitude: null,
  longitude: null,
  status: 'NEEDS_MERGE_REVIEW',
  needsMergeReview: true,
  canonicalPlaceId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { reviews: 1 },
};

const targetPlaceDb = {
  ...sourcePlaceDb,
  id: TARGET_PLACE_ID,
  name: 'The Coffee House',
  normalizedName: 'the coffee house bangalore',
  status: 'ACTIVE',
  needsMergeReview: false,
  _count: { reviews: 5 },
};

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(db);
    return Promise.all(arg);
  });
});

// ── RBAC sanity checks ────────────────────────────────────────────────────────

describe('Admin RBAC', () => {
  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/v1/admin/moderation-queue');
    expect(res.status).toBe(401);
  });

  it('returns 403 when a USER role tries to access admin routes', async () => {
    const res = await request(app)
      .get('/api/v1/admin/moderation-queue')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});

// ── GET /admin/moderation-queue ───────────────────────────────────────────────

describe('GET /api/v1/admin/moderation-queue', () => {
  it('returns FLAGGED reviews for admin', async () => {
    db.review.findMany.mockResolvedValue([flaggedReview]);
    db.review.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/admin/moderation-queue')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].status).toBe('FLAGGED');
    expect(res.body.meta).toBeDefined();
  });

  it('returns an empty queue when no flagged reviews exist', async () => {
    db.review.findMany.mockResolvedValue([]);
    db.review.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/admin/moderation-queue')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── PATCH /admin/reviews/:id/approve ─────────────────────────────────────────

describe('PATCH /api/v1/admin/reviews/:id/approve', () => {
  const approvedReview = {
    ...flaggedReview,
    status: 'APPROVED',
    moderatedBy: TEST_ADMIN_ID,
    moderatedAt: new Date(),
    moderationNote: 'Looks fine after review',
  };

  it('approves a flagged review', async () => {
    db.review.findUnique.mockResolvedValue(flaggedReview);
    db.review.update.mockResolvedValue(approvedReview);

    const res = await request(app)
      .patch(`/api/v1/admin/reviews/${REVIEW_ID}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Looks fine after review' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('APPROVED');
  });

  it('returns 404 when review does not exist', async () => {
    db.review.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/admin/reviews/nonexistent/approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/reviews/${REVIEW_ID}/approve`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({});

    expect(res.status).toBe(403);
  });
});

// ── PATCH /admin/reviews/:id/reject ──────────────────────────────────────────

describe('PATCH /api/v1/admin/reviews/:id/reject', () => {
  const rejectedReview = {
    ...flaggedReview,
    status: 'REJECTED',
    moderatedBy: TEST_ADMIN_ID,
    moderatedAt: new Date(),
    moderationNote: 'Contains inappropriate content',
  };

  it('rejects a flagged review', async () => {
    db.review.findUnique.mockResolvedValue(flaggedReview);
    db.review.update.mockResolvedValue(rejectedReview);

    const res = await request(app)
      .patch(`/api/v1/admin/reviews/${REVIEW_ID}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Contains inappropriate content' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
  });

  it('returns 404 when review does not exist', async () => {
    db.review.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch('/api/v1/admin/reviews/nonexistent/reject')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ── GET /admin/places/merge-queue ─────────────────────────────────────────────

describe('GET /api/v1/admin/places/merge-queue', () => {
  it('returns places flagged for merge review', async () => {
    db.place.findMany.mockResolvedValue([sourcePlaceDb]);
    db.place.count.mockResolvedValue(1);

    const res = await request(app)
      .get('/api/v1/admin/places/merge-queue')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      needsMergeReview: true,
      status: 'NEEDS_MERGE_REVIEW',
    });
  });

  it('returns an empty list when the queue is clear', async () => {
    db.place.findMany.mockResolvedValue([]);
    db.place.count.mockResolvedValue(0);

    const res = await request(app)
      .get('/api/v1/admin/places/merge-queue')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── POST /admin/places/:id/merge ──────────────────────────────────────────────

describe('POST /api/v1/admin/places/:id/merge', () => {
  it('merges a duplicate place into a canonical place', async () => {
    // Route looks up source and target in parallel, then calls PlacesRepository.mergePlaces
    db.place.findUnique
      .mockResolvedValueOnce(sourcePlaceDb)  // source
      .mockResolvedValueOnce(targetPlaceDb); // target

    // mergePlaces → $transaction([review.updateMany, place.update])
    db.review.updateMany.mockResolvedValue({ count: 1 });
    db.place.update.mockResolvedValue({ ...sourcePlaceDb, status: 'MERGED', canonicalPlaceId: TARGET_PLACE_ID });

    const res = await request(app)
      .post(`/api/v1/admin/places/${SOURCE_PLACE_ID}/merge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ canonicalPlaceId: TARGET_PLACE_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      mergedPlaceId: SOURCE_PLACE_ID,
      canonicalPlaceId: TARGET_PLACE_ID,
    });
  });

  it('returns 400 when merging a place into itself', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/places/${SOURCE_PLACE_ID}/merge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ canonicalPlaceId: SOURCE_PLACE_ID });

    expect(res.status).toBe(400);
  });

  it('returns 404 when source place does not exist', async () => {
    db.place.findUnique
      .mockResolvedValueOnce(null)           // source not found
      .mockResolvedValueOnce(targetPlaceDb); // target found

    const res = await request(app)
      .post(`/api/v1/admin/places/${SOURCE_PLACE_ID}/merge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ canonicalPlaceId: TARGET_PLACE_ID });

    expect(res.status).toBe(404);
  });

  it('returns 400 when canonicalPlaceId is not a valid UUID', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/places/${SOURCE_PLACE_ID}/merge`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ canonicalPlaceId: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-admin user', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/places/${SOURCE_PLACE_ID}/merge`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ canonicalPlaceId: TARGET_PLACE_ID });

    expect(res.status).toBe(403);
  });
});
