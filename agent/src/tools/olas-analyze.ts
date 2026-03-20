/**
 * olas-analyze.ts — ANALYZE phase tool for OpenClaw (Person A / Olas Mech)
 *
 * Sends 10+ distinct requests to the Olas Mech Marketplace on Base and
 * returns aggregated market analysis that feeds into venice-analyze.ts.
 *
 * Each mech request generates an on-chain tx hash (bounty proof for Olas).
 * All tx hashes are also written to agent/data/payment-log.jsonl.
 *
 * How it works:
 *   1. Verifies mechx CLI is installed (pip install mech-client)
 *   2. Writes the OLAS_PAYMENT_KEY to a temp key file (mechx requirement)
 *   3. Discovers the mech address if OLAS_MECH_ADDRESS is not set
 *   4. Runs 10 prompts in parallel via spawned mechx processes (120s timeout each)
 *   5. Parses stdout for tx hashes and result text
 *   6. Aggregates into a structured OlasResults JSON
 *
 * The pool state is used to build context-aware prompts (current tick, fee, volume).
 *
 * Usage:
 *   npx tsx src/tools/olas-analyze.ts --pool '<json from pool-reader>'
 *
 * Outputs JSON to stdout. Exits 0 on success (partial results OK), 1 on fatal error.
 *
 * Prerequisites:
 *   pip install mech-client          (Python >=3.10, <3.15)
 *   Fund OLAS_PAYMENT_KEY EOA with ETH on Base mainnet for mech request fees
 *   (no setup required — we use --client-mode EOA mode, bypassing Safe setup)
 */

import "dotenv/config";
import { execFile, exec } from "child_process";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  OLAS_MECH_ADDRESS,
  OLAS_CHAIN_CONFIG,
  OLAS_PRIVATE_KEY_FILE,
  OLAS_PAYMENT_KEY,
  DATA_DIR,
} from "../lib/config.js";
import { log, logPayment } from "../lib/logger.js";
import { getCache, setCache, TTL } from "../lib/cache.js";
import type { OlasRequestResult, OlasResults, OlasSummary, PoolState } from "../lib/types.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 120_000; // 120s per request (as per Olas docs)
const PARALLEL_LIMIT     = 5;       // Run 5 at a time to avoid nonce conflicts
const OLAS_CACHE_KEY     = "olas:latest-results";

// ─── Parse CLI args ──────────────────────────────────────────────────────────

function parseArgs(): { pool: PoolState | null } {
  const args = process.argv.slice(2);
  const poolIdx = args.indexOf("--pool");
  if (poolIdx === -1 || !args[poolIdx + 1]) {
    return { pool: null };
  }
  try {
    return { pool: JSON.parse(args[poolIdx + 1]) as PoolState };
  } catch {
    throw new Error("--pool argument must be valid JSON from pool-reader output");
  }
}

// ─── Prerequisite checks ─────────────────────────────────────────────────────

/** Returns true if mechx is installed and callable */
function isMechxInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec("mechx --version", (err) => resolve(!err));
  });
}

/**
 * Discover the best mech on the target chain.
 * Returns the top mech address from `mechx mech list` (sorted by delivery count).
 *
 * Output table columns:
 *   | AI Agent Id | Mech Type | Mech Address | Total Deliveries | Metadata Link |
 * AI Agent Id is a number, Mech Address is 0x[40chars].
 */
function discoverMechAddress(): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `mechx --client-mode mech list --chain-config ${OLAS_CHAIN_CONFIG}`,
      { timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`mechx mech list failed: ${stderr || err.message}`));

        // First 0x[40-char hex] in stdout is the Mech Address column
        const match = stdout.match(/0x[a-fA-F0-9]{40}/);
        if (!match) {
          return reject(new Error(`No mech address found in mechx mech list output:\n${stdout.slice(0, 500)}`));
        }
        resolve(match[0]);
      }
    );
  });
}

// ─── Private key file management ─────────────────────────────────────────────

let tempKeyFile: string | null = null;

