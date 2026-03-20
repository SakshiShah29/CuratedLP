/**
 * types.ts — Shared TypeScript interfaces for all Phase 4 tools.
 *
 * All tool stdout contracts are defined here so Person A and Person B
 * agree on exact shapes before building independently.
 */

// ─── Pool (from pool-reader.ts) ────────────────────────────────────────────

export interface PoolState {
  tickLower: number;
  tickUpper: number;
  totalLiquidity: string;
  currentFee: number;
  cumulativeVolume: string;
  cumulativeFeeRevenue: string;
  totalSwaps: number;
  idleToken0: string;
  idleToken1: string;
  accruedPerformanceFee: string;
  activeCuratorId: number;
  currentBlock: number;
}

// ─── Locus / Budget (from check-budget.ts) ─────────────────────────────────

export type BudgetStrategy = "FULL" | "PARTIAL" | "MINIMAL" | "CACHE_ONLY";

export interface BudgetStatus {
  /** USDC balance remaining in Locus wallet */
  balance: number;
  /** USDC spent today (tracked locally, resets at midnight UTC) */
  dailySpend: number;
  /** Daily cap configured in env (LOCUS_DAILY_LIMIT) */
  dailyLimit: number;
  /** dailyLimit - dailySpend */
  remainingToday: number;
  /** Max spend per single transaction (LOCUS_PER_TX_LIMIT) */
  perTxLimit: number;
  /** false if balance == 0 or dailyLimit exhausted */
  canSpend: boolean;
  /**
   * FULL       >$1.00 remaining → uniswap-data + venice (both calls) + olas cross-check
   * PARTIAL    $0.10–$1.00      → uniswap-data + venice (both calls), skip olas
   * MINIMAL    <$0.10           → uniswap-data + venice (both calls), skip olas
   * CACHE_ONLY $0.00            → uniswap-data + venice (both calls), skip olas, use cached olas if available
   */
  strategy: BudgetStrategy;
  walletAddress?: string;
}

// ─── Olas Mech (from olas-analyze.ts) ──────────────────────────────────────

export interface OlasRequestResult {
  /** The prompt sent to the mech */
  prompt: string;
  /** The mechx tool name used */
  tool: string;
  /** Raw result string or object returned by the mech */
  result: string;
  /** On-chain tx hash (populated for on-chain mode) */
  txHash?: string;
  /** Mech request ID */
  requestId?: string;
  success: boolean;
  error?: string;
}

export interface OlasSummary {
  /** Probability price goes up (0–1), derived from prediction_request results */
  priceDirectionBull?: number;
  /** Probability price goes down (0–1) */
  priceDirectionBear?: number;
  /** Implied volatility estimate string e.g. "12% annualized" */
  estimatedVolatility?: string;
  /** Qualitative sentiment string e.g. "moderately bullish" */
  sentiment?: string;
  /** Suggested tickLower from mech recommendation (must be div by tickSpacing=60) */
  suggestedTickLower?: number;
  /** Suggested tickUpper from mech recommendation */
  suggestedTickUpper?: number;
  /** Suggested fee in hundredths of a bp (e.g. 3000 = 0.30%) */
  suggestedFee?: number;
}

export interface OlasResults {
  success: boolean;
  requestCount: number;
  successCount: number;
  results: OlasRequestResult[];
  summary: OlasSummary;
  /** All on-chain tx hashes — logged for Olas bounty proof */
  txHashes: string[];
  durationMs: number;
}

// ─── Uniswap Trading API (from uniswap-data.ts) ────────────────────────────

export interface UniswapData {
  /** Forward quote: 1 unit of token0 → token1 (e.g. 1 wstETH → $3412 USDC) */
  forwardPrice: number;
  /** Reverse quote: token1 → token0, expressed in same unit as forward */
  reversePrice: number;
  /** |forwardPrice - reversePrice| in token1 units */
  spread: number;
  /** spread / forwardPrice * 10000 */
  spreadBps: number;
  /** Price per unit for a 10x trade size (price impact proxy) */
  priceImpact10x: number;
  /** |forwardPrice - priceImpact10x| / forwardPrice * 10000 */
  priceImpactBps: number;
  /** Gas estimate for a swap, in native token string */
  gasEstimate: string;
  /** Whether Permit2 approval is active for the vault */
  approvalActive: boolean;
  /** The 4 Uniswap API requestIds — logged for Uniswap bounty proof */
  requestIds: string[];
  timestamp: number;
}

// ─── Sentiment (from venice-analyze.ts --mode sentiment) ────────────────────

export interface SentimentResult {
  /** "bullish" | "bearish" | "neutral" | "moderately_bullish" etc. */
  sentiment: string;
  /** 0-1 confidence score */
  confidence: number;
  /** 3-5 key observations with context */
  signals: string[];
  timestamp: string;
}

// ─── Venice / EigenCompute (from venice-analyze.ts, eigencompute.ts) ────────

export interface RebalanceRecommendation {
  /** Recommended tickLower (must be divisible by tickSpacing 60) */
  newTickLower: number;
  /** Recommended tickUpper */
  newTickUpper: number;
  /** Recommended fee tier e.g. 500 | 3000 | 10000 */
  newFee: number;
  /** 0–1. Agent skips action if below CONFIDENCE_THRESHOLD (default 0.6) */
  confidence: number;
  /** Venice's reasoning text — preserved for audit trail */
  reasoning: string;
  /** Which data sources were available e.g. ["pool", "uniswap", "olas"] */
  dataSources: string[];
  /** Data sources that were missing/failed */
  missingData: string[];
  /** Venice model that produced the result */
  model: string;
}

export interface EigenComputeResult extends RebalanceRecommendation {
  /** Sentiment from Venice Call #1 (web search ON) */
  sentiment: SentimentResult;
  /** TEE attestation hash proving the inference ran unmodified */
  attestationHash: string;
  teeProvider: "eigencompute";
  /** EigenCompute job ID */
  computeJobId: string;
  /** Always true for EigenCompute results */
  verifiable: boolean;
}

// ─── Cycle Log (written by agent each heartbeat) ────────────────────────────

export interface CycleLog {
  timestamp: string;
  block: number;
  poolState: PoolState;
  budgetStatus?: BudgetStatus;
  uniswapData?: UniswapData;
  olasResults?: OlasResults;
  recommendation?: RebalanceRecommendation | EigenComputeResult;
  action: "rebalance" | "claim" | "rebalance+claim" | "nothing" | "error";
  txHash?: string;
  attestationHash?: string;
  durationMs?: number;
}
