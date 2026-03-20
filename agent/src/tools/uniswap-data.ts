/**
 * uniswap-data.ts — CLI tool for OpenClaw
 *
 * Makes 4 Uniswap Trading API quote calls + on-chain analytics from
 * DeFiLlama (Lido TVL, free) and DexScreener (pool data, free) to extract
 * structured market signals: price, spread, depth, approval status,
 * protocol health, and pool-level data.
 *
 * Quote-only — does NOT trigger or execute any swaps.
 *
 * Outputs JSON to stdout. Exits 0 on success, 1 on failure.
 *
 * Usage: npx tsx src/tools/uniswap-data.ts
 */

import "dotenv/config";

// ── Config ──────────────────────────────────────────────────────────

const UNISWAP_API_KEY = process.env.UNISWAP_API_KEY;
const HOOK_ADDRESS =
  process.env.HOOK_ADDRESS ?? "0x0000000000000000000000000000000000000001";

// Base mainnet defaults
const CHAIN_ID = parseInt(process.env.UNISWAP_CHAIN_ID ?? "8453", 10);
const WSTETH =
  process.env.WSTETH_ADDRESS ??
  "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452"; // wstETH on Base
const USDC =
  process.env.USDC_ADDRESS ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // USDC on Base
// DexScreener network ID for pool data (free, no key)
const DEXSCREENER_NETWORK = process.env.DEXSCREENER_NETWORK ?? "base";

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";

// Amounts in base units
const ONE_WSTETH = "1000000000000000000"; // 1e18
const TEN_WSTETH = "10000000000000000000"; // 10e18
const USDC_3400 = "3400000000"; // 3400e6
const MAX_UINT256 =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

if (!UNISWAP_API_KEY) {
  console.error(
    JSON.stringify({ error: "UNISWAP_API_KEY must be set in .env" })
  );
  process.exit(1);
}

// ── Types ───────────────────────────────────────────────────────────

interface QuoteResponse {
  requestId: string;
  quote: {
    input: { token: string; amount: string };
    output: { token: string; amount: string };
    gasFee?: string;
    gasFeeUSD?: string;
  };
  routing: string;
}

interface ApprovalResponse {
  requestId: string;
  approval: Record<string, unknown> | null;
  gasFee: string | null;
}

interface OnChainAnalytics {
  // DeFiLlama — Lido protocol TVL (free, no key)
  lidoTvl: number | null;
  lidoTvlChange24h: number | null;
  lidoTvlChange7d: number | null;
  // DexScreener — wstETH/USDC pool data (free, no key)
  poolLiquidity: number | null;
  poolVolume24h: number | null;
  poolPriceUsd: string | null;
  poolFeeApyEstimate: number | null;
  poolPriceChange24h: number | null;
  poolPairAddress: string | null;
}

interface UniswapDataResult {
  forwardPrice: number | null;
  reversePrice: number | null;
  spread: number | null;
  spreadBps: number | null;
  priceImpact10x: number | null;
  priceImpactBps: number | null;
  gasEstimate: string | null;
  approvalActive: boolean | null;
  requestIds: string[];
  onChainAnalytics: OnChainAnalytics;
  warnings: string[];
  timestamp: string;
}

// ── API Helpers ─────────────────────────────────────────────────────

async function postQuote(params: {
  type: "EXACT_INPUT" | "EXACT_OUTPUT";
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  amount: string;
  swapper: string;
}): Promise<QuoteResponse> {
  const res = await fetch(`${API_BASE}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNISWAP_API_KEY!,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Quote API ${res.status}: ${text}`);
  }
  return res.json() as Promise<QuoteResponse>;
}

async function postCheckApproval(params: {
  walletAddress: string;
  token: string;
  amount: string;
  chainId: number;
}): Promise<ApprovalResponse> {
  const res = await fetch(`${API_BASE}/check_approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": UNISWAP_API_KEY!,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Approval API ${res.status}: ${text}`);
  }
  return res.json() as Promise<ApprovalResponse>;
}

