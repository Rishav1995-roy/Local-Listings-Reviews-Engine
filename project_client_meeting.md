---
name: Client Meeting Status
description: Status of the client interview/meeting regarding the local listing review system codebase, includes full Q&A prep
type: project
---

# Client Meeting — Postponed

**Date noted:** 2026-03-12
**Status:** POSTPONED

## Context

The client interview/technical discussion regarding the **Local Listing & Review System** codebase has been postponed. Full codebase walkthrough and interview Q&A prep completed.

---

## Interview Q&A (Ready for Meeting)

### Architecture & Design

**Q: Why did you choose Clean Architecture?**
> Separation of concerns — controllers don't know about Prisma, repositories don't know about HTTP. Makes testing easy (mock the repository, test the service in isolation). Also scales well when modules grow.

**Q: What's the difference between your Service and Repository layers?**
> Repository = pure data access (Prisma queries only, no business logic). Service = business logic, orchestration (e.g., after creating a review, it also enqueues a BullMQ job and uploads to S3 — that coordination lives in the service, not the repository).

**Q: Why use the Repository pattern instead of calling Prisma directly from services?**
> Single point of change for queries. Easy to swap Prisma for raw SQL or a different ORM. Most importantly, in tests you can inject a mock repository without touching the database.

---

### Authentication

**Q: Explain your JWT two-token flow.**
> Access token (short-lived, 7d) for API calls. Refresh token (long-lived, 30d) to get a new access token without re-login. If access token is compromised, it expires quickly. Refresh tokens can be revoked.

**Q: How does RBAC work here?**
> Roles stored in a `UserRole` join table (userId + role, unique pair). `authenticate` middleware verifies JWT, attaches user to `req`. `authorize('ADMIN')` middleware checks `req.user.roles` array. This allows a user to have multiple roles.

**Q: Where are passwords stored?**
> Hashed using `bcryptjs` before storing in `passwordHash` column. Plain password never stored. On login, `bcrypt.compare()` checks the hash.

---

### Database & Prisma

**Q: How does place deduplication work?**
> Two-step:
> 1. `normalizePlaceName()` strips punctuation, lowercases, collapses spaces — so "Sweet Oven Bakery – Bangalore" → "sweet oven bakery bangalore"
> 2. PostgreSQL `pg_trgm` extension runs trigram similarity on normalized names. If similarity >= 0.6, it's a duplicate — returns existing place and sets `needsMergeReview=true`.

**Q: What is pg_trgm and why use it over LIKE?**
> pg_trgm breaks strings into 3-character sequences (trigrams) and computes overlap percentage. `LIKE '%bakery%'` is exact substring match — won't catch "Sweet Oven" vs "Swet Oven" (typo) or reordered words. pg_trgm handles fuzzy/approximate matching and is indexable with GIN index for performance.

**Q: How did you handle the PrismaClient singleton?**
> `global.__prisma` pattern — in development, ts-node-dev hot reloads modules but global scope persists. Without this, every file save would open a new DB connection pool, eventually exhausting connections. The singleton checks if `global.__prisma` already exists before creating a new instance.

**Q: What are the key indexes on the Review table?**
> `(placeId, status)` — most common query is "approved reviews for a place". `(status, createdAt DESC)` — for the feed. `userId` — for user's own reviews. These avoid full table scans on high-traffic queries.

---

### Async Jobs & BullMQ

**Q: Why use a job queue for AI moderation instead of doing it inline?**
> AI calls can take 2-5 seconds. Doing it inline would make POST /reviews slow and failure in the AI call would fail the whole request. With BullMQ, the review is saved immediately (201 returned), and moderation happens asynchronously. If the AI fails, BullMQ retries automatically.

**Q: What happens if the AI moderation worker crashes mid-job?**
> BullMQ uses Redis to persist job state. If the worker dies, the job remains in "active" state and will be re-queued on worker restart. Configured with `BULL_JOB_ATTEMPTS=3` retries with exponential backoff (5s → 10s → 20s). After 3 failures, job is moved to "failed" queue and review is flagged for human review.

**Q: How is the BullMQ connection different from the regular Redis connection?**
> BullMQ requires `maxRetriesPerRequest: null` on its ioredis connection — it blocks waiting for jobs. Regular Redis connections use default retry behavior. So `createBullMQConnection()` factory creates a dedicated connection with that setting, separate from the general `redis` singleton.

---

### File Upload / S3

**Q: Walk through the media upload flow.**
> 1. Request hits POST /reviews as `multipart/form-data`
> 2. `multer.array('files', 10)` middleware runs, stores files in memory (Buffer)
> 3. Zod validation runs next (`z.coerce.number()` for rating since multipart sends strings)
> 4. Service loops over `req.files`, calls `uploadFileToS3()` for each
> 5. S3 returns the object key, service creates `MediaUpload` records linked to the review
> 6. JSON requests (no files) pass through multer unchanged (no-op)

**Q: Why memory storage for multer instead of disk storage?**
> In containers/serverless, disk is ephemeral and may not persist. Memory storage pipes the file buffer directly to S3 without writing to disk. Keeps the container stateless.

