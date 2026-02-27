import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars-long';

export function generateAccessToken(sub: string, email: string, roles: string[]): string {
  return jwt.sign({ sub, email, roles }, JWT_SECRET, { expiresIn: '1h' });
}

export function generateRefreshToken(sub: string, email: string, roles: string[]): string {
  return jwt.sign({ sub, email, roles }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
}

// Proper UUID v4 format required by Zod uuid() validation
export const TEST_USER_ID  = '11111111-1111-4111-a111-111111111111';
export const TEST_ADMIN_ID = '22222222-2222-4222-a222-222222222222';

export const userToken  = generateAccessToken(TEST_USER_ID,  'user@example.com',  ['USER']);
export const adminToken = generateAccessToken(TEST_ADMIN_ID, 'admin@example.com', ['ADMIN']);
