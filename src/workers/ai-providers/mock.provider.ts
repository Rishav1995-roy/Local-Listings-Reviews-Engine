/**
 * @file mock.provider.ts
 * @description Mock AI moderation provider for development and testing.
 *
 * Simulates real AI behaviour:
 * - Detects spam keywords
 * - Detects toxic language
 * - Detects self-promotion
 * - Detects medical risk claims
 * - Generates mock tags from text
 * - Generates a mock summary (first 80 chars of text)
 * - Adds realistic latency (50–300ms) to mimic API call
 *
 */

import { IAiProvider } from './ai-provider.interface';
import { AiLabel, AiModerationResult } from '../../types';

const SPAM_KEYWORDS = ['buy now', 'click here', 'free offer', 'limited time', 'subscribe'];
const TOXIC_KEYWORDS = ['hate', 'terrible', 'disgusting', 'trash', 'worst ever', 'garbage'];
const SELF_PROMO_KEYWORDS = ['my business', 'my restaurant', 'visit us', 'our store', 'check us out'];
const MEDICAL_KEYWORDS = ['cure', 'treatment', 'heals', 'medical', 'doctor recommended', 'clinical'];

const CATEGORY_TAGS: Record<string, string[]> = {
  restaurant: ['food', 'service', 'ambiance', 'price', 'taste'],
  bakery: ['pastry', 'bread', 'freshness', 'hygiene', 'taste'],
  hotel: ['rooms', 'cleanliness', 'staff', 'location', 'amenities'],
  default: ['quality', 'value', 'experience', 'service'],
};

export class MockAiProvider implements IAiProvider {
  async moderate(params: {
    reviewText: string;
    placeName: string;
    category?: string;
  }): Promise<AiModerationResult> {
    // Simulate network latency
    await this.delay(50 + Math.random() * 250);

    const text = params.reviewText.toLowerCase();
    const label = this.classifyLabel(text);
    const tags = this.extractTags(text, params.category);
    const summary = this.generateSummary(params.reviewText);
    const score = this.computeScore(label);

    return {
      label,
      score,
      tags,
      summary,
      rawResponse: {
        provider: 'mock',
        model: 'mock-v1',
        prompt_tokens: Math.floor(text.length / 4),
        completion_tokens: 50,
      },
    };
  }

  private classifyLabel(text: string): AiLabel {
    // Evaluate in priority order: toxic > spam > medical_risk > self_promo > safe
    if (TOXIC_KEYWORDS.some((kw) => text.includes(kw))) return 'toxic';
    if (SPAM_KEYWORDS.some((kw) => text.includes(kw))) return 'spam';
    if (MEDICAL_KEYWORDS.some((kw) => text.includes(kw))) return 'medical_risk';
    if (SELF_PROMO_KEYWORDS.some((kw) => text.includes(kw))) return 'self_promo';

    // Short reviews might lack substance — flag for human review
    if (text.length < 30) return 'needs_human_review';

    return 'safe';
  }

  private extractTags(text: string, category?: string): string[] {
    const baseTags = CATEGORY_TAGS[category?.toLowerCase() ?? ''] ?? CATEGORY_TAGS.default;

    // Select tags that are mentioned (or pick first 3 by default)
    const mentioned = baseTags.filter((tag) => text.includes(tag));
    return mentioned.length > 0 ? mentioned.slice(0, 5) : baseTags.slice(0, 3);
  }

  private generateSummary(text: string): string {
    const truncated = text.slice(0, 120).trim();
    return truncated.length < text.length ? `${truncated}…` : truncated;
  }

  private computeScore(label: AiLabel): number {
    const scores: Record<AiLabel, number> = {
      safe: 0.92,
      spam: 0.85,
      toxic: 0.95,
      self_promo: 0.80,
      medical_risk: 0.88,
      needs_human_review: 0.60,
    };
    return Math.min(1, scores[label] + (Math.random() - 0.5) * 0.05);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
