/**
 * @file s3Upload.ts
 * @description Shared S3 client, multer configuration, and file upload helper.
 *
 * Used by the reviews endpoint to upload media files directly during review
 * submission (single-step flow).
 *
 * AWS S3 Production Setup:
 * ─────────────────────────
 * 1. Create S3 bucket with versioning, SSE, and block-all-public-access
 * 2. Attach IAM role with s3:PutObject / s3:GetObject on the bucket
 * 3. Set AWS_S3_BUCKET env var. In local dev use ~/.aws/credentials or env vars.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { AppError } from './ApiError';
import { env } from '../config/env';

// ── S3 Client singleton ────────────────────────────────────────
export const s3 = new S3Client({
  region: env.AWS_REGION,
  // In production on EC2, omit credentials and rely on the IAM instance profile.
  ...(env.AWS_ACCESS_KEY_ID && {
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!,
    },
  }),
});

// ── Multer — memory storage (buffer sent directly to S3) ───────
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only JPEG, PNG, and WebP images are allowed', 400, 'INVALID_FILE_TYPE'));
    }
  },
});

// ── Upload helper ──────────────────────────────────────────────
/**
 * Upload a single file buffer to S3 and return a 7-day pre-signed GET URL.
 */
export async function uploadFileToS3(
  file: Express.Multer.File,
  userId: string,
): Promise<{ url: string; s3Key: string; mimeType: string; sizeBytes: number }> {
  const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
  const s3Key = `uploads/${userId}/${uuid()}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.AWS_S3_BUCKET,
      Key: s3Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      // Tag for lifecycle rules (e.g. auto-delete orphaned uploads after 30 days)
      Tagging: `userId=${userId}&env=${env.NODE_ENV}`,
      ServerSideEncryption: 'AES256',
    }),
  );

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: s3Key }),
    { expiresIn: 7 * 24 * 60 * 60 },
  );

  return { url, s3Key, mimeType: file.mimetype, sizeBytes: file.size };
}