/**
 * Returns the path to a mechx-compatible private key file.
 * If OLAS_PRIVATE_KEY_FILE exists, use it.
 * Otherwise create a temp file from OLAS_PAYMENT_KEY (deleted in cleanup).
 */
function ensureKeyFile(): string {
  // User has a pre-existing key file
  if (existsSync(OLAS_PRIVATE_KEY_FILE)) {
    return OLAS_PRIVATE_KEY_FILE;
  }

  if (!OLAS_PAYMENT_KEY) {
    throw new Error(
      "No private key for Olas: set OLAS_PRIVATE_KEY_FILE (path to key file) " +
      "or OLAS_PAYMENT_KEY (hex private key) in .env"
    );
  }

  // Strip leading 0x if present (mechx expects raw hex, no 0x prefix)
  const rawKey = OLAS_PAYMENT_KEY.startsWith("0x")
    ? OLAS_PAYMENT_KEY.slice(2)
    : OLAS_PAYMENT_KEY;

  // Write to a temp file in data dir (mechx requirement: no trailing newline)
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  tempKeyFile = join(DATA_DIR, ".olas_key_tmp");
  writeFileSync(tempKeyFile, rawKey, { encoding: "utf8" });
  return tempKeyFile;
}

function cleanupKeyFile(): void {
  if (tempKeyFile && existsSync(tempKeyFile)) {
    try { unlinkSync(tempKeyFile); } catch {}
    tempKeyFile = null;
  }
}

// ─── Build prompts ────────────────────────────────────────────────────────────

/**
 * Build 10 context-aware prompts based on current pool state.
 * Each entry is { prompt, tool } — the tool name must be valid for the mech.
 */
function buildPrompts(pool: PoolState | null): Array<{ prompt: string; tool: string }> {
  // Derive human-readable context from pool state
  const tickMid   = pool ? Math.round((pool.tickLower + pool.tickUpper) / 2) : 0;
  const rangeWidth = pool ? pool.tickUpper - pool.tickLower : 0;
  const feePct    = pool ? (pool.currentFee / 10_000).toFixed(2) : "0.30";
  const volume    = pool ? (Number(pool.cumulativeVolume) / 1e18).toFixed(4) : "unknown";

  // Context line prepended to all prompts
  const ctx = pool
    ? `Context: CuratedLP wstETH/USDC Uniswap v4 pool. Current tick=${tickMid}, range=[${pool.tickLower},${pool.tickUpper}] (width=${rangeWidth}), fee=${feePct}%, cumulative volume=${volume} wstETH.`
    : "Context: CuratedLP wstETH/USDC Uniswap v4 concentrated liquidity pool.";

  return [
    // 1. Price direction — bull probability (uses claude-prediction-online for live data)
    {
      prompt: `${ctx} What is the probability that ETH/USDC price increases over the next 4 hours? Answer with a probability between 0 and 1.`,
      tool: "claude-prediction-online",
    },
    // 2. Downside risk
    {
      prompt: `${ctx} What is the probability that ETH drops more than 2% in the next 4 hours?`,
      tool: "claude-prediction-online",
    },
    // 3. Upside probability
    {
      prompt: `${ctx} What is the probability that ETH rises more than 2% in the next 4 hours?`,
      tool: "claude-prediction-online",
    },
    // 4. Volatility estimate
    {
      prompt: `${ctx} Estimate ETH implied volatility for the next 24 hours. Return annualized percentage only (e.g. "72%").`,
      tool: "openai-gpt-4o-2024-05-13",
    },
    // 5. Optimal tick range
    {
      prompt: `${ctx} Given the current pool parameters, what is the optimal concentrated liquidity tick range [tickLower, tickUpper] for maximizing fee capture while minimizing out-of-range risk? Ticks must be divisible by 60. Reply as JSON: {"tickLower": N, "tickUpper": N, "reasoning": "..."}`,
      tool: "openai-gpt-4o-2024-05-13",
    },
    // 6. Optimal fee tier
    {
      prompt: `${ctx} What is the optimal swap fee tier (in basis points, e.g. 500, 3000, or 10000) for a wstETH/USDC Uniswap v4 pool given current market conditions? Reply as JSON: {"fee": N, "reasoning": "..."}`,
      tool: "openai-gpt-4o-2024-05-13",
    },
    // 7. Resistance level
    {
      prompt: `${ctx} Identify the nearest key ETH/USD resistance level above current price. What is the probability ETH breaks above it in the next 4 hours?`,
      tool: "claude-prediction-online",
    },
    // 8. Support level
    {
      prompt: `${ctx} Identify the nearest key ETH/USD support level below current price. What is the probability ETH breaks below it in the next 4 hours?`,
      tool: "claude-prediction-online",
    },
    // 9. DeFi sentiment
    {
      prompt: `${ctx} Summarize current DeFi market sentiment for the ETH ecosystem in 2-3 sentences. Focus on factors relevant to ETH/stETH liquidity provision.`,
      tool: "openai-gpt-4o-2024-05-13",
    },
    // 10. Range rebalance recommendation
    {
      prompt: `${ctx} Should the liquidity position be rebalanced? The current range width is ${rangeWidth} ticks. Given current volatility and volume, would a narrower or wider range generate more fees? Reply as JSON: {"action": "narrow"|"widen"|"keep", "newWidth": N, "confidence": 0-1, "reasoning": "..."}`,
      tool: "openai-gpt-4o-2024-05-13",
    },
  ];
}

