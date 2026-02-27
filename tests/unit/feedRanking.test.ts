/**
 * @file tests/unit/feedRanking.test.ts
 * @description Unit tests for the feed ranking algorithm.
 *
 * Tests verify:
 * 1. Fresh reviews score higher than old reviews (recency)
 * 2. Highly-engaged reviews score higher than ignored ones
 * 3. Category-matching reviews rank above non-matching
 * 4. Flagged reviews are penalised
 * 5. Score is always in [0, 1] range
 * 6. Relative ordering matches business expectations
 */

import { computeRankingScore } from '../../src/modules/feed/services/feed.service';

// Helper: create a Date N days ago
const daysAgo = (n: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

describe('computeRankingScore', () => {
  // ── Score bounds ─────────────────────────────────────────

  it('returns a score between 0 and 1 for any valid input', () => {
    const inputs = [
      { createdAt: daysAgo(0), helpfulCount: 0, cityMatch: true, categoryMatch: true, wasFlagged: false },
      { createdAt: daysAgo(365), helpfulCount: 0, cityMatch: false, categoryMatch: false, wasFlagged: true },
      { createdAt: daysAgo(7), helpfulCount: 100, cityMatch: true, categoryMatch: false, wasFlagged: false },
    ];

    for (const input of inputs) {
      const score = computeRankingScore(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  // ── Recency ──────────────────────────────────────────────

  it('fresh reviews score higher than old reviews (same engagement)', () => {
    const fresh = computeRankingScore({
      createdAt: daysAgo(1),
      helpfulCount: 5,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    const old = computeRankingScore({
      createdAt: daysAgo(90),
      helpfulCount: 5,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    expect(fresh).toBeGreaterThan(old);
  });

  it('today review scores higher than 30-day-old review', () => {
    const today = computeRankingScore({
      createdAt: daysAgo(0),
      helpfulCount: 0,
      cityMatch: true,
      categoryMatch: false,
      wasFlagged: false,
    });

    const month = computeRankingScore({
      createdAt: daysAgo(30),
      helpfulCount: 0,
      cityMatch: true,
      categoryMatch: false,
      wasFlagged: false,
    });

    expect(today).toBeGreaterThan(month);
  });

  // ── Engagement ───────────────────────────────────────────

  it('highly-voted reviews score higher than zero-vote reviews', () => {
    const highVotes = computeRankingScore({
      createdAt: daysAgo(7),
      helpfulCount: 50, // At the cap → max engagement score
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    const noVotes = computeRankingScore({
      createdAt: daysAgo(7),
      helpfulCount: 0,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    expect(highVotes).toBeGreaterThan(noVotes);
  });

  it('engagement score is capped at 50 helpful votes', () => {
    const capped = computeRankingScore({
      createdAt: daysAgo(7),
      helpfulCount: 50,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    const beyond = computeRankingScore({
      createdAt: daysAgo(7),
      helpfulCount: 9999,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    // Both should be equal — engagement capped at 50 votes
    expect(capped).toBeCloseTo(beyond, 5);
  });

  // ── Category match ───────────────────────────────────────

  it('category-matching reviews score higher than non-matching (same age, votes)', () => {
    const withCat = computeRankingScore({
      createdAt: daysAgo(5),
      helpfulCount: 10,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    const noCat = computeRankingScore({
      createdAt: daysAgo(5),
      helpfulCount: 10,
      cityMatch: true,
      categoryMatch: false,
      wasFlagged: false,
    });

    expect(withCat).toBeGreaterThan(noCat);
    // Category is weighted at 0.1 — difference should be ~0.1
    expect(withCat - noCat).toBeCloseTo(0.1, 1);
  });

  // ── Flagged penalty ──────────────────────────────────────

  it('flagged reviews have lower scores than non-flagged', () => {
    const clean = computeRankingScore({
      createdAt: daysAgo(3),
      helpfulCount: 20,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    const flagged = computeRankingScore({
      createdAt: daysAgo(3),
      helpfulCount: 20,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: true,
    });

    expect(clean).toBeGreaterThan(flagged);
    // Penalty is 0.5 — flagged review scores significantly lower
    expect(clean - flagged).toBeCloseTo(0.5, 1);
  });

  // ── Realistic scenario comparison ────────────────────────

  it('Review A ranks higher than Review B in realistic scenario', () => {
    // Review A: 3 days old, 20 helpful votes, city match, category match, not flagged
    const reviewA = computeRankingScore({
      createdAt: daysAgo(3),
      helpfulCount: 20,
      cityMatch: true,
      categoryMatch: true,
      wasFlagged: false,
    });

    // Review B: 30 days old, 5 helpful votes, city match, no category match, not flagged
    const reviewB = computeRankingScore({
      createdAt: daysAgo(30),
      helpfulCount: 5,
      cityMatch: true,
      categoryMatch: false,
      wasFlagged: false,
    });

    expect(reviewA).toBeGreaterThan(reviewB);

    // Verify Review A is in the expected range (~0.75)
    expect(reviewA).toBeGreaterThan(0.5);

    // Verify Review B is lower (~0.3)
    expect(reviewB).toBeLessThan(0.5);
  });

  // ── Very old review ──────────────────────────────────────

  it('1-year-old review scores very low on recency', () => {
    const veryOld = computeRankingScore({
      createdAt: daysAgo(365),
      helpfulCount: 0,
      cityMatch: true,
      categoryMatch: false,
      wasFlagged: false,
    });

    // Recency score ≈ e^(-0.05 * 365) ≈ 0.000016 → near zero
    // location_match contributes 0.2
    // Total should be very low
    expect(veryOld).toBeLessThan(0.25);
  });
});
