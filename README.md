# Local Listings + Reviews Engine

A production-grade API-first backend for managing local business listings, user reviews, and AI-assisted content moderation.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        AWS Cloud                             │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Route53 │───▶│  CloudFront  │───▶│  EC2 (Node API)  │   │
│  └──────────┘    └──────────────┘    │  + BullMQ Worker │   │
│                                      └────────┬─────────┘   │
│                                               │              │
│              ┌────────────────────────────────┤              │
│              │                                │              │
│              ▼                                ▼              │
│   ┌─────────────────┐              ┌─────────────────┐      │
│   │  RDS PostgreSQL  │              │  ElastiCache     │      │
│   │  (Multi-AZ)      │              │  Redis           │      │
│   │  pg_trgm ext.    │              │  (BullMQ queues) │      │
│   └─────────────────┘              └─────────────────┘      │
│                                                              │
│   ┌─────────────────┐    ┌─────────────────────────────┐    │
│   │    S3 Bucket     │    │       CloudWatch Logs        │    │
│   │  (media uploads) │    │  /local-listings/api stream  │    │
│   └─────────────────┘    └─────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Stack:** Node.js 20 + TypeScript 5, Express 4, Prisma 5 (PostgreSQL), BullMQ 5, ioredis 5, AWS SDK v3, JWT, bcrypt, Zod, Winston.

---

## Database Schema Design

### Key Design Decisions

| Decision | Rationale |
|---|---|
| UUID primary keys | No sequential ID guessing, works across distributed writes |
| `normalized_name` column | Pre-computed lowercase+stripped name for trgm similarity |
| Separate `UserRole` table | One user can have multiple roles (USER + ADMIN simultaneously) |
| `Category` lookup table | Normalised category dictionary seeded at deploy-time; `Place.categoryId` FK enforces referential integrity while `Place.category` (slug string) is kept as a denormalised mirror for fast raw SQL trgm queries |
| `Tag` + `ReviewTag` join table | Normalised tag dictionary — AI worker upserts tags and links them to reviews via the many-to-many `ReviewTag` table; enables tag analytics (top tags per city, tag-based filtering) without scanning JSON arrays |
| `ModerationJob` table | Full audit trail of AI decisions; supports re-processing |
| `MediaUpload` separate table | Owns S3 key + bucket; linked to review at upload time |

### Relationships
```
User ──< UserRole            (one user, many roles)
User ──< Review              (one user, many reviews)
User ──< MediaUpload         (one user, many uploads)
Category ──< Place           (one category, many places)
Place ──< Review             (one place, many reviews)
Review ──< ModerationJob     (one review, one job record)
Review ──< MediaUpload       (one review, many images)
Review ──< ReviewTag ──> Tag (many-to-many via join table)
Place ──> Place              (self-referential: duplicate → canonical)
```

---

## Media Upload Flow

Media is handled in a **single step** — files are submitted together with the review in one multipart request:

```
POST /api/v1/reviews
  Content-Type: multipart/form-data
  Authorization: Bearer <token>
  Fields:
    placeId   (UUID)    ← OR placeName + city
    rating    (1–5)
    text      (string, min 10 chars)
    files[]   (optional, up to 10 images — JPEG/PNG/WebP, max 5 MB each)

Server action:
  1. Validate form fields via Zod
  2. Upload each file to S3 (PutObject)
  3. Generate a 7-day pre-signed GET URL per file
  4. Create MediaUpload record in DB, linked to the new review
  5. Proceed with AI moderation job
  6. Return 201 immediately
```

**Why single-step?**
- Simpler client: one request to submit a review, no pre-upload handshake needed
- multer (memory storage) buffers files, uploads directly to S3 — no disk I/O
- If the review fails validation, no files are uploaded (fail-fast)
- For plain JSON requests (no files), multer is a no-op — existing clients unaffected

---

## Place Deduplication Logic

### Problem
Users submit places with slight variations in name or punctuation:
- `"Sweet Oven Bakery – Bangalore"`
- `"Sweet-Oven Bakery – Bangalore"`
- `"Sweet Oven Bakery, Bangalore"`

### Solution: pg_trgm Trigram Similarity

**Normalisation step:**
```
Input:  "Sweet-Oven Bakery – Bangalore"
After:  "sweet oven bakery bangalore"
         ↓ lowercase
         ↓ replace [–-/] with space
         ↓ strip non-alphanumeric
         ↓ collapse spaces
```