// ─── Mechx request runner ────────────────────────────────────────────────────

/**
 * Execute a single mechx request and parse its output.
 *
 * mechx stdout format (as of mech-client v0.20.0):
 *   Sending marketplace request...
 *   ✓ Transaction hash: 0xabc123...
 *   ✓ Request IDs: [123456789]
 *   ✓ Delivery results:
 *    Request 123456789: <result text or JSON>
 *
 * We use --client-mode (global flag before subcommand) to use EOA mode,
 * which skips the one-time `mechx setup` Safe account registration.
 * --client-mode must come BEFORE the "request" subcommand.
 */
function runMechRequest(
  prompt: string,
  tool: string,
  mechAddress: string,
  keyFile: string
): Promise<OlasRequestResult> {
  return new Promise((resolve) => {
    // --client-mode is a GLOBAL flag — must precede the subcommand
    const args = [
      "--client-mode",
      "request",
      "--prompts", prompt,
      "--priority-mech", mechAddress,
      "--tools", tool,
      "--chain-config", OLAS_CHAIN_CONFIG,
      "--key", keyFile,
    ];

    log("debug", `olas: mechx --client-mode request tool=${tool}`);

    const child = execFile("mechx", args, {
      timeout: REQUEST_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10 MB
    }, (err, stdout, stderr) => {
      const output = (stdout || "") + (stderr || "");

      if (err && !stdout) {
        // Complete failure — no output at all
        resolve({
          prompt: prompt.slice(0, 120),
          tool,
          result: "",
          success: false,
          error: err.message.slice(0, 200),
        });
        return;
      }

      // Parse tx hash: "✓ Transaction hash: 0x..." (checkmark prefix, flexible)
      const txMatch = output.match(/[Tt]ransaction\s+hash[:\s]+([0-9a-fA-F]{64}(?:0x)?[0-9a-fA-F]*|0x[0-9a-fA-F]{64})/);
      const txHash  = txMatch?.[1];

      // Parse request IDs: "✓ Request IDs: [123456789]" → extract first number
      const idMatch   = output.match(/[Rr]equest\s+[Ii][Dd]s?[:\s]+\[?(\d+)/);
      const requestId = idMatch?.[1];

      // Parse delivery result: "Request 123456789: <text>" or fallback to full output
      // Priority: delivery results block → "Result:" line → full output
      const deliveryMatch = output.match(/[Rr]equest\s+\d+[:\s]+(.+?)(?=\n[A-Z✓]|$)/s);
      const resultLineMatch = output.match(/[Rr]esult[:\s]+(.+?)(?:\n[A-Z✓]|$)/s);
      const rawResult = (deliveryMatch?.[1] ?? resultLineMatch?.[1] ?? output).trim();

      // Log payment if we have a tx hash
      if (txHash) {
        logPayment("olas", txHash, 0, { tool, prompt: prompt.slice(0, 80), requestId });
      }

      resolve({
        prompt: prompt.slice(0, 120),
        tool,
        result: rawResult.slice(0, 1000),
        txHash,
        requestId,
        success: true,
      });
    });

    // Gracefully handle timeout
    setTimeout(() => {
      try { child.kill(); } catch {}
    }, REQUEST_TIMEOUT_MS - 1000);
  });
}

// ─── Run prompts in parallel batches ─────────────────────────────────────────

async function runBatch(
  prompts: Array<{ prompt: string; tool: string }>,
  mechAddress: string,
  keyFile: string,
  batchSize: number
): Promise<OlasRequestResult[]> {
  const results: OlasRequestResult[] = [];

  for (let i = 0; i < prompts.length; i += batchSize) {
    const batch = prompts.slice(i, i + batchSize);
    log("info", `olas: running batch ${Math.floor(i / batchSize) + 1} (${batch.length} requests)`);

    const batchResults = await Promise.all(
      batch.map(({ prompt, tool }) =>
        runMechRequest(prompt, tool, mechAddress, keyFile)
      )
    );
    results.push(...batchResults);
  }

  return results;
}

// ─── Aggregate results into summary ──────────────────────────────────────────

function aggregate(results: OlasRequestResult[]): OlasSummary {
  const summary: OlasSummary = {};

  // Extract probability from prediction_request results (p_yes, p_no, or decimal)
  const predResults = results.filter(r => r.tool === "prediction_request" && r.success);

  // Prompt 0 (index 0): general direction → p_yes = bull probability
  if (predResults[0]) {
    const p = extractProbability(predResults[0].result);
    if (p !== null) {
      summary.priceDirectionBull = p;
      summary.priceDirectionBear = 1 - p;
    }
  }

  // Prompt 3 (volatility): extract percentage
  const volResult = results.find(r => r.prompt.includes("implied volatility") && r.success);
  if (volResult) {
    const pctMatch = volResult.result.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) summary.estimatedVolatility = `${pctMatch[1]}% annualized`;
  }

  // Prompt 8 (sentiment): use raw text as sentiment
  const sentResult = results.find(r => r.prompt.includes("sentiment") && r.success);
  if (sentResult) {
    summary.sentiment = sentResult.result.slice(0, 300);
  }

  // Prompt 4 (tick range): try to parse JSON
  const rangeResult = results.find(r => r.prompt.includes("tickLower") && r.success);
  if (rangeResult) {
    try {
      const json = extractJson(rangeResult.result);
      if (json && typeof json.tickLower === "number" && typeof json.tickUpper === "number") {
        // Snap to tickSpacing=60
        summary.suggestedTickLower = Math.round(json.tickLower / 60) * 60;
        summary.suggestedTickUpper = Math.round(json.tickUpper / 60) * 60;
      }
    } catch {}
  }

  // Prompt 5 (fee): try to parse JSON
  const feeResult = results.find(r => r.prompt.includes("fee tier") && r.success);
  if (feeResult) {
    try {
      const json = extractJson(feeResult.result);
      if (json && typeof json.fee === "number") {
        summary.suggestedFee = json.fee;
      }
    } catch {}
  }

  return summary;
}

