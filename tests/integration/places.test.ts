/**
 * Integration tests — Places module
 * GET  /api/v1/places
 * POST /api/v1/places
 * GET  /api/v1/places/:id
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    place: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    // category.findUnique called by PlacesRepository.findCategoryBySlug
    category: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';
import { userToken } from './helpers/jwtHelper';

const app = createApp();
const db = prisma as any;

// Use proper UUID format throughout
const PLACE_ID        = '33333333-3333-4333-a333-333333333333';
const SIMILAR_PLACE_ID = '33333333-3333-4333-a333-333333333334';

const dbPlace = {
  id: PLACE_ID,
  name: 'The Coffee House',
  normalizedName: 'the coffee house bangalore',
  city: 'Bangalore',
  state: 'Karnataka',
  country: 'IN',
  category: 'cafe',
  address: '12 MG Road',
  latitude: 12.9716,
  longitude: 77.5946,
  status: 'ACTIVE',
  needsMergeReview: false,
  canonicalPlaceId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  db.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(db);
    return Promise.all(arg);
  });
});

// ── GET /places ───────────────────────────────────────────────────────────────

describe('GET /api/v1/places', () => {
  it('returns a paginated list of places', async () => {
    db.place.findMany.mockResolvedValue([dbPlace]);
    db.place.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/places');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toBeDefined();
  });

  it('filters by city', async () => {
    db.place.findMany.mockResolvedValue([dbPlace]);
    db.place.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/places?city=Bangalore');

    expect(res.status).toBe(200);
    expect(res.body.data[0].city).toBe('Bangalore');
  });

  it('filters by category', async () => {
    db.place.findMany.mockResolvedValue([dbPlace]);
    db.place.count.mockResolvedValue(1);

    const res = await request(app).get('/api/v1/places?category=cafe');

    expect(res.status).toBe(200);
  });

  it('returns an empty list when no places match', async () => {
    db.place.findMany.mockResolvedValue([]);
    db.place.count.mockResolvedValue(0);

    const res = await request(app).get('/api/v1/places?city=Unknown');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

// ── POST /places ──────────────────────────────────────────────────────────────

describe('POST /api/v1/places', () => {
  it('creates a new place when no similar exists', async () => {
    db.$queryRaw.mockResolvedValue([]);   // no similar places
    // category.findUnique called by findCategoryBySlug — returns a matched category
    db.category.findUnique.mockResolvedValue({ id: 'cat-uuid-cafe', slug: 'cafe', name: 'Café' });
    db.place.create.mockResolvedValue(dbPlace);

    const res = await request(app)
      .post('/api/v1/places')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'The Coffee House', city: 'Bangalore', category: 'cafe' });

    expect(res.status).toBe(201);
    expect(res.body.data.place).toMatchObject({ name: 'The Coffee House' });
    expect(res.body.data.wasDeduped).toBe(false);
  });

  it('returns existing place when a similar name is found (deduplication)', async () => {
    const similarRow = { ...dbPlace, id: SIMILAR_PLACE_ID, similarityScore: 0.91 };

    // $queryRaw returns the similar candidate
    db.$queryRaw.mockResolvedValue([similarRow]);
    // findById is called after findSimilar to fetch the full Place row
    db.place.findUnique.mockResolvedValue({ ...dbPlace, id: SIMILAR_PLACE_ID });

    const res = await request(app)
      .post('/api/v1/places')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'The Coffee Haus', city: 'Bangalore', category: 'cafe' });

    expect(res.status).toBe(200);
    expect(res.body.data.wasDeduped).toBe(true);
    expect(res.body.data.similarityScore).toBeGreaterThan(0.6);
  });

  it('returns 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/v1/places')
      .send({ name: 'The Coffee House', city: 'Bangalore' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when required fields are missing (no city)', async () => {
    const res = await request(app)
      .post('/api/v1/places')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'The Coffee House' });

    expect(res.status).toBe(400);
  });
});

// ── GET /places/:id ───────────────────────────────────────────────────────────

describe('GET /api/v1/places/:id', () => {
  it('returns a place by id', async () => {
    db.place.findUnique.mockResolvedValue(dbPlace);

    const res = await request(app).get(`/api/v1/places/${PLACE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: PLACE_ID, name: 'The Coffee House' });
  });

  it('returns 404 for an unknown id', async () => {
    db.place.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/places/nonexistent-id');
    expect(res.status).toBe(404);
  });
});
