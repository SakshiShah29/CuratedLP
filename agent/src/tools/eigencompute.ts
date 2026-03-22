/**
 * eigencompute.ts — CLI tool for OpenClaw (EigenCloud bounty)
 *
 * Wraps the Venice AI inference pipeline in verifiable compute via EigenCompute.
 * Calls a deployed EigenCompute TEE service that runs both Venice calls
 * (sentiment + analysis) inside Intel TDX. Single attestation covers the
 * full pipeline.
 *
 * Falls back to direct Venice calls (unverified) if the TEE is unavailable.
 *
 * Outputs EigenComputeResult JSON to stdout. Exits 0 on success, 1 on failure.
 *
 * Usage:
 *   npx tsx src/tools/eigencompute.ts --pool '<json>' --uniswap '<json>'
 */

import OpenAI from "openai";
import {
  VENICE_API_KEY,
  VENICE_BASE_URL,
  VENICE_PRIMARY_MODEL,
  VENICE_FALLBACK_MODEL,
  EIGENCOMPUTE_MODE,
  EIGENCOMPUTE_ENDPOINT,
  TICK_SPACING,
  MIN_FEE,
  MAX_FEE,
} from "../lib/config.js";
import { log } from "../lib/logger.js";
import type {
  SentimentResult,
  EigenComputeResult,
} from "../lib/types.js";

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

const poolRaw = getArg("pool");
const uniswapRaw = getArg("uniswap");

if (!poolRaw) {
  console.error(
    JSON.stringify({
      error: "--pool <json> is required",
      usage:
        "npx tsx src/tools/eigencompute.ts --pool '<json>' --uniswap '<json>'",
    })
  );
  process.exit(1);
}

let pool: Record<string, unknown>;
try {
  pool = JSON.parse(poolRaw);
} catch {
  console.error(JSON.stringify({ error: "Failed to parse --pool JSON" }));
  process.exit(1);
}

let uniswap: Record<string, unknown> | null = null;
if (uniswapRaw) {
  try {
    uniswap = JSON.parse(uniswapRaw);
  } catch {
    process.stderr.write(
      JSON.stringify({ warning: "Failed to parse --uniswap JSON, proceeding without it" }) + "\n"
    );
  }
}

// ── Tool definitions (shared with venice-analyze) ───────────────────

const SENTIMENT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "report_sentiment",
    description:
      "Report the current market sentiment for wstETH/USDC and the broader ETH ecosystem",
    parameters: {
      type: "object",
      properties: {
        sentiment: {
          type: "string",
          description:
            'Overall sentiment: "bullish", "bearish", "neutral", "moderately_bullish", or "moderately_bearish"',
        },
        confidence: {
          type: "number",
          description: "Confidence score from 0 to 1",
        },
        signals: {
          type: "array",
          items: { type: "string" },
          description: "3-5 key observations with source context",
        },
      },
      required: ["sentiment", "confidence", "signals"],
    },
  },
};

const REBALANCE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "recommend_rebalance",
    description:
      "Recommend optimal tick range, fee, and confidence for a Uniswap v4 LP vault rebalance",
    parameters: {
      type: "object",
      properties: {
        newTickLower: {
          type: "integer",
          description: "Lower tick boundary (must be divisible by 60)",
        },
        newTickUpper: {
          type: "integer",
          description:
            "Upper tick boundary (must be divisible by 60, > newTickLower)",
        },
        newFee: {
          type: "integer",
          description:
            "Swap fee in hundredths of a bip (100 = 0.01%, 3000 = 0.30%, max 100000 = 10%)",
        },
        confidence: {
          type: "number",
          description: "Confidence score from 0 to 1",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation of the recommendation",
        },
      },
      required: [
        "newTickLower",
        "newTickUpper",
        "newFee",
        "confidence",
        "reasoning",
      ],
    },
  },
};

// ── System prompts ──────────────────────────────────────────────────

const SENTIMENT_SYSTEM_PROMPT = `You are a DeFi sentiment analyst. Search for current information about wstETH, Lido, and the ETH ecosystem. Summarize:

1. Social media sentiment (Twitter/X, Reddit, CT)
2. Governance news (Lido proposals, ETH protocol changes)
3. Whale movements (large wstETH transfers, Aave/Compound deposits)
4. Market mood (risk-on vs risk-off, macro events affecting crypto)

Respond using the report_sentiment function with fields:
- sentiment: "bullish" | "bearish" | "neutral" | "moderately_bullish" | "moderately_bearish"
- confidence: 0 to 1
- signals: array of 3-5 key observations with source context`;

