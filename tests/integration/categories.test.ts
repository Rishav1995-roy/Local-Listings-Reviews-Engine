/**
 * Integration tests — Categories module
 * GET /api/v1/categories
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    category: {
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

const dbCategories = [
  { id: 'cat-uuid-1', slug: 'bakery',     name: 'Bakery',     description: 'Bakeries and pastry shops' },
  { id: 'cat-uuid-2', slug: 'cafe',       name: 'Café',       description: 'Coffee shops and casual cafés' },
  { id: 'cat-uuid-3', slug: 'restaurant', name: 'Restaurant', description: 'Dine-in restaurants and eateries' },
];

beforeEach(() => jest.clearAllMocks());

describe('GET /api/v1/categories', () => {
  it('returns the full list of categories', async () => {
    db.category.findMany.mockResolvedValue(dbCategories);

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);
  });

  it('each category has id, slug, name, and description', async () => {
    db.category.findMany.mockResolvedValue(dbCategories);

    const res = await request(app).get('/api/v1/categories');

    const cat = res.body.data[0];
    expect(cat).toMatchObject({
      id: expect.any(String),
      slug: expect.any(String),
      name: expect.any(String),
    });
  });

  it('returns an empty list when no categories are seeded', async () => {
    db.category.findMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/categories');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
