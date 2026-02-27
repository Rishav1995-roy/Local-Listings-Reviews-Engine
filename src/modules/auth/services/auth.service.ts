/**
 * @file auth.service.ts
 * @description Business logic for authentication.
 *
 * Responsibilities:
 * - Password hashing (bcrypt, cost factor 12)
 * - JWT generation (access + refresh tokens)
 * - Login / register flow
 * - Token refresh flow
 *
 * Security decisions:
 * - bcrypt cost factor 12 balances security vs. latency on a t3.medium EC2
 * - Access token TTL: 7d (configurable). Refresh token: 30d.
 * - We do NOT store refresh tokens in DB for now (stateless). For production
 *   with revocation support, store in Redis with TTL and check on refresh.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { AuthRepository } from '../repositories/auth.repository';
import { RegisterDto, LoginDto } from '../dto/auth.dto';
import { AppError } from '../../../utils/ApiError';
import { env } from '../../../config/env';
import { JwtPayload } from '../../../types';

const BCRYPT_ROUNDS = 12;

export class AuthService {
  constructor(private readonly authRepo: AuthRepository) {}

  async register(dto: RegisterDto) {
    // Check for existing account
    const existing = await this.authRepo.findByEmail(dto.email);
    if (existing) {
      throw AppError.conflict('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.authRepo.createUser({
      email: dto.email,
      passwordHash,
      name: dto.name,
      role: dto.role.toUpperCase() as Role,
    });

    const roles = user.roles.map((r) => r.role);
    const tokens = this.generateTokenPair(user.id, user.email, roles);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
      },
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.authRepo.findByEmail(dto.email);

    // Timing-safe: always run bcrypt even if user not found to prevent
    // user enumeration via timing attacks
    const passwordHash = user?.passwordHash ?? '$2a$12$placeholder.hash.to.prevent.timing.attacks';
    const isValid = await bcrypt.compare(dto.password, passwordHash);

    if (!user || !isValid || !user.isActive) {
      throw AppError.unauthorized('Invalid email or password');
    }

    const roles = user.roles.map((r) => r.role);
    const tokens = this.generateTokenPair(user.id, user.email, roles);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles,
      },
      ...tokens,
    };
  }

  async refreshToken(token: string) {
    try {
      const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
      const user = await this.authRepo.findById(payload.sub);

      if (!user || !user.isActive) {
        throw AppError.unauthorized('User not found or inactive');
      }

      const roles = user.roles.map((r) => r.role);
      return this.generateTokenPair(user.id, user.email, roles);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.unauthorized('Invalid or expired refresh token');
    }
  }

  // ── Private helpers ───────────────────────────────────────

  private generateTokenPair(userId: string, email: string, roles: Role[]) {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      roles,
    };

    const accessToken = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });

    return { accessToken, refreshToken };
  }
}