**Similarity query:**
```sql
SELECT
  id, name, similarity(normalized_name, 'sweet oven bakery bangalore') AS score
FROM places
WHERE city ILIKE 'Bangalore'
  AND status != 'MERGED'
  AND similarity(normalized_name, 'sweet oven bakery bangalore') >= 0.6
ORDER BY score DESC
LIMIT 10;
```

**Decision:**
- `score >= 0.6` → Return existing place (deduplicated, `wasDeduped: true`)
- `score < 0.6`  → Create new place with `needs_merge_review = true` → Admin reviews

**Threshold tuning:** Set `SIMILARITY_THRESHOLD` in `.env`. Lower = more aggressive dedup (more false positives). Higher = less dedup (more duplicates slip through). `0.6` is empirically good for business names.

### Sample Deduplication Pairs (from test inputs)

| Input A | Input B | Expected |
|---|---|---|
| `Dr Sharma Pediatric Clinic – Pune` | `Sharma Clinic Pune – Pune` | Same city, score ~0.55 → new + flag |
| `Sweet Oven Bakery – Bangalore` | `Sweet-Oven Bakery – Bangalore` | Normalize → identical → deduped |
| `Sunrise Therapy Center – Mumbai` | `Sunrise Therapy Ctr Mumbai` | score ~0.72 → deduped |
| `Digital Growth Experts – Pune` | (spam text) | Different concern — caught by AI |

---

## AI Moderation Pipeline

```
POST /reviews
     │
     ▼
Create Review (status=PENDING)
     │
     ▼
Upload files to S3 + create MediaUpload records (if files attached)
     │
     ▼
Create ModerationJob (DB record)
     │
     ▼
Enqueue BullMQ Job ──────────────────────────────────────┐
     │                                                     │
     ▼                                                     │
Return 201 to client immediately                           │
(API does NOT wait for AI)                                 │
                                                           ▼
                                               ┌──────────────────────┐
                                               │   BullMQ Worker       │
                                               │   (async process)     │
                                               │                       │
                                               │  Call AI Provider     │
                                               │  (mock/openai/claude) │
                                               │                       │
                                               │  Labels:              │
                                               │  safe → APPROVED      │
                                               │  spam → REJECTED      │
                                               │  toxic → REJECTED     │
                                               │  self_promo → REJECTED│
                                               │  medical_risk → FLAGGED│
                                               │  needs_human → FLAGGED │
                                               │                       │
                                               │  Auto-generates:      │
                                               │  • tags               │
                                               │  • short summary      │
                                               │                       │
                                               │  Update review +      │
                                               │  moderation job in DB │
                                               └──────────────────────┘
```

### BullMQ Retry Strategy
- Max attempts: 3
- Backoff: exponential (5s → 10s → 20s)
- After all retries fail: review status → `FLAGGED` (human takes over)

### Sample Moderation Outcomes

| Input text / place | Expected label |
|---|---|
| `Sweet Oven Bakery` — positive food review | `safe` → APPROVED |
| `Digital Growth Experts` — "Visit us at my website for deals!" | `self_promo` → REJECTED |
| `QuickLoan Services` — "Click here, limited offer, buy now!" | `spam` → REJECTED |
| `Local Wellness Center` — "This cured my diabetes, doctor approved!" | `medical_risk` → FLAGGED |
| `Sunrise Therapy Center` — aggressive language | `toxic` → REJECTED |
| Very short review ("ok") | `needs_human_review` → FLAGGED |

---

## Feed Ranking Algorithm

```
score = (0.4 × recency_score)
      + (0.3 × engagement_score)
      + (0.2 × location_match)
      + (0.1 × category_match)
      - flagged_penalty
```

| Component | Formula | Example (3d old, 20 votes, city+cat match) |
|---|---|---|
| recency_score | e^(-0.05 × age_days) | e^(-0.15) = 0.86 |
| engagement_score | min(helpful/50, 1.0) | 20/50 = 0.40 |
| location_match | 1.0 (city match) | 1.0 |
| category_match | 1.0 if match, 0.0 else | 1.0 |
| flagged_penalty | 0.5 if ever flagged | 0 |
| **Final score** | weighted sum | **0.764** |

---

## Indexing Strategy

