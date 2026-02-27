import { CategoriesRepository } from '../repositories/categories.repository';

export class CategoriesService {
  constructor(private readonly repo: CategoriesRepository) {}

  async listCategories() {
    return this.repo.findAll();
  }
}
