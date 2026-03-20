/**
 * venice-analyze.ts — CLI tool for OpenClaw
 *
 * Two-call Venice AI pipeline:
 *   --mode sentiment  → web search ON, gathers qualitative signals
 *   --mode analyze    → web search OFF, structured data in, recommendation out
 *
 * Outputs JSON to stdout. Exits 0 on success, 1 on failure.
 *
 * Usage:
 *   npx tsx src/tools/venice-analyze.ts --mode sentiment
 *   npx tsx src/tools/venice-analyze.ts --mode analyze \
 *     --pool '<json>' --uniswap '<json>' --sentiment '<json>'
 */

import OpenAI from "openai";
import {
  VENICE_API_KEY,
  VENICE_BASE_URL,
  VENICE_PRIMARY_MODEL,
  VENICE_FALLBACK_MODEL,
  TICK_SPACING,
  MIN_FEE,
  MAX_FEE,
} from "../lib/config.js";
import type { SentimentResult, RebalanceRecommendation } from "../lib/types.js";

// ── Validate env ────────────────────────────────────────────────────

if (!VENICE_API_KEY) {
  console.error(
    JSON.stringify({ error: "VENICE_API_KEY must be set in .env" })
  );
  process.exit(1);
}

// ── Parse CLI args ──────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

const mode = getArg("mode");

if (mode !== "sentiment" && mode !== "analyze") {
  console.error(
    JSON.stringify({
      error: "Invalid or missing --mode. Must be 'sentiment' or 'analyze'.",
      usage: [
        "npx tsx src/tools/venice-analyze.ts --mode sentiment",
        "npx tsx src/tools/venice-analyze.ts --mode analyze --pool '<json>' --uniswap '<json>' --sentiment '<json>'",
      ],
    })
  );
  process.exit(1);
}

// ── OpenAI client (Venice) ──────────────────────────────────────────

const venice = new OpenAI({
  apiKey: VENICE_API_KEY,
  baseURL: VENICE_BASE_URL,
});

// ── Tool definitions ────────────────────────────────────────────────

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
- Lido TVL sustained decline (7d) → reduce confidence in any action
- Pool liquidity low → shallow depth → widen range, raise fee
- Pool volume declining → demand falling → consider wider range
- Pool price change 24h → directional signal for range positioning
- Estimated fee APY → competitive context, is our pool attractive?
- Bullish sentiment → shift range above current price
- Bearish sentiment → shift range below or widen defensively
- If data is missing or stale, reduce confidence accordingly

