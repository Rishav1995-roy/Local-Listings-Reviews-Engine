/**
 * @file auth.controller.ts
 * @description Express route handlers for auth endpoints.
 *
 * Controllers are thin: they extract request data, call the service, and
 * format the response. No business logic lives here.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuthRepository } from '../repositories/auth.repository';
import { RegisterDto, LoginDto, RefreshTokenDto } from '../dto/auth.dto';
import { sendSuccess, sendCreated } from '../../../utils/response';

// Lazy-instantiate (could use a DI container in a larger codebase)
const authService = new AuthService(new AuthRepository());

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = req.body as RegisterDto;
      const result = await authService.register(dto);
      sendCreated(res, result, 'Account created successfully');
    } catch (err) {
      next(err);
    }
  }

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = req.body as LoginDto;
      const result = await authService.login(dto);
      sendSuccess(res, result, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body as RefreshTokenDto;
      const tokens = await authService.refreshToken(refreshToken);
      sendSuccess(res, tokens, 'Tokens refreshed');
    } catch (err) {
      next(err);
    }
  }
}