```sql
-- Primary lookup indexes (created by Prisma migrations)
CREATE INDEX idx_reviews_place_status ON reviews(place_id, status);
CREATE INDEX idx_reviews_user        ON reviews(user_id);
CREATE INDEX idx_reviews_created     ON reviews(created_at DESC);
CREATE INDEX idx_places_city_cat     ON places(city, category);
CREATE INDEX idx_places_status       ON places(status);
CREATE INDEX idx_media_user          ON media_uploads(user_id);
CREATE INDEX idx_media_review        ON media_uploads(review_id);

-- Trigram indexes (created in 001_pg_trgm_setup.sql)
CREATE INDEX idx_places_name_trgm ON places USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX idx_places_city_trgm ON places USING GIN (city gin_trgm_ops);
```

**Query patterns covered:**
- Feed: `WHERE place.city = X AND status = 'APPROVED'` → `idx_reviews_place_status`
- User profile reviews: `WHERE user_id = X` → `idx_reviews_user`
- Deduplication: `similarity(normalized_name, ?)` → `idx_places_name_trgm` (GIN)
- Admin queue: `WHERE status = 'FLAGGED'` → `idx_reviews_place_status`
- Media lookup by review: `WHERE review_id = X` → `idx_media_review`

---

## Scaling Plan (100k Users)

### Phase 1: Current Architecture (0–10k users)
- Single EC2 t3.medium
- RDS db.t3.medium (Single-AZ)
- ElastiCache cache.t3.micro (single node)

### Phase 2: Horizontal Scale (10k–100k users)
- **API**: ECS Fargate with auto-scaling (2–10 tasks)
- **DB**: RDS db.r6g.large (Multi-AZ, read replica for feed queries)
- **Redis**: ElastiCache cluster mode (2 shards × 1 replica)
- **Workers**: Separate ECS task for BullMQ workers (scale independently)
- **CDN**: CloudFront in front of API for GET endpoints (cache TTL: 60s for feed)

### Phase 3: 100k+ users
- **Read replicas**: Route feed reads to RDS read replica
- **Feed caching**: Cache ranked feed per city/category in Redis (TTL: 5min)
- **Media**: CloudFront distribution over S3 (eliminate pre-signed URL latency)
- **DB sharding**: Partition reviews by `created_at` (monthly partitions)

---

## API Reference

### Auth
| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/api/v1/auth/register` | None | `{ email, password, name, role: "user"\|"admin" }` |
| POST | `/api/v1/auth/login` | None | `{ email, password }` |
| POST | `/api/v1/auth/refresh` | None | `{ refreshToken }` |

> `role` is required at registration. Only `"user"` or `"admin"` are accepted.

### Categories
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/categories` | None | List all predefined categories (slug + name). Use the slug as the `category` field when submitting reviews or places. |

### Places
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/places` | None | List places (`?city=&category=&page=&limit=`) |
| POST | `/api/v1/places` | USER | Create/find place (dedup applied). `category` should be a slug from `/categories`. |
| GET | `/api/v1/places/:id` | None | Get place detail |

### Reviews
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/reviews` | USER | Submit review (multipart/form-data). Optional `files[]` uploaded to S3 inline. AI moderation is async. |
| GET | `/api/v1/reviews` | None | List reviews (`?placeId=&userId=&status=&page=&limit=`) |
| GET | `/api/v1/reviews/:id` | None | Get review with user, place, media |

### Feed
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/feed?city=X` | None | Ranked feed (`city` required, `category` optional) |

### Admin
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/admin/moderation-queue` | ADMIN/MOD | FLAGGED reviews (oldest first) |
| PATCH | `/api/v1/admin/reviews/:id/approve` | ADMIN/MOD | Approve with optional note |
| PATCH | `/api/v1/admin/reviews/:id/reject` | ADMIN/MOD | Reject with optional note |
| GET | `/api/v1/admin/places/merge-queue` | ADMIN/MOD | Places pending merge review |
| POST | `/api/v1/admin/places/:id/merge` | ADMIN/MOD | `{ canonicalPlaceId }` |

### Media
Media files are submitted as part of `POST /api/v1/reviews` via the `files[]` multipart field. There is no separate upload endpoint.

---

## Local Development

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20+ | Use `nvm use 20` if you have nvm |
| Docker + Docker Compose | Any recent | Only needed for Postgres + Redis |
| npm | 9+ | Comes with Node 20 |

