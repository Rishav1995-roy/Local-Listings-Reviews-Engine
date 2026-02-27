/**
 * @file pagination.ts
 * @description Pagination utility used by repositories and feed endpoints.
 */

import { PaginationParams, PaginatedResult } from '../types';

export const parsePagination = (
  page: unknown,
  limit: unknown,
  maxLimit = 50,
): PaginationParams => {
  const parsedPage = Math.max(1, parseInt(String(page ?? 1), 10) || 1);
  const parsedLimit = Math.min(
    maxLimit,
    Math.max(1, parseInt(String(limit ?? 20), 10) || 20),
  );
  return {
    page: parsedPage,
    limit: parsedLimit,
    offset: (parsedPage - 1) * parsedLimit,
  };
};

export const buildPaginatedResult = <T>(
  data: T[],
  total: number,
  params: PaginationParams,
): PaginatedResult<T> => {
  const totalPages = Math.ceil(total / params.limit);
  return {
    data,
    meta: {
      total,
      page: params.page,
      limit: params.limit,
      totalPages,
      hasNextPage: params.page < totalPages,
      hasPrevPage: params.page > 1,
    },
  };
};
