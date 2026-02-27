/**
 * @file ai-provider.interface.ts
 * @description Strategy interface for AI moderation providers.
 *
 * Swap providers by implementing this interface:
 * - MockAiProvider  (dev/test)
 */

import { AiModerationResult } from '../../types';

export interface IAiProvider {
  moderate(params: {
    reviewText: string;
    placeName: string;
    category?: string;
  }): Promise<AiModerationResult>;
}