---

### Step-by-step setup

#### 1. Clone and enter the backend directory
```bash
git clone <repo-url>
cd backend
```

#### 2. Install dependencies
```bash
npm install
```

#### 3. Create your `.env` file
```bash
cp .env.example .env
```

The defaults in `.env.example` work out of the box for local development.
The only values you **must** set are the two JWT secrets — replace the placeholders:
```env
JWT_SECRET=any-random-string-at-least-32-chars-long
JWT_REFRESH_SECRET=another-random-string-at-least-32-chars
```

Generate them quickly with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run it twice — once for each secret.

#### 4. Start Postgres and Redis with Docker
```bash
docker-compose up -d postgres redis
```

This starts:
- **PostgreSQL 16** on `localhost:5432` (user: `postgres`, password: `postgres`, db: `listings_db`)
- **Redis 7** on `localhost:6379`

Verify they are healthy:
```bash
docker-compose ps
```

#### 5. Set up the database
```bash
# Run the pg_trgm extension SQL first (required for fuzzy deduplication)
# This is idempotent — safe to run multiple times
npm run prisma:migrate
```

If it's a fresh database run:
```bash
npm run prisma:generate   # generates the TypeScript client
npm run prisma:migrate    # runs all migrations including pg_trgm setup
npm run prisma:seed       # seeds the 17 standard categories
```

#### 6. Start the API
```bash
npm run dev
```

The server starts on `http://localhost:3000`. You should see:
```
info: Database connected
info: BullMQ moderation worker started
info: Server running on port 3000
```

Health check:
```bash
curl http://localhost:3000/health
# → { "status": "ok", "env": "development", ... }
```

---

### AI Provider — no API key needed for local dev

The project ships with a **mock AI provider** that runs fully in-process — no external API call, no account, no cost.

**How it works:**
```
Review text → MockAiProvider.moderate()
  ├── scans for SPAM keywords    ("buy now", "click here", …)     → spam
  ├── scans for TOXIC keywords   ("hate", "disgusting", …)        → toxic
  ├── scans for MEDICAL keywords ("cure", "doctor recommended", …) → medical_risk
  ├── scans for SELF_PROMO       ("visit us", "my business", …)   → self_promo
  ├── text < 30 chars                                              → needs_human_review
  └── none of the above                                           → safe
```

It also auto-generates tags from a category dictionary and a 120-character summary.

**To use the mock** (already the default), your `.env` should have:
```env
AI_PROVIDER=mock
# AI_API_KEY and AI_MODEL are ignored when provider=mock
```

**To switch to a real provider** in the future, update:
```env
AI_PROVIDER=openai       # or: anthropic
AI_API_KEY=sk-...        # your real API key
AI_MODEL=gpt-4o-mini     # or whatever model you want
```
Then implement `OpenAiProvider` in `src/workers/ai-providers/` implementing the `IAiProvider` interface — the worker will pick it up automatically via the `getAiProvider()` factory.

---

### AWS S3 — optional for local dev

S3 is only needed when you attach image files to a review (`POST /reviews` with `files[]`).

**To skip S3** (everything except file uploads works):
```env
# Leave these blank in .env — S3 client will be created but never called
# unless you actually send a file
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

**To use real S3** (for testing file upload end-to-end):
```env
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=your-bucket-name
```

Create the bucket with:
```bash
aws s3 mb s3://your-bucket-name --region ap-south-1
# Block public access (required — API uses pre-signed URLs instead)
aws s3api put-public-access-block \
  --bucket your-bucket-name \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

---

### Run with Docker (all-in-one)

To run the API + Postgres + Redis all inside Docker:
```bash
docker-compose up -d
```

The API is available at `http://localhost:3000`.

To follow logs:
```bash
docker-compose logs -f api
```

---

### Run Tests
```bash
npm run test:unit         # Unit tests only (dedupe + feed ranking + AI provider)
npm run test:integration  # Integration tests (all HTTP endpoints, mocked DB + mocked S3)
npm test                  # All tests
npm run test:coverage     # With coverage report
```

Tests **do not need** a running database, Redis, or S3. All external systems are mocked via `jest.mock()`.

---

## End-to-End Testing Walkthrough

This walkthrough demonstrates all key features using realistic test inputs: deduplication, AI moderation labeling, tagging, and feed ranking.

### Prerequisites

