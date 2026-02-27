import { Request, Response, NextFunction } from 'express';
import { UsersService } from '../services/users.service';
import { UsersRepository } from '../repositories/users.repository';
import { UpdateUserDto } from '../dto/users.dto';
import { AuthenticatedRequest } from '../../../types';
import { sendSuccess } from '../../../utils/response';

const service = new UsersService(new UsersRepository());

export class UsersController {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const user = await service.getMe(userId);
      sendSuccess(res, user);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await service.getById(req.params.id);
      sendSuccess(res, user);
    } catch (err) {
      next(err);
    }
  }

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = (req as AuthenticatedRequest).user.sub;
      const user = await service.updateMe(userId, req.body as UpdateUserDto);
      sendSuccess(res, user, 'Profile updated');
    } catch (err) {
      next(err);
    }
  }
}