const ANALYZE_SYSTEM_PROMPT = `You are an AI agent managing concentrated liquidity for a wstETH/USDC pool on Uniswap v4 on Base.

You will receive:
1. On-chain pool state (tick range, liquidity, fee, idle balances)
2. Structured market data from the Uniswap Trading API (price, spread, depth)
3. On-chain analytics: DeFiLlama (Lido protocol TVL) + DexScreener (pool liquidity, volume, price, estimated APY)
4. Sentiment analysis (social signals, governance news, whale movements)

Use ALL of this data to recommend:

1. Optimal tick range [tickLower, tickUpper] (must be divisible by 60)
2. Recommended swap fee (100 = 0.01%, 3000 = 0.30%, max 100000 = 10%)
3. Confidence score 0 to 1
4. Brief reasoning explaining your recommendation

Key decision signals:
- Spread (bid/ask width): wide spread → raise fee, widen range
- Price impact at 10x: high impact → shallow depth → widen range
- Price impact > current fee → fee is too low for the liquidity depth
- Lido TVL declining → capital flight → widen range defensively
- Pool liquidity low → shallow depth → widen range, raise fee
- Bullish sentiment → shift range above current price
- Bearish sentiment → shift range below or widen defensively
- If data is missing or stale, reduce confidence accordingly

Respond using the recommend_rebalance function.`;

// ── Helpers ─────────────────────────────────────────────────────────

function extractToolArgs(
  response: OpenAI.Chat.Completions.ChatCompletion,
  expectedFn: string
): Record<string, unknown> | null {
  const choice = response.choices[0];
  if (!choice) return null;

  const toolCall = choice.message.tool_calls?.[0];
  if (
    toolCall &&
    "function" in toolCall &&
    toolCall.function.name === expectedFn
  ) {
    return JSON.parse(toolCall.function.arguments);
  }

  // Fallback: try parsing content as JSON
  const content = choice.message.content;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // Not JSON
    }
  }
  return null;
}

function validateRecommendation(args: Record<string, unknown>): {
  valid: boolean;
  errors: string[];
  parsed: {
    newTickLower: number;
    newTickUpper: number;
    newFee: number;
    confidence: number;
    reasoning: string;
  };
} {
  const newTickLower = Number(args.newTickLower);
  const newTickUpper = Number(args.newTickUpper);
  const newFee = Number(args.newFee);
  const confidence = Number(args.confidence);
  const errors: string[] = [];

  if (isNaN(newTickLower) || newTickLower % TICK_SPACING !== 0)
    errors.push(
      `newTickLower (${args.newTickLower}) must be divisible by ${TICK_SPACING}`
    );
  if (isNaN(newTickUpper) || newTickUpper % TICK_SPACING !== 0)
    errors.push(
      `newTickUpper (${args.newTickUpper}) must be divisible by ${TICK_SPACING}`
    );
  if (newTickUpper <= newTickLower)
    errors.push(
      `newTickUpper (${newTickUpper}) must be > newTickLower (${newTickLower})`
    );
  if (isNaN(newFee) || newFee < MIN_FEE || newFee > MAX_FEE)
    errors.push(
      `newFee (${args.newFee}) must be between ${MIN_FEE} and ${MAX_FEE}`
    );
  if (isNaN(confidence) || confidence < 0 || confidence > 1)
    errors.push(
      `confidence (${args.confidence}) must be between 0 and 1`
    );

  return {
    valid: errors.length === 0,
    errors,
    parsed: {
      newTickLower,
      newTickUpper,
      newFee,
      confidence,
      reasoning: String(args.reasoning ?? ""),
    },
  };
}

// ── TEE Mode ────────────────────────────────────────────────────────
// Call deployed EigenCompute TEE service running full Venice pipeline

