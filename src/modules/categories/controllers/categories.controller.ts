import { Request, Response, NextFunction } from 'express';
import { CategoriesService } from '../services/categories.service';
import { CategoriesRepository } from '../repositories/categories.repository';
import { sendSuccess } from '../../../utils/response';

const service = new CategoriesService(new CategoriesRepository());

export class CategoriesController {
  async list(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const categories = await service.listCategories();
      sendSuccess(res, categories);
    } catch (err) {
      next(err);
    }
  }
}
