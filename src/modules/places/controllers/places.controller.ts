import { Request, Response, NextFunction } from 'express';
import { PlacesService } from '../services/places.service';
import { PlacesRepository } from '../repositories/places.repository';
import { CreatePlaceDto, PlacesQueryDto } from '../dto/places.dto';
import { sendCreated, sendSuccess, sendPaginated } from '../../../utils/response';

const service = new PlacesService(new PlacesRepository());

export class PlacesController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.findOrCreate(req.body as CreatePlaceDto);
      if (result.wasDeduped) {
        sendSuccess(res, result, 'Matched existing place (deduplication applied)', 200);
      } else {
        sendCreated(res, result, 'Place created');
      }
    } catch (err) {
      next(err);
    }
  }

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await service.listPlaces(req.query as unknown as PlacesQueryDto);
      sendPaginated(res, result);
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const place = await service.getPlaceById(req.params.id);
      sendSuccess(res, place);
    } catch (err) {
      next(err);
    }
  }
}
