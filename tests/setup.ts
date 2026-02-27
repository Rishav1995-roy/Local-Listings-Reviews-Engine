/**
 * @file tests/setup.ts
 * @description Jest global setup — runs before every test file.
 */

// Provide minimal env vars so config/env.ts doesn't exit(1)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/listings_test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.AWS_S3_BUCKET = 'test-bucket';
