/**
 * check-budget.ts — OBSERVE phase tool for OpenClaw (Person A / Locus)
 *
 * Queries the Locus smart wallet for current USDC balance and tracks
 * cumulative daily spending. Returns a BudgetStatus JSON that the agent
 * uses to pick a data-gathering strategy for the current heartbeat cycle:
 *
 *   FULL       > $1.00 remaining  → fetch uniswap + olas + venice
 *   PARTIAL    $0.10–$1.00        → fetch uniswap + venice (skip olas, use cache)
 *   MINIMAL    < $0.10            → fetch uniswap + venice only (free sources)
 *   CACHE_ONLY $0.00 / API error  → use cached olas data + venice with partial input
 *
 * Locus API (beta) — auth is direct Bearer token, NO separate auth endpoint:
 *   GET  /pay/balance  Bearer claw_beta_...  → { success, data: { balance/usdc/amount } }
 *
 * Usage:
 *   npx tsx src/tools/check-budget.ts
 *
 * Outputs JSON to stdout. Exits 0 always (degraded output on API error).
 */

import "dotenv/config";
import {
  LOCUS_API_KEY,
  LOCUS_DAILY_LIMIT,
  LOCUS_PER_TX_LIMIT,
  LOCUS_API_BASE,
} from "../lib/config.js";
import { getCache, setCache, TTL } from "../lib/cache.js";
import { log } from "../lib/logger.js";
import type { BudgetStatus, BudgetStrategy } from "../lib/types.js";

// ─── Locus REST client ───────────────────────────────────────────────────────

/**
 * Fetch USDC balance from Locus.
 *
 * Auth: direct Bearer token — the API key IS the bearer token.
 * Endpoint: GET /pay/balance
 * Response envelope: { success: true, data: { balance?: number, usdc?: number, ... } }
 */
async function fetchBalance(apiKey: string): Promise<{ balance: number; walletAddress?: string }> {
  const res = await fetch(`${LOCUS_API_BASE}/pay/balance`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Locus /pay/balance failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const raw = await res.json() as Record<string, unknown>;

  // Unwrap Locus response envelope: { success: true, data: { ... } }
  const data = (typeof raw.data === "object" && raw.data !== null)
    ? raw.data as Record<string, unknown>
    : raw;

  // Try all known field names for the USDC balance amount
  const balance =
    typeof data.balance === "number" ? data.balance :
    typeof data.usdc    === "number" ? data.usdc    :
    typeof data.amount  === "number" ? data.amount  :
    // Also handle string representations (some APIs return "10.00")
    typeof data.balance === "string" ? parseFloat(data.balance) || 0 :
    typeof data.usdc    === "string" ? parseFloat(data.usdc)    || 0 :
    0;

  // Try to extract wallet address (for logging)
  const walletAddress =
    typeof data.walletAddress === "string" ? data.walletAddress :
    typeof data.ownerAddress  === "string" ? data.ownerAddress  :
    typeof data.address       === "string" ? data.address       :
    undefined;

  log("debug", "check-budget: raw balance response", { data });
  return { balance, walletAddress };
}

// ─── Daily spend tracking ────────────────────────────────────────────────────

const DAILY_SPEND_KEY = `locus:daily-spend:${new Date().toISOString().slice(0, 10)}`;

function getDailySpend(): number {
  return getCache<number>(DAILY_SPEND_KEY) ?? 0;
}

/** Call this after a successful Locus payment to record the spend */
export function recordSpend(amount: number): void {
  const current = getDailySpend();
  setCache(DAILY_SPEND_KEY, current + amount, TTL.UNTIL_MIDNIGHT());
}

// ─── Strategy selection ──────────────────────────────────────────────────────

function pickStrategy(balance: number, remainingToday: number): BudgetStrategy {
  if (balance <= 0 || remainingToday <= 0) return "CACHE_ONLY";
  if (balance < 0.10 || remainingToday < 0.10) return "MINIMAL";
  if (balance < 1.00 || remainingToday < 1.00) return "PARTIAL";
  return "FULL";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Graceful degradation if Locus not configured
  if (!LOCUS_API_KEY) {
    const status: BudgetStatus = {
      balance: 0,
      dailySpend: 0,
      dailyLimit: LOCUS_DAILY_LIMIT,
      remainingToday: 0,
      perTxLimit: LOCUS_PER_TX_LIMIT,
      canSpend: false,
      strategy: "MINIMAL",
    };
    console.log(JSON.stringify({
      ...status,
      note: "LOCUS_API_KEY not set — running in MINIMAL mode (free sources only). Set LOCUS_API_KEY in .env to enable Olas Mech payments.",
    }, null, 2));
    return;
  }

  try {
    log("info", "check-budget: fetching Locus wallet balance");
    const { balance, walletAddress } = await fetchBalance(LOCUS_API_KEY);

    const dailySpend     = getDailySpend();
    const remainingToday = Math.max(0, LOCUS_DAILY_LIMIT - dailySpend);
    const canSpend       = balance > 0 && remainingToday > 0;
    const strategy       = pickStrategy(balance, remainingToday);

    const status: BudgetStatus = {
      balance,
      dailySpend,
      dailyLimit: LOCUS_DAILY_LIMIT,
      remainingToday,
      perTxLimit: LOCUS_PER_TX_LIMIT,
      canSpend,
      strategy,
      ...(walletAddress ? { walletAddress } : {}),
    };

    log("info", "check-budget: done", { balance, strategy });
    console.log(JSON.stringify(status, null, 2));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "check-budget: Locus API error — defaulting to MINIMAL", { error: msg });

    // Return a degraded-but-valid status so the agent can still proceed
    const dailySpend     = getDailySpend();
    const remainingToday = Math.max(0, LOCUS_DAILY_LIMIT - dailySpend);
    const status: BudgetStatus = {
      balance: 0,
      dailySpend,
      dailyLimit: LOCUS_DAILY_LIMIT,
      remainingToday,
      perTxLimit: LOCUS_PER_TX_LIMIT,
      canSpend: false,
      strategy: "MINIMAL",
    };

    console.log(JSON.stringify({
      ...status,
      error: msg.slice(0, 200),
      note: "Locus API unreachable — defaulting to MINIMAL strategy (free sources only).",
    }, null, 2));
    // Exit 0: budget unavailability is not a fatal error
  }
}

main().catch((err) => {
  // Should not reach here since main catches its own errors
  console.error(JSON.stringify({ error: String(err) }));
  process.exit(1);
});
