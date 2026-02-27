/**
 * @file normalize.ts
 * @description Text normalisation for place deduplication.
 *
 * "Sweet Oven Bakery – Bangalore" → "sweet oven bakery bangalore"
 * "Sweet-Oven Bakery – Bangalore" → "sweet oven bakery bangalore"
 *
 * Both normalise to the same string, so pg_trgm similarity is maximised
 * and false negatives from punctuation differences are eliminated.
 */

export const normalizePlaceName = (name: string): string => {
  return name
    .toLowerCase()
    // Replace common separators (–, —, -, /) with space
    .replace(/[\u2013\u2014\-\/]+/g, ' ')
    // Strip all non-alphanumeric characters except spaces
    .replace(/[^a-z0-9\s]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Strips city suffix from place name if it appears at the end.
 * "Sweet Oven Bakery Bangalore" → "sweet oven bakery" (city = "bangalore")
 * Helps increase similarity accuracy for cross-city dedup checks.
 */
export const removeCitySuffix = (normalizedName: string, city: string): string => {
  const normalizedCity = city.toLowerCase().trim();
  if (normalizedName.endsWith(normalizedCity)) {
    return normalizedName.slice(0, -normalizedCity.length).trim();
  }
  return normalizedName;
};