function extractProbability(text: string): number | null {
  // Try JSON: { p_yes: 0.62 } or { probability: 0.62 }
  try {
    const json = extractJson(text);
    if (json) {
      const val = json.p_yes ?? json.probability ?? json.p ?? json.value;
      if (typeof val === "number" && val >= 0 && val <= 1) return val;
    }
  } catch {}

  // Try bare decimal: "0.62" or "62%"
  const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) return parseFloat(pctMatch[1]) / 100;

  const decMatch = text.match(/\b(0\.\d+)\b/);
  if (decMatch) return parseFloat(decMatch[1]);

  return null;
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]) as Record<string, unknown>;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs = Date.now();
  const { pool } = parseArgs();

  // Check for cached results (avoid redundant paid requests within 10 minutes)
  const cached = getCache<OlasResults>(OLAS_CACHE_KEY);
  if (cached && process.env.OLAS_FORCE !== "1") {
    log("info", "olas-analyze: returning cached results (set OLAS_FORCE=1 to bypass)");
    console.log(JSON.stringify({ ...cached, fromCache: true }, null, 2));
    return;
  }

  // 1. Check mechx is installed
  if (!(await isMechxInstalled())) {
    console.log(JSON.stringify({
      success: false,
      error: "mechx CLI not found. Install with: pip install mech-client",
      instructions: [
        "pip install mech-client",
        "Fund the OLAS_PAYMENT_KEY address with ETH on Base mainnet (no 'mechx setup' needed — using --client-mode EOA)",
        `mechx --client-mode mech list --chain-config ${OLAS_CHAIN_CONFIG}  # discover mech address`,
        "Set OLAS_MECH_ADDRESS in .env with the address from above",
      ],
      requestCount: 0,
      successCount: 0,
      results: [],
      summary: {},
      txHashes: [],
      durationMs: Date.now() - startMs,
    }, null, 2));
    process.exit(0); // Not a hard error — agent can proceed without Olas
  }

  // 2. Ensure private key file
  let keyFile: string;
  try {
    keyFile = ensureKeyFile();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(JSON.stringify({
      success: false,
      error: msg,
      requestCount: 0,
      successCount: 0,
      results: [],
      summary: {},
      txHashes: [],
      durationMs: Date.now() - startMs,
    }, null, 2));
    process.exit(0);
  }

  // 3. Resolve mech address
  let mechAddress = OLAS_MECH_ADDRESS;
  if (!mechAddress) {
    log("info", "olas-analyze: OLAS_MECH_ADDRESS not set, discovering from mechx mech list");
    try {
      mechAddress = await discoverMechAddress();
      log("info", `olas-analyze: discovered mech address = ${mechAddress}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("error", "olas-analyze: mech discovery failed", { error: msg });
      console.log(JSON.stringify({
        success: false,
        error: `Could not discover mech address: ${msg}. Set OLAS_MECH_ADDRESS in .env.`,
        requestCount: 0,
        successCount: 0,
        results: [],
        summary: {},
        txHashes: [],
        durationMs: Date.now() - startMs,
      }, null, 2));
      cleanupKeyFile();
      process.exit(0);
    }
  }

  log("info", `olas-analyze: using mech=${mechAddress} chain=${OLAS_CHAIN_CONFIG}`);

  // 4. Build prompts from pool state
  const prompts = buildPrompts(pool);
  log("info", `olas-analyze: running ${prompts.length} requests in parallel batches of ${PARALLEL_LIMIT}`);

  // 5. Execute all requests
  let results: OlasRequestResult[];
  try {
    results = await runBatch(prompts, mechAddress, keyFile, PARALLEL_LIMIT);
  } finally {
    cleanupKeyFile();
  }

  // 6. Aggregate
  const successCount = results.filter(r => r.success).length;
  const txHashes = results.flatMap(r => r.txHash ? [r.txHash] : []);
  const summary = aggregate(results);
  const durationMs = Date.now() - startMs;

  const output: OlasResults = {
    success: successCount > 0,
    requestCount: results.length,
    successCount,
    results,
    summary,
    txHashes,
    durationMs,
  };

  // 7. Cache results for 10 minutes (avoid re-paying for same-cycle analysis)
  if (successCount > 0) {
    setCache(OLAS_CACHE_KEY, output, TTL.TEN_MINUTES);
  }

  log("info", `olas-analyze: done — ${successCount}/${results.length} succeeded, ${txHashes.length} tx hashes`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  cleanupKeyFile();
  const msg = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ success: false, error: msg }));
  process.exit(1);
});