async function runTEEMode(): Promise<EigenComputeResult> {
  if (!EIGENCOMPUTE_ENDPOINT) {
    throw new Error(
      "EIGENCOMPUTE_ENDPOINT must be set for tee mode"
    );
  }

  process.stderr.write(
    JSON.stringify({
      status: "tee_mode",
      endpoint: EIGENCOMPUTE_ENDPOINT,
      ts: new Date().toISOString(),
    }) + "\n"
  );

  const body = JSON.stringify({ pool, uniswap });

  const response = await fetch(`${EIGENCOMPUTE_ENDPOINT}/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(240_000), // 4min timeout — TEE Venice calls are slower than local
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `EigenCompute TEE returned ${response.status}: ${text}`
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  // The TEE service returns the full inference result
  const recommendation = data.recommendation as Record<string, unknown>;
  const sentimentData = data.sentiment as Record<string, unknown> | null;

  if (!recommendation) {
    throw new Error("TEE service returned no recommendation");
  }

  const { valid, errors, parsed } = validateRecommendation(recommendation);
  if (!valid) {
    throw new Error(
      "TEE recommendation failed validation: " + errors.join("; ")
    );
  }

  const result: EigenComputeResult = {
    ...parsed,
    dataSources: (recommendation.dataSources as string[]) ?? ["pool-reader"],
    missingData: (recommendation.missingData as string[]) ?? [],
    model: (recommendation.model as string) ?? "tee-venice",
    sentiment: sentimentData
      ? {
          sentiment: String(sentimentData.sentiment ?? "unknown"),
          confidence: Number(sentimentData.confidence ?? 0),
          signals: Array.isArray(sentimentData.signals)
            ? sentimentData.signals.map(String)
            : [],
          timestamp: String(
            sentimentData.timestamp ?? new Date().toISOString()
          ),
        }
      : {
          sentiment: "unknown",
          confidence: 0,
          signals: [],
          timestamp: new Date().toISOString(),
        },
    attestationHash: String(data.attestationHash ?? ""),
    teeProvider: "eigencompute",
    computeJobId: String(data.computeJobId ?? ""),
    verifiable: Boolean(data.attestationHash),
  };

  log("info", "eigencompute: TEE analysis complete", {
    mode: "tee",
    computeJobId: result.computeJobId,
    attestationHash: result.attestationHash
      ? result.attestationHash.slice(0, 16) + "..."
      : "none",
    verifiable: result.verifiable,
  });

  return result;
}

// ── Fallback: Direct Venice (unverified) ────────────────────────────

async function runVeniceFallback(): Promise<EigenComputeResult> {
  if (!VENICE_API_KEY) {
    throw new Error("VENICE_API_KEY must be set for Venice fallback");
  }

  process.stderr.write(
    JSON.stringify({
      status: "fallback_mode",
      warning: "Running Venice directly without verifiable compute",
      ts: new Date().toISOString(),
    }) + "\n"
  );

  const client = new OpenAI({
    apiKey: VENICE_API_KEY,
    baseURL: VENICE_BASE_URL,
  });

  // Call #1: Sentiment
  let sentiment: SentimentResult | null = null;
  try {
    const sentimentResp = await client.chat.completions.create({
      model: VENICE_PRIMARY_MODEL,
      messages: [
        { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "What is the current market sentiment for wstETH/USDC? Search for recent developments, social signals, governance news, and whale activity. Report using the report_sentiment function.",
        },
      ],
      tools: [SENTIMENT_TOOL],
      temperature: 0.7,
      max_tokens: 2048,
      // @ts-expect-error — venice_parameters is a Venice API extension
      venice_parameters: {
        include_venice_system_prompt: false,
        enable_web_search: "on",
        strip_thinking_response: false,
      },
    });

    const sentArgs = extractToolArgs(sentimentResp, "report_sentiment");
    if (sentArgs) {
      const conf = Number(sentArgs.confidence);
      if (!isNaN(conf) && conf >= 0 && conf <= 1) {
        sentiment = {
          sentiment: String(sentArgs.sentiment),
          confidence: conf,
          signals: Array.isArray(sentArgs.signals)
            ? sentArgs.signals.map(String)
            : [],
          timestamp: new Date().toISOString(),
        };
      }
    }
  } catch (err: unknown) {
    process.stderr.write(
      JSON.stringify({
        warning: "Venice sentiment call failed",
        error: (err as Error).message,
      }) + "\n"
    );
  }

  // Call #2: Analysis
  const lines: string[] = [];
  lines.push("Pool state:");
  lines.push(`  currentTick: ${pool.currentTick ?? "unknown"}`);
  lines.push(`  tickLower: ${pool.tickLower}, tickUpper: ${pool.tickUpper}`);
  lines.push(`  totalLiquidity: ${pool.totalLiquidity}`);
  lines.push(`  currentFee: ${pool.currentFee}`);
  lines.push(`  idleToken0: ${pool.idleToken0 ?? "unknown"}`);
  lines.push(`  idleToken1: ${pool.idleToken1 ?? "unknown"}`);
  lines.push("");

  if (uniswap) {
    lines.push("Uniswap Trading API data:");
    if (uniswap.forwardPrice != null) lines.push(`  Forward price: $${uniswap.forwardPrice}`);
    if (uniswap.spread != null) lines.push(`  Spread: ${uniswap.spreadBps ?? "?"} bps`);
    if (uniswap.priceImpact10x != null) lines.push(`  Price impact at 10x: ${uniswap.priceImpactBps ?? "?"} bps`);
  } else {
    lines.push("Uniswap Trading API data: UNAVAILABLE");
  }
  lines.push("");

  if (sentiment) {
    lines.push(`Sentiment: ${sentiment.sentiment} (confidence ${sentiment.confidence})`);
    if (sentiment.signals.length > 0) {
      lines.push("  Signals:");
      for (const s of sentiment.signals) lines.push(`    - ${s}`);
    }
  } else {
    lines.push("Sentiment: UNAVAILABLE");
  }
  lines.push("");
  lines.push("Recommend optimal parameters.");

  const dataSources: string[] = ["pool-reader"];
  const missingData: string[] = [];
  if (uniswap) dataSources.push("uniswap-data");
  else missingData.push("uniswap-data");
  if (sentiment) dataSources.push("venice-sentiment");
  else missingData.push("venice-sentiment");

  let usedModel = VENICE_PRIMARY_MODEL;
  let response: OpenAI.Chat.Completions.ChatCompletion;

  try {
    response = await client.chat.completions.create({
      model: VENICE_PRIMARY_MODEL,
      messages: [
        { role: "system", content: ANALYZE_SYSTEM_PROMPT },
        { role: "user", content: lines.join("\n") },
      ],
      tools: [REBALANCE_TOOL],
      temperature: 0.7,
      max_tokens: 2048,
      // @ts-expect-error — venice_parameters is a Venice API extension
      venice_parameters: {
        include_venice_system_prompt: false,
        enable_web_search: "off",
        strip_thinking_response: false,
      },
    });
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 500 || status === 503) {
      usedModel = VENICE_FALLBACK_MODEL;
      response = await client.chat.completions.create({
        model: VENICE_FALLBACK_MODEL,
        messages: [
          { role: "system", content: ANALYZE_SYSTEM_PROMPT },
          { role: "user", content: lines.join("\n") },
        ],
        tools: [REBALANCE_TOOL],
        temperature: 0.7,
        max_tokens: 2048,
        // @ts-expect-error — venice_parameters is a Venice API extension
        venice_parameters: {
          include_venice_system_prompt: false,
          enable_web_search: "off",
          strip_thinking_response: false,
        },
      });
    } else {
      throw err;
    }
  }

  const args = extractToolArgs(response, "recommend_rebalance");
  if (!args) {
    throw new Error(
      "Venice fallback did not return a recommend_rebalance tool call"
    );
  }

  const { valid, errors, parsed } = validateRecommendation(args);
  if (!valid) {
    throw new Error(
      "Venice fallback recommendation failed validation: " + errors.join("; ")
    );
  }

  return {
    ...parsed,
    dataSources,
    missingData,
    model: usedModel,
    sentiment: sentiment ?? {
      sentiment: "unknown",
      confidence: 0,
      signals: [],
      timestamp: new Date().toISOString(),
    },
    attestationHash: "",
    teeProvider: "eigencompute",
    computeJobId: "fallback-unverified",
    verifiable: false,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stderr.write(
    JSON.stringify({
      status: "starting",
      mode: EIGENCOMPUTE_MODE,
      ts: new Date().toISOString(),
    }) + "\n"
  );

  // Keepalive: print progress every 15s so OpenClaw knows the process is alive
  let elapsed = 0;
  const keepalive = setInterval(() => {
    elapsed += 15;
    process.stderr.write(
      `{"keepalive":true,"elapsed_s":${elapsed},"mode":"${EIGENCOMPUTE_MODE}"}\n`
    );
  }, 15_000);

  let result: EigenComputeResult;

  try {
    if (EIGENCOMPUTE_MODE === "tee") {
      try {
        result = await runTEEMode();
      } catch (err: unknown) {
        process.stderr.write(
          JSON.stringify({
            warning: "TEE mode failed, falling back to Venice direct",
            error: (err as Error).message,
          }) + "\n"
        );
        result = await runVeniceFallback();
      }
    } else {
      // mode === "off"
      result = await runVeniceFallback();
    }
  } finally {
    clearInterval(keepalive);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
});
