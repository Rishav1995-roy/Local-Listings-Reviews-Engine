import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service';
import { AdminRepository } from '../repositories/admin.repository';
import { ModerationNoteDto, MergePlaceDto, AdminQueryDto } from '../dto/admin.dto';
import { AuthenticatedRequest } from '../../../types';
import { sendSuccess, sendPaginated } from '../../../utils/response';

const service = new AdminService(new AdminRepository());

export class AdminController {
  async getModerationQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.getModerationQueue(req.query as unknown as AdminQueryDto);
      sendPaginated(res, result);
    } catch (err) {
      next(err);
    }
  }

  async approveReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const moderatorId = (req as AuthenticatedRequest).user.sub;
      const updated = await service.approveReview(req.params.id, moderatorId, req.body as ModerationNoteDto);
      sendSuccess(res, updated, 'Review approved');
    } catch (err) {
      next(err);
    }
  }

  async rejectReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const moderatorId = (req as AuthenticatedRequest).user.sub;
      const updated = await service.rejectReview(req.params.id, moderatorId, req.body as ModerationNoteDto);
      sendSuccess(res, updated, 'Review rejected');
    } catch (err) {
      next(err);
    }
  }

  async getMergeQueue(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.getMergeQueue(req.query as unknown as AdminQueryDto);
      sendPaginated(res, result);
    } catch (err) {
      next(err);
    }
  }

  async mergePlaces(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.mergePlaces(req.params.id, req.body as MergePlaceDto);
      sendSuccess(res, result, 'Places merged successfully');
    } catch (err) {
      next(err);
    }
  }
}
