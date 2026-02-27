import { prisma } from '../../../db/prisma';

export class CategoriesRepository {
  async findAll() {
    return prisma.category.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, description: true },
    });
  }
}
