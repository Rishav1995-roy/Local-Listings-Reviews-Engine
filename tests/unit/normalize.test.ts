/**
 * @file tests/unit/normalize.test.ts
 * @description Unit tests for the place name normalisation utility.
 *
 * These tests verify that different input formats for the same business
 * normalise to the same canonical string, which is critical for accurate
 * pg_trgm similarity scoring.
 */

import { normalizePlaceName, removeCitySuffix } from '../../src/utils/normalize';

describe('normalizePlaceName', () => {
  // Core deduplication case: different punctuation → same output
  it('normalises em-dash separator to space', () => {
    const a = normalizePlaceName('Sweet Oven Bakery – Bangalore');
    const b = normalizePlaceName('Sweet-Oven Bakery – Bangalore');

    // After replacing separators and collapsing spaces, both should produce the same string
    expect(a).toBe('sweet oven bakery bangalore');
    expect(a).toBe(b);
  });

  it('lowercases all characters', () => {
    expect(normalizePlaceName('SWEET OVEN BAKERY')).toBe('sweet oven bakery');
  });

  it('strips special characters except spaces', () => {
    expect(normalizePlaceName("McDonald's Cafe!")).toBe('mcdonalds cafe');
  });

  it('collapses multiple spaces into one', () => {
    // The normaliser collapses all runs of whitespace to a single space
    const result = normalizePlaceName('Foo   Bar   Baz');
    expect(result).toBe('foo bar baz');
    expect(result).not.toContain('  '); // No double spaces after collapse
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizePlaceName('  Cafe Nero  ')).toBe('cafe nero');
  });

  it('handles names with slashes', () => {
    expect(normalizePlaceName('Pizza/Pasta House')).toBe('pizza pasta house');
  });

  it('handles names with em-dash and en-dash', () => {
    const emDash = normalizePlaceName('Brew—Bar');
    const enDash = normalizePlaceName('Brew–Bar');
    const hyphen = normalizePlaceName('Brew-Bar');
    expect(emDash).toBe(enDash);
    expect(enDash).toBe(hyphen);
  });

  it('returns empty string for empty input', () => {
    expect(normalizePlaceName('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizePlaceName('   ')).toBe('');
  });

  it('handles numbers in business names', () => {
    expect(normalizePlaceName('7 Eleven Store')).toBe('7 eleven store');
  });
});

describe('removeCitySuffix', () => {
  it('removes city name from the end of a normalized place name', () => {
    const result = removeCitySuffix('sweet oven bakery bangalore', 'Bangalore');
    expect(result).toBe('sweet oven bakery');
  });

  it('does not modify name when city not at end', () => {
    const result = removeCitySuffix('bangalore sweet oven bakery', 'Bangalore');
    expect(result).toBe('bangalore sweet oven bakery');
  });

  it('handles city names with different casing', () => {
    const result = removeCitySuffix('cafe nero MUMBAI', 'Mumbai');
    // normalized city is lowercased; normalized name is already lowercase
    expect(result).toBe('cafe nero MUMBAI'); // city is 'mumbai', end is 'MUMBAI' — no match (case-sensitive suffix)
  });
});
