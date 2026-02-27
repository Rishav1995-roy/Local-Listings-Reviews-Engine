import { Request, Response, NextFunction } from 'express';
import { FeedService } from '../services/feed.service';
import { FeedQueryDto } from '../dto/feed.dto';
import { sendPaginated } from '../../../utils/response';

const service = new FeedService();

export class FeedController {
  async getFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.getFeed(req.query as unknown as FeedQueryDto);
      sendPaginated(res, result);
    } catch (err) {
      next(err);
    }
  }
}
