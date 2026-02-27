/**
 * @file logger.ts
 * @description Winston logger configured for structured JSON logging.
 *
 * In development: pretty-printed console output.
 * In production: JSON to stdout (captured by CloudWatch agent) + optional
 * direct CloudWatch transport for log groups.
 */

import winston from 'winston';
import { env } from './env';

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// Human-readable format for local development
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
  }),
);

// Structured JSON format for production (CloudWatch, Datadog, etc.)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json(),
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  }),
];


// transport to avoid throttling and extra IAM permissions.
if (env.NODE_ENV === 'production' && env.CLOUDWATCH_LOG_GROUP) {
  // Dynamic import to avoid requiring aws-sdk in dev
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WinstonCloudWatch = require('winston-cloudwatch');
    transports.push(
      new WinstonCloudWatch({
        logGroupName: env.CLOUDWATCH_LOG_GROUP,
        logStreamName: env.CLOUDWATCH_LOG_STREAM ?? 'api-server',
        awsRegion: env.AWS_REGION,
        jsonMessage: true,
      }),
    );
  } catch {
    console.warn('winston-cloudwatch not available, skipping CloudWatch transport');
  }
}

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: {
    service: 'local-listings-api',
    env: env.NODE_ENV,
  },
  transports,
  exitOnError: false,
});
