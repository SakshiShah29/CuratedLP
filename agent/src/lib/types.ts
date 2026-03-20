/**
 * Shared TypeScript interfaces for Phase 4 tools.
 */

export interface SentimentResult {
  sentiment: string; // "bullish" | "bearish" | "neutral" | "moderately_bullish" etc.
  confidence: number; // 0-1
  signals: string[]; // 3-5 key observations
  timestamp: string;
}

export interface RebalanceRecommendation {
  newTickLower: number;
  newTickUpper: number;
  newFee: number;
  confidence: number; // 0-1
  reasoning: string;
  dataSources: string[];
  missingData: string[];
  model: string;
}
