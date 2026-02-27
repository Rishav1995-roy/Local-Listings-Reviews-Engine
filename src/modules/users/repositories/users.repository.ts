import { prisma } from '../../../db/prisma';

export class UsersRepository {
  async findMe(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        roles: { select: { role: true } },
      },
    });
  }

  async findById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        createdAt: true,
        _count: { select: { reviews: true } },
      },
    });
  }

  async update(userId: string, data: { name?: string; avatarUrl?: string }) {
    return prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        updatedAt: true,
      },
    });
  }
}
