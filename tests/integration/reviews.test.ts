/**
 * Integration tests — Reviews module
 * POST /api/v1/reviews
 * GET  /api/v1/reviews
 * GET  /api/v1/reviews/:id
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    place: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    review: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    moderationJob: {
      create: jest.fn(),
      update: jest.fn(),
    },
    mediaUpload: {
      create: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

jest.mock('@jobs/moderation.queue', () => ({
  enqueueModerationJob: jest.fn().mockResolvedValue('bull-job-abc123'),
}));

// Mock AWS S3 SDK so integration tests don't hit real S3
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue('https://s3.amazonaws.com/test-bucket/uploads/user/photo.jpg'),
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';
import { userToken, TEST_USER_ID } from './helpers/jwtHelper';

const app = createApp();
const db = prisma as any;

// Proper UUIDs — Zod uuid() validation requires canonical UUID format
const PLACE_ID  = '33333333-3333-4333-a333-333333333333';
const REVIEW_ID = '55555555-5555-4555-a555-555555555555';
const MOD_JOB_ID = '66666666-6666-4666-a666-666666666666';

const dbPlace = {
  id: PLACE_ID,
  name: 'The Coffee House',
  normalizedName: 'the coffee house bangalore',
  city: 'Bangalore',
  state: 'Karnataka',
  country: 'IN',
  category: 'cafe',
  address: null,
  latitude: null,
  longitude: null,
  status: 'ACTIVE',
  needsMergeReview: false,
  canonicalPlaceId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const dbReview = {
  id: REVIEW_ID,
  userId: TEST_USER_ID,
  placeId: PLACE_ID,
  rating: 4,
  text: 'Great coffee and ambience. Highly recommended!',
  status: 'PENDING',
  aiLabel: null,
  aiSummary: null,
  aiScore: null,
  moderatedBy: null,
  moderatedAt: null,
  moderationNote: null,
  helpfulCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  user: { id: TEST_USER_ID, name: 'Alice', avatarUrl: null },
  place: { id: PLACE_ID, name: 'The Coffee House', city: 'Bangalore', category: 'cafe' },
  // tags resolved via ReviewTag join table after AI moderation
  tags: [],
  mediaItems: [],
};

const dbModerationJob = {
  id: MOD_JOB_ID,
  reviewId: REVIEW_ID,
  jobId: null,
  attempts: 0,
  result: null,
  error: null,
  createdAt: new Date(),
  completedAt: null,
  failedAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(db);
    return Promise.all(arg);
  });
});

// ── POST /reviews ─────────────────────────────────────────────────────────────

describe('POST /api/v1/reviews', () => {
  it('creates a review using an existing placeId (UUID)', async () => {
    db.place.findUnique.mockResolvedValue(dbPlace);
    db.review.create.mockResolvedValue(dbReview);
    db.moderationJob.create.mockResolvedValue(dbModerationJob);
    db.moderationJob.update.mockResolvedValue({ ...dbModerationJob, jobId: 'bull-job-abc123' });

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        placeId: PLACE_ID,
        rating: 4,
        text: 'Great coffee and ambience. Highly recommended!',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      moderationStatus: 'PENDING',
      review: { id: REVIEW_ID, rating: 4 },
    });
  });

  it('creates a review via placeName+city with a new place', async () => {
    db.$queryRaw.mockResolvedValue([]);        // no similar place
    db.place.create.mockResolvedValue(dbPlace);
    db.review.create.mockResolvedValue(dbReview);
    db.moderationJob.create.mockResolvedValue(dbModerationJob);
    db.moderationJob.update.mockResolvedValue({ ...dbModerationJob, jobId: 'bull-job-abc123' });

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        placeName: 'The Coffee House',
        city: 'Bangalore',
        rating: 5,
        text: 'Absolutely wonderful place with great service!',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.moderationStatus).toBe('PENDING');
  });

  it('deduplicates the place when a similar one already exists', async () => {
    const similarRow = { ...dbPlace, similarityScore: 0.88 };
    db.$queryRaw.mockResolvedValue([similarRow]);
    db.place.findUnique.mockResolvedValue(dbPlace);   // findById after dedup
    db.review.create.mockResolvedValue(dbReview);
    db.moderationJob.create.mockResolvedValue(dbModerationJob);
    db.moderationJob.update.mockResolvedValue({ ...dbModerationJob, jobId: 'bull-job-abc123' });

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        placeName: 'Coffee House',
        city: 'Bangalore',
        rating: 3,
        text: 'Decent place but could be better overall.',
      });

    expect(res.status).toBe(201);
  });

  it('uploads an image file and links it to the review', async () => {
    db.place.findUnique.mockResolvedValue(dbPlace);
    db.review.create.mockResolvedValue(dbReview);
    db.moderationJob.create.mockResolvedValue(dbModerationJob);
    db.moderationJob.update.mockResolvedValue({ ...dbModerationJob, jobId: 'bull-job-abc123' });
    db.mediaUpload.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .field('placeId', PLACE_ID)
      .field('rating', '4')
      .field('text', 'Great coffee and ambience. Highly recommended!')
      .attach('files', Buffer.from('fake image data'), {
        filename: 'photo.jpg',
        contentType: 'image/jpeg',
      });

    expect(res.status).toBe(201);
    expect(db.mediaUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: TEST_USER_ID,
          reviewId: REVIEW_ID,
        }),
      }),
    );
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app).post('/api/v1/reviews').send({
      placeId: PLACE_ID,
      rating: 4,
      text: 'Great coffee and ambience. Highly recommended!',
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 when rating is out of range (> 5)', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ placeId: PLACE_ID, rating: 6, text: 'Some review text here.' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when text is too short (< 10 chars)', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ placeId: PLACE_ID, rating: 4, text: 'Short' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when neither placeId nor placeName+city provided', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ rating: 4, text: 'Some review text with sufficient length.' });

    expect(res.status).toBe(400);
  });
});

// ── GET /reviews ──────────────────────────────────────────────────────────────

describe('GET /api/v1/reviews', () => {
  it('returns a paginated list of reviews', async () => {
    db.review.findMany.mockResolvedValue([dbReview]);
    db.review.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/reviews');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
  });

  it('filters reviews by placeId (valid UUID)', async () => {
    db.review.findMany.mockResolvedValue([dbReview]);
    db.review.count.mockResolvedValue(1);

    const res = await request(app).get(`/api/v1/reviews?placeId=${PLACE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters reviews by userId (valid UUID)', async () => {
    db.review.findMany.mockResolvedValue([dbReview]);
    db.review.count.mockResolvedValue(1);

    const res = await request(app).get(`/api/v1/reviews?userId=${TEST_USER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('filters reviews by status', async () => {
    db.review.findMany.mockResolvedValue([]);
    db.review.count.mockResolvedValue(0);

    const res = await request(app).get('/api/v1/reviews?status=APPROVED');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 400 for a non-UUID placeId', async () => {
    const res = await request(app).get('/api/v1/reviews?placeId=not-a-uuid');
    expect(res.status).toBe(400);
  });
});

// ── GET /reviews/:id ──────────────────────────────────────────────────────────

describe('GET /api/v1/reviews/:id', () => {
  it('returns a single review with relations', async () => {
    db.review.findUnique.mockResolvedValue(dbReview);

    const res = await request(app).get(`/api/v1/reviews/${REVIEW_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: REVIEW_ID,
      rating: 4,
      status: 'PENDING',
    });
  });

  it('returns 404 for an unknown id', async () => {
    db.review.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/reviews/nonexistent-id');
    expect(res.status).toBe(404);
  });
});
