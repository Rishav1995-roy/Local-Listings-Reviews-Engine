/**
 * @file response.ts
 * @description Standardised API response helpers.
 * All controllers use these functions so response shapes are consistent
 * across every endpoint — no ad-hoc { data: ... } objects in controllers.
 */

import { Response } from 'express';
import { ApiResponse, PaginatedResult } from '../types';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
): void => {
  const body: ApiResponse<T> = { success: true, data, message };
  res.status(statusCode).json(body);
};

export const sendCreated = <T>(res: Response, data: T, message?: string): void => {
  sendSuccess(res, data, message, 201);
};

export const sendPaginated = <T>(
  res: Response,
  result: PaginatedResult<T>,
  message?: string,
): void => {
  res.status(200).json({ success: true, ...result, message });
};

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};