---

### Feed Ranking

**Q: Explain the feed ranking algorithm.**
> Weighted score:
> - `0.4 × recency` — exponential decay: `e^(-0.05 × ageDays)`. Day 0 = 1.0, Day 14 ≈ 0.5, Day 30 ≈ 0.22
> - `0.3 × engagement` — `min(helpfulCount/50, 1.0)`. Capped so viral posts don't completely dominate
> - `0.2 × locationMatch` — boost if review is in the queried city
> - `0.1 × categoryMatch` — boost if category matches query
> - `- 0.5 × flaggedPenalty` — FLAGGED reviews score drops significantly but still appear

**Q: Why exponential decay for recency instead of linear?**
> Real-world content relevance drops fast initially then stabilizes. A 1-day-old review isn't twice as relevant as a 2-day-old one in a linear sense — the drop-off is steeper early and flattens out. `e^(-0.05t)` models this naturally.

**Q: What does `flaggedPenalty` mean in practice?**
> Flagged reviews are AI-uncertain (needs human review). They're not outright rejected, but you don't want them at the top of the feed. The 0.5 penalty drops them below comparable non-flagged reviews without hiding them entirely.

---

### Error Handling & Validation

**Q: How does the global error handler work?**
> Central `errorHandler.ts` middleware catches everything thrown in controllers/services. It differentiates:
> - `AppError` (operational) → expose message + status code to client
> - `ZodError` (validation) → map to field-level `{ field, message }` array, return 400
> - Prisma `P2002` (unique constraint) → return 409 Conflict
> - Prisma `P2025` (record not found) → return 404
> - Unknown errors → log full stack with Winston, return generic 500

**Q: Why use `z.coerce.number()` for rating?**
> `multipart/form-data` sends all fields as strings. `"4"` is not a number in TypeScript. `z.coerce.number()` converts the string to a number before validation, so `rating: "4"` becomes `rating: 4`. Without it, JSON requests work fine but multipart always fails validation.

---

### Testing

**Q: How do integration tests work without hitting real S3?**
> `jest.mock('@aws-sdk/client-s3')` and `jest.mock('@aws-sdk/s3-request-presigner')` in `reviews.test.ts`. The S3Client and `PutObjectCommand` are mocked to return success, so tests verify the full flow (DB records created, response shape) without actual S3 calls.

**Q: Why separate unit vs integration tests?**
> Unit tests (normalize, feedRanking, mockAiProvider) are pure functions — no DB, no network, run in milliseconds. Integration tests spin up a real PostgreSQL (test DB) and verify the full stack. Separating them lets you run `npm run test:unit` in 2 seconds during development, and run the full suite before merging.

**Q: How do integration tests authenticate?**
> `tests/integration/helpers/jwtHelper.ts` generates valid JWTs signed with the test `JWT_SECRET`. Tests create a user via POST /auth/register or directly in the DB via Prisma, then use `jwtHelper.generateToken(userId, roles)` to get a token for authenticated requests.

---

### System Design / Scaling

**Q: How would you scale this system?**
> - Horizontal API scaling — stateless (JWT, no server-side sessions), put behind a load balancer
> - Read replicas — feed/places queries hit read replica, writes go to primary
> - Redis caching — cache feed results per city+category (short TTL ~5min)
> - BullMQ concurrency — increase `BULL_CONCURRENCY` env var to process more moderation jobs in parallel
> - CDN for media — S3 + CloudFront for low-latency image serving

**Q: What's a potential bottleneck in the current design?**
> The feed query fetches all approved reviews for a city, computes ranking scores in JavaScript, then paginates. At scale, this moves to a pre-computed ranking score stored in DB (updated by a background job) and indexed for fast sorted queries.

**Q: How would you add real AI moderation (replacing the mock)?**
> The `IAiProvider` interface is already defined. Create `openai.provider.ts` or `anthropic.provider.ts` implementing `moderate(reviewText): Promise<ModerationResult>`. Set `AI_PROVIDER=openai` in env. The worker reads `AI_PROVIDER` env and instantiates the right provider — zero changes to worker logic.

---

### Quick-Fire Answers

| Question | Answer |
|----------|--------|
| Why Zod over Joi/Yup? | TypeScript-native, infers types from schemas — no duplicate type definitions |
| Why BullMQ over Bull? | Bull is deprecated; BullMQ is the maintained v5 rewrite with better TypeScript support |
| Why ioredis over node-redis? | BullMQ recommends ioredis; better cluster support |
| What does `needsMergeReview` flag do? | Signals admin that a place may be a duplicate — shows up in merge queue |
| What's `canonicalPlaceId`? | Self-referential FK — merged place points to the canonical (surviving) place record |
| How is rate limiting configured? | `express-rate-limit` with `RATE_LIMIT_WINDOW_MS` (900s) and `RATE_LIMIT_MAX` (100 req) env vars |
| What's in `/health`? | `{ status: "ok", env, timestamp }` — used by Docker healthcheck and load balancer probes |

---

## Next Steps

- Reschedule meeting with client
- Resume from this file when new date is confirmed — all prep is ready
