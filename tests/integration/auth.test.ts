/**
 * Integration tests — Auth module
 * POST /api/v1/auth/register
 * POST /api/v1/auth/login
 * POST /api/v1/auth/refresh
 */

jest.mock('@db/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
    },
    userRole: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashed.password.value'),
  compare: jest.fn().mockResolvedValue(true),
}));

import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../../src/app';
import { prisma } from '@db/prisma';
import { TEST_USER_ID, generateRefreshToken } from './helpers/jwtHelper';

const app = createApp();
const db = prisma as any;

const dbUser = {
  id: TEST_USER_ID,
  email: 'alice@example.com',
  passwordHash: '$2a$12$hashed.password.value',
  name: 'Alice',
  isActive: true,
  avatarUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  roles: [{ id: 'role-1', userId: TEST_USER_ID, role: 'USER' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  // Handle callback-form ($transaction(async tx => …)) and
  // array-form ($transaction([p1, p2]))
  db.$transaction.mockImplementation(async (arg: any) => {
    if (typeof arg === 'function') return arg(db);
    return Promise.all(arg);
  });
});

// ── Register ──────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  it('creates a new account and returns tokens', async () => {
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(dbUser);
    db.userRole.create.mockResolvedValue({});
    db.user.findUniqueOrThrow.mockResolvedValue(dbUser);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
      role: 'user',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      user: { email: 'alice@example.com', name: 'Alice', roles: ['USER'] },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it('accepts role admin and creates an admin account', async () => {
    const adminUser = { ...dbUser, roles: [{ id: 'role-2', userId: TEST_USER_ID, role: 'ADMIN' }] };
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(adminUser);
    db.userRole.create.mockResolvedValue({});
    db.user.findUniqueOrThrow.mockResolvedValue(adminUser);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'boss@example.com',
      password: 'Password1',
      name: 'Boss',
      role: 'admin',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.user.roles).toContain('ADMIN');
  });

  it('returns 409 when email already exists', async () => {
    db.user.findUnique.mockResolvedValue(dbUser);

    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
      role: 'user',
    });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when role is missing', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid role value', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      password: 'Password1',
      name: 'Alice',
      role: 'moderator', // not allowed at registration
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for a weak password', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      password: 'weak',
      name: 'Alice',
      role: 'user',
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: 'alice@example.com',
      role: 'user',
    });

    expect(res.status).toBe(400);
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
  it('returns tokens on valid credentials', async () => {
    db.user.findUnique.mockResolvedValue(dbUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'alice@example.com',
      password: 'Password1',
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it('returns 401 for wrong password', async () => {
    db.user.findUnique.mockResolvedValue(dbUser);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'alice@example.com',
      password: 'WrongPass1',
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent email (timing-safe, same error)', async () => {
    db.user.findUnique.mockResolvedValue(null);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'nobody@example.com',
      password: 'Password1',
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for an inactive account', async () => {
    db.user.findUnique.mockResolvedValue({ ...dbUser, isActive: false });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'alice@example.com',
      password: 'Password1',
    });

    expect(res.status).toBe(401);
  });

  it('returns 400 for missing body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});
    expect(res.status).toBe(400);
  });
});

// ── Refresh ───────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
  it('returns a new token pair for a valid refresh token', async () => {
    db.user.findUnique.mockResolvedValue(dbUser);

    const refreshToken = generateRefreshToken(dbUser.id, dbUser.email, ['USER']);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it('returns 401 for a tampered refresh token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'totally.invalid.token' });

    expect(res.status).toBe(401);
  });

  it('returns 400 when refreshToken field is missing', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(400);
  });
});
