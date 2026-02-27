/**
 * Integration tests — Users module
 * GET /api/v1/users/me
 * GET /api/v1/users/:id
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';
import { userToken, TEST_USER_ID } from './helpers/jwtHelper';

const app = createApp();
const db = prisma as any;

const publicUser = {
  id: TEST_USER_ID,
  name: 'Alice',
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  _count: { reviews: 3 },
};

const meUser = {
  id: TEST_USER_ID,
  email: 'user@example.com',
  name: 'Alice',
  avatarUrl: null,
  createdAt: new Date().toISOString(),
  roles: [{ role: 'USER' }],
};

beforeEach(() => jest.clearAllMocks());

// ── GET /users/me ─────────────────────────────────────────────────────────────

describe('GET /api/v1/users/me', () => {
  it('returns the authenticated user profile', async () => {
    db.user.findUnique.mockResolvedValue(meUser);

    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: TEST_USER_ID,
      email: 'user@example.com',
    });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/users/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer not.a.valid.token');
    expect(res.status).toBe(401);
  });
});

// ── GET /users/:id ────────────────────────────────────────────────────────────

describe('GET /api/v1/users/:id', () => {
  it('returns a public user profile', async () => {
    db.user.findUnique.mockResolvedValue(publicUser);

    const res = await request(app).get(`/api/v1/users/${TEST_USER_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: TEST_USER_ID,
      name: 'Alice',
    });
  });

  it('returns 404 when user does not exist', async () => {
    db.user.findUnique.mockResolvedValue(null);

    const res = await request(app).get('/api/v1/users/nonexistent-id');
    expect(res.status).toBe(404);
  });
});