Make sure the server is running:
```bash
docker-compose up -d postgres redis
npm run dev
# → info: Server running on port 3000
```

> **macOS note:** If Redis throws `ETIMEDOUT`, set `REDIS_HOST=127.0.0.1` in `.env` (macOS prefers IPv6 for `localhost`; use the explicit IPv4 loopback instead).

---

### Step 1 — Register accounts

```bash
# Regular user
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"user@example.com","password":"Password123!"}' | jq .

# Admin user
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@example.com","password":"Password123!"}' | jq .
```

Save the `accessToken` values — you'll need them below.

> To promote the admin user, run this SQL against the local DB:
> ```sql
> INSERT INTO user_roles (id, user_id, role, created_at)
> SELECT gen_random_uuid(), id, 'ADMIN', NOW() FROM users WHERE email = 'admin@example.com';
> ```
> Via Docker: `docker exec -it listings_postgres psql -U postgres -d listings_db`

---

### Step 2 — Deduplication: same place, different names

Submit the same bakery twice with slightly different name formatting:

```bash
# First submission — creates the place
curl -s -X POST http://localhost:3000/api/v1/places \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"name":"Sweet Oven Bakery","address":"12 MG Road","city":"Bangalore","state":"Karnataka","country":"India","category":"bakery"}' | jq '{id:.data.id, wasDeduped:.data.wasDeduped}'

# Second submission — hyphen variant, should deduplicate to the same place
curl -s -X POST http://localhost:3000/api/v1/places \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"name":"Sweet-Oven Bakery","address":"12 MG Road","city":"Bangalore","state":"Karnataka","country":"India","category":"bakery"}' | jq '{id:.data.id, wasDeduped:.data.wasDeduped}'
```

**Expected:** Both calls return the **same place ID**. The second response shows `wasDeduped: true`.

```bash
# Different enough name — creates a new place and flags it for merge review
curl -s -X POST http://localhost:3000/api/v1/places \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"name":"Dr Sharma Pediatric Clinic","address":"5 FC Road","city":"Pune","state":"Maharashtra","country":"India","category":"clinic"}' | jq .

curl -s -X POST http://localhost:3000/api/v1/places \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"name":"Sharma Clinic Pune","address":"5 FC Road","city":"Pune","state":"Maharashtra","country":"India","category":"clinic"}' | jq .
```

**Expected:** Two separate places created, both with `status: NEEDS_MERGE_REVIEW` (similarity ~0.55, below the 0.6 threshold).

---

### Step 3 — AI Moderation: all label types

Use the place ID from Step 2. Replace `PLACE_ID` and `USER_TOKEN` with your values.

```bash
# 1. SAFE → APPROVED  (normal positive review)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":5,"body":"Amazing croissants and fresh bread every morning. The staff is warm and the pricing is fair. Will come back every week!"}' | jq '{id:.data.id, status:.data.status}'

# 2. SPAM → REJECTED  (QuickLoan scam keywords)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":5,"body":"Click here for a free offer! Buy now, limited time deal. Subscribe to get 50% off today!"}' | jq '{id:.data.id, status:.data.status}'

# 3. SELF_PROMO → REJECTED  (Digital Growth Experts promotional text)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":5,"body":"Visit us at my business for great deals. Check us out at our store, we have the best offers in town!"}' | jq '{id:.data.id, status:.data.status}'

# 4. MEDICAL_RISK → FLAGGED  (Local Wellness Center unsafe claims)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":4,"body":"This place has a special treatment that heals chronic pain. Doctor recommended their cure and it worked for my medical condition!"}' | jq '{id:.data.id, status:.data.status}'

# 5. TOXIC → REJECTED  (Sunrise Therapy Center — aggressive language)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":1,"body":"This is the worst ever experience. The staff is disgusting and terrible. Pure garbage service, I hate this place!"}' | jq '{id:.data.id, status:.data.status}'

# 6. NEEDS_HUMAN_REVIEW → FLAGGED  (too short)
curl -s -X POST http://localhost:3000/api/v1/reviews \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_TOKEN" \
  -d '{"placeId":"PLACE_ID","rating":3,"body":"It was okay."}' | jq '{id:.data.id, status:.data.status}'
```

