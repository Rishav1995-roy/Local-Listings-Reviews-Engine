/**
 * @file auth.repository.ts
 * @description Data access layer for auth operations.
 *
 * All DB interactions for auth live here. Services never call Prisma directly,
 * which keeps business logic decoupled from the ORM and makes mocking easy.
 */

import { User, Role } from '@prisma/client';
import { prisma } from '../../../db/prisma';

export type UserWithRoles = User & { roles: { role: Role }[] };

export class AuthRepository {
  async findByEmail(email: string): Promise<UserWithRoles | null> {
    return prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });
  }

  async findById(id: string): Promise<UserWithRoles | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });
  }

  async createUser(data: {
    email: string;
    passwordHash: string;
    name: string;
    role: Role;
  }): Promise<UserWithRoles> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name,
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, role: data.role },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: true },
      });
    });
  }
}