async function fetchOnChainAnalytics(): Promise<OnChainAnalytics> {
  const result: OnChainAnalytics = {
    lidoTvl: null,
    lidoTvlChange24h: null,
    lidoTvlChange7d: null,
    poolLiquidity: null,
    poolVolume24h: null,
    poolPriceUsd: null,
    poolFeeApyEstimate: null,
    poolPriceChange24h: null,
    poolPairAddress: null,
  };

  const [lidoRes, dexScreenerRes] = await Promise.allSettled([
    // DeFiLlama: Lido protocol TVL (free, no key)
    fetch("https://api.llama.fi/protocol/lido").then((r) => {
      if (!r.ok) throw new Error(`DeFiLlama protocol ${r.status}`);
      return r.json();
    }),

    // DexScreener: wstETH pool data on Base (free, no key)
    fetch(
      `https://api.dexscreener.com/token-pairs/v1/${DEXSCREENER_NETWORK}/${WSTETH}`
    ).then((r) => {
      if (!r.ok) throw new Error(`DexScreener ${r.status}`);
      return r.json();
    }),
  ]);

  // ── Lido TVL trends ──
  if (lidoRes.status === "fulfilled") {
    const tvlArray = lidoRes.value.tvl;
    if (Array.isArray(tvlArray) && tvlArray.length >= 8) {
      const current = tvlArray[tvlArray.length - 1].totalLiquidityUSD;
      const prev24h = tvlArray[tvlArray.length - 2].totalLiquidityUSD;
      const prev7d = tvlArray[tvlArray.length - 8].totalLiquidityUSD;
      result.lidoTvl = current;
      result.lidoTvlChange24h = ((current - prev24h) / prev24h) * 100;
      result.lidoTvlChange7d = ((current - prev7d) / prev7d) * 100;
    }
  }

  // ── wstETH/USDC pool on Uniswap ──
  if (dexScreenerRes.status === "fulfilled") {
    const pairs = dexScreenerRes.value;
    // Find the best Uniswap wstETH/USDC pair by liquidity
    const uniPair = (Array.isArray(pairs) ? pairs : [])
      .filter(
        (p: any) =>
          p.dexId === "uniswap" &&
          (p.quoteToken?.address?.toLowerCase() === USDC.toLowerCase() ||
            p.baseToken?.address?.toLowerCase() === USDC.toLowerCase())
      )
      .sort((a: any, b: any) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    if (uniPair) {
      result.poolLiquidity = uniPair.liquidity?.usd ?? null;
      result.poolVolume24h = uniPair.volume?.h24 ?? null;
      result.poolPriceUsd = uniPair.priceUsd ?? null;
      result.poolPriceChange24h = uniPair.priceChange?.h24 ?? null;
      result.poolPairAddress = uniPair.pairAddress ?? null;

      // Estimate fee APY: (24h volume × fee tier × 365) / liquidity × 100
      const volume = uniPair.volume?.h24;
      const liquidity = uniPair.liquidity?.usd;
      if (volume && liquidity && liquidity > 0) {
        const feeTier = 0.003; // 0.30% default
        result.poolFeeApyEstimate =
          ((volume * feeTier * 365) / liquidity) * 100;
      }
    }
  }

  return result;
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const warnings: string[] = [];

  // 5 parallel calls: 4 Uniswap + on-chain analytics (DeFiLlama + DexScreener)
  const [
    forwardResult,
    reverseResult,
    largeResult,
    approvalResult,
    analyticsResult,
  ] = await Promise.allSettled([
    // Call 1: Forward quote — wstETH → USDC (current price)
    postQuote({
      type: "EXACT_INPUT",
      tokenIn: WSTETH,
      tokenOut: USDC,
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      amount: ONE_WSTETH,
      swapper: HOOK_ADDRESS,
    }),

    // Call 2: Reverse quote — USDC → wstETH (for bid/ask spread)
    postQuote({
      type: "EXACT_INPUT",
      tokenIn: USDC,
      tokenOut: WSTETH,
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      amount: USDC_3400,
      swapper: HOOK_ADDRESS,
    }),

    // Call 3: Large quote — 10 wstETH → USDC (price impact / depth)
    postQuote({
      type: "EXACT_INPUT",
      tokenIn: WSTETH,
      tokenOut: USDC,
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      amount: TEN_WSTETH,
      swapper: HOOK_ADDRESS,
    }),

    // Call 4: Check approval status
    postCheckApproval({
      walletAddress: HOOK_ADDRESS,
      token: WSTETH,
      amount: MAX_UINT256,
      chainId: CHAIN_ID,
    }),

    // Call 5: DexScreener pool analytics (free, no key)
    fetchOnChainAnalytics(),
  ]);

  // ── Extract results (partial success is fine) ──

  const forward =
    forwardResult.status === "fulfilled" ? forwardResult.value : null;
  const reverse =
    reverseResult.status === "fulfilled" ? reverseResult.value : null;
  const large =
    largeResult.status === "fulfilled" ? largeResult.value : null;
  const approval =
    approvalResult.status === "fulfilled" ? approvalResult.value : null;
  const onChainAnalytics =
    analyticsResult.status === "fulfilled"
      ? analyticsResult.value
      : {
          lidoTvl: null, lidoTvlChange24h: null, lidoTvlChange7d: null,
          poolLiquidity: null, poolVolume24h: null, poolPriceUsd: null,
          poolFeeApyEstimate: null, poolPriceChange24h: null, poolPairAddress: null,
        };

  // Log partial failures as warnings
  if (!forward)
    warnings.push(
      `Forward quote failed: ${(forwardResult as PromiseRejectedResult).reason?.message}`
    );
  if (!reverse)
    warnings.push(
      `Reverse quote failed: ${(reverseResult as PromiseRejectedResult).reason?.message}`
    );
  if (!large)
    warnings.push(
      `Large quote failed: ${(largeResult as PromiseRejectedResult).reason?.message}`
    );
  if (!approval)
    warnings.push(
      `Approval check failed: ${(approvalResult as PromiseRejectedResult).reason?.message}`
    );
  if (analyticsResult.status === "rejected")
    warnings.push(`DexScreener analytics failed: ${analyticsResult.reason?.message}`);

  // Forward quote is the minimum required
  if (!forward) {
    console.error(
      JSON.stringify({
        error: "Forward quote failed — Uniswap data unavailable",
        warnings,
      })
    );
    process.exit(1);
  }

  // ── Collect requestIds (bounty proof) ──

  const requestIds: string[] = [];
  if (forward) requestIds.push(forward.requestId);
  if (reverse) requestIds.push(reverse.requestId);
  if (large) requestIds.push(large.requestId);
  if (approval) requestIds.push(approval.requestId);

  // ── Derive market signals ──

  // Forward price: USDC output per 1 wstETH
  const forwardPrice = parseFloat(forward.quote.output.amount) / 1e6;

  // Reverse price + spread
  let reversePrice: number | null = null;
  let spread: number | null = null;
  let spreadBps: number | null = null;
  if (reverse) {
    const wstethReceived =
      parseFloat(reverse.quote.output.amount) / 1e18;
    reversePrice = 3400 / wstethReceived; // USDC per wstETH via reverse
    spread = Math.abs(forwardPrice - reversePrice);
    spreadBps = (spread / forwardPrice) * 10000;
  }

  // Price impact at 10x size
  let priceImpact10x: number | null = null;
  let priceImpactBps: number | null = null;
  if (large) {
    const largePricePerUnit =
      parseFloat(large.quote.output.amount) / 1e6 / 10;
    priceImpact10x =
      Math.abs(forwardPrice - largePricePerUnit) / forwardPrice;
    priceImpactBps = priceImpact10x * 10000;
  }

  // Gas estimate
  const gasEstimate =
    forward.quote.gasFeeUSD ?? forward.quote.gasFee ?? null;

  // Approval: null means already approved, object means needs approval
  const approvalActive = approval ? approval.approval === null : null;

  // ── Build output ──

  const result: UniswapDataResult = {
    forwardPrice,
    reversePrice,
    spread,
    spreadBps,
    priceImpact10x,
    priceImpactBps,
    gasEstimate,
    approvalActive,
    requestIds,
    onChainAnalytics,
    warnings,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
});
