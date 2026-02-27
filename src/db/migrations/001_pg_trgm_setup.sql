-- =============================================================
-- Docker init script: runs at first PostgreSQL boot ONLY.
-- At this point Prisma has NOT run yet, so no tables exist.
-- Only safe to enable extensions here — indexes/functions go
-- in prisma/migrations after tables are created.
-- =============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;
