/**
 * @file redis.ts
 * @description Singleton Redis client using ioredis.
 *
 *
 * Exported as a named singleton so every module reuses the same connection
 * pool rather than creating new connections on each import.
 */

import Redis, { RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

const createRedisClient = (): Redis => {
  const options: RedisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS ? {} : undefined,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 200, 10000);
      logger.warn(`Redis reconnect attempt #${times}, retrying in ${delay}ms`);
      return delay;
    },
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };

  const client = new Redis(options);

  client.on('connect', () => logger.info('Redis connected'));
  client.on('ready', () => logger.info('Redis ready'));
  client.on('error', (err) => logger.error('Redis error', { error: err.message }));
  client.on('close', () => logger.warn('Redis connection closed'));
  client.on('reconnecting', () => logger.warn('Redis reconnecting…'));

  return client;
};

// Singleton instances
export const redis = createRedisClient();

/**
 * Create a separate client for BullMQ subscriber connections.
 * BullMQ requires dedicated connections per Queue/Worker instance.
 */
export const createBullMQConnection = (): Redis => {
  const options: RedisOptions = {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    tls: env.REDIS_TLS ? {} : undefined,
    maxRetriesPerRequest: null, // REQUIRED by BullMQ
    enableReadyCheck: false,
  };
  return new Redis(options);
};