> **How to observe moderation:** Reviews are created as `PENDING` and processed asynchronously by BullMQ (50–300ms mock latency). Wait ~1 second then fetch the review:
> ```bash
> curl -s http://localhost:3000/api/v1/reviews/REVIEW_ID | jq '{status:.data.status, label:.data.aiLabel, summary:.data.aiSummary, tags:.data.tags}'
> ```

---

### Step 4 — Feed: ranked approved reviews

```bash
# Bangalore bakery feed — only APPROVED reviews appear, sorted by ranking score
curl -s "http://localhost:3000/api/v1/feed?city=Bangalore&category=bakery" | jq '.data.items[] | {rating:.rating, status:.status, score:.rankingScore}'

# Delhi all-category feed
curl -s "http://localhost:3000/api/v1/feed?city=Delhi" | jq '.data.items[].place.name'
```

**Expected:** Only the `safe → APPROVED` review appears. Spam/toxic/flagged reviews are excluded.

---

### Step 5 — Admin: moderation queue and place merge

```bash
# View FLAGGED reviews waiting for human review (medical_risk + needs_human_review)
curl -s http://localhost:3000/api/v1/admin/moderation-queue \
  -H "Authorization: Bearer ADMIN_TOKEN" | jq '.data.items[] | {id:.id, label:.aiLabel}'

# Approve a flagged review
curl -s -X PATCH http://localhost:3000/api/v1/admin/reviews/REVIEW_ID/approve \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"note":"Medical claim verified — safe for publishing"}' | jq .

# View places flagged for merge (Sharma Clinic pair from Step 2)
curl -s http://localhost:3000/api/v1/admin/places/merge-queue \
  -H "Authorization: Bearer ADMIN_TOKEN" | jq '.data.items[] | {id:.id, name:.name, city:.city}'

# Merge the duplicate into the canonical place
curl -s -X POST http://localhost:3000/api/v1/admin/places/DUPLICATE_PLACE_ID/merge \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"canonicalPlaceId":"CANONICAL_PLACE_ID"}' | jq .
```

---

### What to verify per scenario

| Scenario | What to check |
|---|---|
| Deduplication hit | `wasDeduped: true`, same `id` returned |
| Deduplication miss | Two separate places, both `status: NEEDS_MERGE_REVIEW` |
| Safe review | After ~1s: `status: APPROVED`, `aiLabel: SAFE` |
| Spam review | After ~1s: `status: REJECTED`, `aiLabel: SPAM` |
| Self-promo review | After ~1s: `status: REJECTED`, `aiLabel: SELF_PROMO` |
| Medical risk review | After ~1s: `status: FLAGGED`, appears in `/admin/moderation-queue` |
| Toxic review | After ~1s: `status: REJECTED`, `aiLabel: TOXIC` |
| Short review | After ~1s: `status: FLAGGED`, `aiLabel: NEEDS_HUMAN_REVIEW` |
| Feed | Only `APPROVED` reviews visible; ranked by recency + engagement |
| Admin approve | Review moves from `FLAGGED` → `APPROVED`, appears in feed |
| Place merge | All reviews from source place reassigned to canonical place |

---

## Postman Collection

Pre-built collection files are in the `postman/` directory:

| File | Purpose |
|---|---|
| `postman/Local-Listings-Reviews.postman_collection.json` | Full collection — 17 requests across all modules |
| `postman/Local-Listings.postman_environment.json` | Local dev environment (`http://localhost:3000`) |
| `postman/Local-Listings-Production.postman_environment.json` | Production environment (update `baseUrl` to your ALB DNS) |

**Import steps:**
1. Postman → **Import** → select both JSON files from the `postman/` folder
2. Select **"Local Listings — Local Dev"** environment (top-right dropdown)
3. Run **Register User** → **Login** — tokens are auto-saved via test scripts
4. Run **Create Place** → `placeId` is auto-saved → run **Create Review**

**Token scripts** — the Register and Login requests automatically capture tokens into environment variables via Postman test scripts, so you don't need to copy-paste them manually.

---

## Deploy on AWS

```bash
# 1. Build and push Docker image to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin <ECR_URL>
docker build -t local-listings-api .
docker tag local-listings-api:latest <ECR_URL>/local-listings-api:latest
docker push <ECR_URL>/local-listings-api:latest

# 2. Run DB migrations on deploy
# In ECS task definition CMD:
# ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]

# 3. Set environment variables via AWS Secrets Manager / SSM Parameter Store

# 4. Configure ALB health check: GET /health → 200 OK
```
