import { AppError } from '../../../utils/ApiError';
import { UpdateUserDto } from '../dto/users.dto';
import { UsersRepository } from '../repositories/users.repository';

export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getMe(userId: string) {
    const user = await this.repo.findMe(userId);
    if (!user) throw AppError.notFound('User');
    return {
      ...user,
      roles: user.roles.map((r) => r.role),
    };
  }

  async getById(userId: string) {
    const user = await this.repo.findById(userId);
    if (!user) throw AppError.notFound('User');
    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    return this.repo.update(userId, dto);
  }
}
