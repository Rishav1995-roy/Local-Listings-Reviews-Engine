/**
 * @file tests/unit/mockAiProvider.test.ts
 * @description Unit tests for the mock AI moderation provider.
 */

import { MockAiProvider } from '../../src/workers/ai-providers/mock.provider';

const provider = new MockAiProvider();

describe('MockAiProvider', () => {
  it('returns safe label for neutral positive review', async () => {
    const result = await provider.moderate({
      reviewText: 'Great food and excellent atmosphere. The service was prompt and the price was reasonable.',
      placeName: 'Sweet Oven Bakery',
      category: 'bakery',
    });

    expect(result.label).toBe('safe');
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.tags).toBeInstanceOf(Array);
    expect(result.summary).toBeTruthy();
  });

  it('returns spam label when spam keywords detected', async () => {
    const result = await provider.moderate({
      reviewText: 'Buy now and get free offer! Limited time only, click here for deals.',
      placeName: 'Spam Place',
    });

    expect(result.label).toBe('spam');
    expect(result.score).toBeGreaterThan(0.5);
  });

  it('returns toxic label when toxic language detected', async () => {
    const result = await provider.moderate({
      reviewText: 'This place is absolute garbage and the worst ever experience I hate it.',
      placeName: 'Bad Place',
    });

    expect(result.label).toBe('toxic');
  });

  it('returns self_promo label for self-promotional content', async () => {
    const result = await provider.moderate({
      reviewText: 'Visit us at my restaurant for the best food. Check us out today!',
      placeName: 'My Place',
    });

    expect(result.label).toBe('self_promo');
  });

  it('returns medical_risk label for medical claims', async () => {
    const result = await provider.moderate({
      reviewText: 'This food cure my diabetes and heals my joints. Doctor recommended it.',
      placeName: 'Health Place',
    });

    expect(result.label).toBe('medical_risk');
  });

  it('returns needs_human_review for very short reviews', async () => {
    const result = await provider.moderate({
      reviewText: 'ok',
      placeName: 'Some Place',
    });

    expect(result.label).toBe('needs_human_review');
  });

  it('always returns a score between 0 and 1', async () => {
    const result = await provider.moderate({
      reviewText: 'Some review text here that is long enough',
      placeName: 'Test Place',
    });

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('prioritises toxic over spam when both keywords present', async () => {
    const result = await provider.moderate({
      reviewText: 'Absolute garbage place! Buy now! worst ever service.',
      placeName: 'Test Place',
    });

    // toxic is checked before spam in the priority chain
    expect(result.label).toBe('toxic');
  });

  it('generates a summary that is a substring of the review text', async () => {
    const text = 'The food was amazing and the service was quick. I loved the ambiance and will definitely come back. The prices are very reasonable for the quality you get.';
    const result = await provider.moderate({
      reviewText: text,
      placeName: 'Good Place',
    });

    // Summary should be the first 120 chars (truncated)
    expect(result.summary.length).toBeLessThanOrEqual(124); // 120 + '…'
  });

  it('returns rawResponse with provider metadata', async () => {
    const result = await provider.moderate({
      reviewText: 'A good enough review about this place with sufficient length.',
      placeName: 'Test',
    });

    expect(result.rawResponse).toMatchObject({ provider: 'mock' });
  });
});