Respond using the recommend_rebalance function.`;

// ── Venice API call with fallback ───────────────────────────────────

async function callVenice(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  veniceParams: Record<string, unknown>
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  // venice_parameters is a Venice-specific extension not in the OpenAI types,
  // so we pass it via the body option to avoid type conflicts.
  return venice.chat.completions.create({
    model,
    messages,
    tools,
    temperature: 0.7,
    max_tokens: 2048,
    // @ts-expect-error — venice_parameters is a Venice API extension
    venice_parameters: veniceParams,
  });
}

async function callWithFallback(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  veniceParams: Record<string, unknown>
): Promise<{ response: OpenAI.Chat.Completions.ChatCompletion; model: string }> {
  // Keepalive: print progress every 10s so OpenClaw knows the process is alive
  let elapsed = 0;
  const keepalive = setInterval(() => {
    elapsed += 10;
    process.stderr.write(`{"keepalive":true,"elapsed_s":${elapsed},"model":"${VENICE_PRIMARY_MODEL}"}\n`);
  }, 10_000);

  try {
    const response = await callVenice(
      VENICE_PRIMARY_MODEL,
      messages,
      tools,
      veniceParams
    );
    clearInterval(keepalive);
    return { response, model: VENICE_PRIMARY_MODEL };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 500 || status === 503) {
      process.stderr.write(
        JSON.stringify({
          warning: `Primary model ${VENICE_PRIMARY_MODEL} returned ${status}, falling back to ${VENICE_FALLBACK_MODEL}`,
        }) + "\n"
      );
      const response = await callVenice(
        VENICE_FALLBACK_MODEL,
        messages,
        tools,
        veniceParams
      );
      clearInterval(keepalive);
      return { response, model: VENICE_FALLBACK_MODEL };
    }
    clearInterval(keepalive);
    throw err;
  }
}

// ── Extract tool call arguments ─────────────────────────────────────

function extractToolArgs(
  response: OpenAI.Chat.Completions.ChatCompletion,
  expectedFn: string
): Record<string, unknown> | null {
  const choice = response.choices[0];
  if (!choice) return null;

  // Check for tool_calls
  const toolCall = choice.message.tool_calls?.[0];
  if (toolCall && "function" in toolCall && toolCall.function.name === expectedFn) {
    return JSON.parse(toolCall.function.arguments);
  }

  // Fallback: try parsing content as JSON (some models return JSON in content)
  const content = choice.message.content;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // Not JSON — ignore
    }
  }

  return null;
}

// ── Mode: Sentiment ─────────────────────────────────────────────────

async function runSentiment(): Promise<void> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "What is the current market sentiment for wstETH/USDC? Search for recent developments, social signals, governance news, and whale activity. Report using the report_sentiment function.",
    },
  ];

  const veniceParams = {
    include_venice_system_prompt: false,
    enable_web_search: "on",
    strip_thinking_response: false,
  };

  const { response, model } = await callWithFallback(
    messages,
    [SENTIMENT_TOOL],
    veniceParams
  );

  const args = extractToolArgs(response, "report_sentiment");
  if (!args) {
    console.error(
      JSON.stringify({
        error: "Venice did not return a report_sentiment tool call",
        raw: response.choices[0]?.message?.content ?? null,
      })
    );
    process.exit(1);
  }

  // Validate
  const confidence = Number(args.confidence);
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    console.error(
      JSON.stringify({ error: `Invalid confidence: ${args.confidence}` })
    );
    process.exit(1);
  }

  const result: SentimentResult = {
    sentiment: String(args.sentiment),
    confidence,
    signals: Array.isArray(args.signals)
      ? args.signals.map(String)
      : [],
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
}

// ── Mode: Analyze ───────────────────────────────────────────────────

function buildUserMessage(
  pool: Record<string, unknown>,
  uniswap: Record<string, unknown> | null,
  sentiment: Record<string, unknown> | null
): string {
  const lines: string[] = [];
  const dataSources: string[] = ["pool-reader"];
  const missing: string[] = [];

  // Pool state (always present)
  lines.push("Pool state:");
  lines.push(`  currentTick: ${pool.currentTick ?? "unknown"}`);
  lines.push(
    `  tickLower: ${pool.tickLower}, tickUpper: ${pool.tickUpper}`
  );
  lines.push(`  totalLiquidity: ${pool.totalLiquidity}`);
  lines.push(`  currentFee: ${pool.currentFee}`);
  lines.push(`  cumulativeVolume: ${pool.cumulativeVolume ?? "unknown"}`);
  lines.push(`  idleToken0: ${pool.idleToken0 ?? "unknown"}`);
  lines.push(`  idleToken1: ${pool.idleToken1 ?? "unknown"}`);
  lines.push(
    `  accruedPerformanceFee: ${pool.accruedPerformanceFee ?? "unknown"}`
  );
  lines.push("");

  // Uniswap Trading API data
  if (uniswap) {
    dataSources.push("uniswap-data");
    lines.push("Uniswap Trading API data:");
    if (uniswap.forwardPrice != null)
      lines.push(`  Forward price (1 wstETH → USDC): $${uniswap.forwardPrice}`);
    if (uniswap.reversePrice != null)
      lines.push(`  Reverse price (USDC → 1 wstETH): $${uniswap.reversePrice}`);
    if (uniswap.spread != null)
      lines.push(
        `  Spread: $${uniswap.spread} (${uniswap.spreadBps ?? "?"} bps)`
      );
    if (uniswap.priceImpact10x != null)
      lines.push(
        `  Price impact at 10x: ${uniswap.priceImpactBps ?? "?"} bps`
      );
    if (uniswap.gasEstimate != null)
      lines.push(`  Gas estimate: ${uniswap.gasEstimate}`);
    if (uniswap.approvalActive != null)
      lines.push(
        `  Approval: ${uniswap.approvalActive ? "active" : "needs approval"}`
      );

    // On-chain analytics sub-object (DeFiLlama + DexScreener)
    const oca = uniswap.onChainAnalytics as Record<string, unknown> | undefined;
    if (oca) {
      lines.push("");
      lines.push("On-chain analytics:");

      // DeFiLlama — Lido protocol TVL
      if (oca.lidoTvl != null) {
        const tvlB = (Number(oca.lidoTvl) / 1e9).toFixed(1);
        lines.push(
          `  Lido TVL: $${tvlB}B (${oca.lidoTvlChange24h != null ? `${Number(oca.lidoTvlChange24h).toFixed(1)}% 24h` : "?"}, ${oca.lidoTvlChange7d != null ? `${Number(oca.lidoTvlChange7d).toFixed(1)}% 7d` : "?"})`
        );
      }

      // DexScreener — pool-level data
      if (oca.poolLiquidity != null)
        lines.push(`  Pool liquidity (USD): $${Number(oca.poolLiquidity).toLocaleString()}`);
      if (oca.poolVolume24h != null)
        lines.push(`  Pool 24h volume: $${Number(oca.poolVolume24h).toLocaleString()}`);
      if (oca.poolPriceUsd != null)
        lines.push(`  Pool price: $${oca.poolPriceUsd}`);
      if (oca.poolPriceChange24h != null)
        lines.push(`  Price change 24h: ${Number(oca.poolPriceChange24h).toFixed(2)}%`);
      if (oca.poolFeeApyEstimate != null)
        lines.push(
          `  Estimated fee APY: ${Number(oca.poolFeeApyEstimate).toFixed(1)}%`
        );
    }
  } else {
    missing.push("uniswap-data");
    lines.push(
      "Uniswap Trading API data: UNAVAILABLE — make decision with pool state only."
    );
  }
  lines.push("");

  // Sentiment
  if (sentiment) {
    dataSources.push("venice-sentiment");
    lines.push("Sentiment (from Venice web search):");
    lines.push(
      `  Overall: ${sentiment.sentiment} (confidence ${sentiment.confidence})`
    );
    if (Array.isArray(sentiment.signals)) {
      lines.push("  Signals:");
      for (const s of sentiment.signals) {
        lines.push(`    - ${s}`);
      }
    }
  } else {
    missing.push("venice-sentiment");
    lines.push(
      "Sentiment: UNAVAILABLE — make decision without qualitative signals."
    );
  }
  lines.push("");

  lines.push("Recommend optimal parameters.");

  return lines.join("\n");
}

async function runAnalyze(): Promise<void> {
  // Parse required --pool arg
  const poolRaw = getArg("pool");
  if (!poolRaw) {
    console.error(
      JSON.stringify({
        error: "--pool <json> is required for analyze mode",
      })
    );
    process.exit(1);
  }

  let pool: Record<string, unknown>;
  try {
    pool = JSON.parse(poolRaw);
  } catch {
    console.error(
      JSON.stringify({ error: "Failed to parse --pool JSON" })
    );
    process.exit(1);
  }

  // Parse optional --uniswap and --sentiment args
  let uniswap: Record<string, unknown> | null = null;
  let sentiment: Record<string, unknown> | null = null;

  const uniswapRaw = getArg("uniswap");
  if (uniswapRaw) {
    try {
      uniswap = JSON.parse(uniswapRaw);
    } catch {
      console.error(
        JSON.stringify({ warning: "Failed to parse --uniswap JSON, proceeding without it" })
      );
    }
  }

  const sentimentRaw = getArg("sentiment");
  if (sentimentRaw) {
    try {
      sentiment = JSON.parse(sentimentRaw);
    } catch {
      console.error(
        JSON.stringify({ warning: "Failed to parse --sentiment JSON, proceeding without it" })
      );
    }
  }

  // Build messages
  const userMessage = buildUserMessage(pool, uniswap, sentiment);

  const dataSources: string[] = ["pool-reader"];
  const missingData: string[] = [];
  if (uniswap) dataSources.push("uniswap-data");
  else missingData.push("uniswap-data");
  const ocaCheck = uniswap?.onChainAnalytics as Record<string, unknown> | undefined;
  if (ocaCheck?.lidoTvl != null) dataSources.push("defillama");
  else missingData.push("defillama");
  if (ocaCheck?.poolLiquidity != null) dataSources.push("dexscreener");
  else missingData.push("dexscreener");
  if (sentiment) dataSources.push("venice-sentiment");
  else missingData.push("venice-sentiment");

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: ANALYZE_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const veniceParams = {
    include_venice_system_prompt: false,
    enable_web_search: "off",
    strip_thinking_response: false,
    disable_thinking: false,
  };

  const { response, model } = await callWithFallback(
    messages,
    [REBALANCE_TOOL],
    veniceParams
  );

  const args = extractToolArgs(response, "recommend_rebalance");
  if (!args) {
    console.error(
      JSON.stringify({
        error: "Venice did not return a recommend_rebalance tool call",
        raw: response.choices[0]?.message?.content ?? null,
      })
    );
    process.exit(1);
  }

  // Validate
  const newTickLower = Number(args.newTickLower);
  const newTickUpper = Number(args.newTickUpper);
  const newFee = Number(args.newFee);
  const confidence = Number(args.confidence);

  const errors: string[] = [];
  if (isNaN(newTickLower) || newTickLower % TICK_SPACING !== 0)
    errors.push(`newTickLower (${args.newTickLower}) must be divisible by ${TICK_SPACING}`);
  if (isNaN(newTickUpper) || newTickUpper % TICK_SPACING !== 0)
    errors.push(`newTickUpper (${args.newTickUpper}) must be divisible by ${TICK_SPACING}`);
  if (newTickUpper <= newTickLower)
    errors.push(`newTickUpper (${newTickUpper}) must be > newTickLower (${newTickLower})`);
  if (isNaN(newFee) || newFee < MIN_FEE || newFee > MAX_FEE)
    errors.push(`newFee (${args.newFee}) must be between ${MIN_FEE} and ${MAX_FEE}`);
  if (isNaN(confidence) || confidence < 0 || confidence > 1)
    errors.push(`confidence (${args.confidence}) must be between 0 and 1`);

  if (errors.length > 0) {
    console.error(
      JSON.stringify({
        error: "Venice recommendation failed validation",
        validationErrors: errors,
        raw: args,
      })
    );
    process.exit(1);
  }

  const result: RebalanceRecommendation = {
    newTickLower,
    newTickUpper,
    newFee,
    confidence,
    reasoning: String(args.reasoning ?? ""),
    dataSources,
    missingData,
    model,
  };

  console.log(JSON.stringify(result, null, 2));
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Print immediately so OpenClaw knows the process is alive (prevents early kill)
  process.stderr.write(`{"status":"running","mode":"${mode}","model":"${VENICE_PRIMARY_MODEL}","ts":"${new Date().toISOString()}"}\n`);
  if (mode === "sentiment") {
    await runSentiment();
  } else {
    await runAnalyze();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({ error: err.message ?? String(err) })
  );
  process.exit(1);
});
