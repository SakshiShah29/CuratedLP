/**
 * eigencompute-server.ts — HTTP server for EigenCompute TEE deployment
 *
 * Runs both Venice AI calls (sentiment + analysis) inside an EigenCompute
 * Trusted Execution Environment (Intel TDX). The TEE attestation covers
 * the full pipeline: sentiment gathering → data assembly → analysis →
 * recommendation output.
 *
 * Endpoints:
 *   POST /inference  — Run full Venice pipeline (sentiment + analysis)
 *   GET  /health     — Health check
 *
 * Binds 0.0.0.0:3000 (required by EigenCompute TEE environment).
 *
 * Docker deployment:
 *   docker build --platform linux/amd64 -t curatedlp/venice-analyzer .
 *   ecloud compute app deploy
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import OpenAI from "openai";

// ── Config (env vars injected by EigenCompute KMS at runtime) ───────

const VENICE_API_KEY = process.env.VENICE_API_KEY ?? "";
const VENICE_BASE_URL =
  process.env.VENICE_BASE_URL ?? "https://api.venice.ai/api/v1";
const VENICE_PRIMARY_MODEL =
  process.env.VENICE_PRIMARY_MODEL ?? "zai-org-glm-4.7";
const VENICE_FALLBACK_MODEL =
  process.env.VENICE_FALLBACK_MODEL ?? "llama-3.3-70b";
const PORT = parseInt(process.env.APP_PORT ?? process.env.PORT ?? "3000", 10);
const TICK_SPACING = 60;
const MIN_FEE = 100;
const MAX_FEE = 100000;

if (!VENICE_API_KEY) {
  console.error("VENICE_API_KEY must be set");
  process.exit(1);
}

// ── Venice client ───────────────────────────────────────────────────

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

  // 1. Check tool_calls (preferred)
  const toolCall = choice.message.tool_calls?.[0];
  if (
    toolCall &&
    "function" in toolCall &&
    toolCall.function.name === expectedFn
  ) {
    return JSON.parse(toolCall.function.arguments);
  }

  // 2. Try parsing entire content as JSON
  const content = choice.message.content;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed === "object" && parsed !== null) return parsed;
    } catch {
      // Not pure JSON — try extracting from prose
    }

    // 3. Extract JSON object embedded in prose text (e.g. ```json ... ```)
    const jsonMatch = content.match(/\{[\s\S]*"(?:newTickLower|sentiment|confidence)"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed === "object" && parsed !== null) return parsed;
      } catch {
        // Malformed JSON
      }
    }
  }
  return null;
}

async function callVenice(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  veniceParams: Record<string, unknown>,
  forceTool?: string
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  return venice.chat.completions.create({
    model,
    messages,
    tools,
    tool_choice: forceTool
      ? { type: "function" as const, function: { name: forceTool } }
      : undefined,
    temperature: 0.7,
    max_tokens: 4096,
    // @ts-expect-error — venice_parameters is a Venice API extension
    venice_parameters: veniceParams,
  });
}

async function callWithFallback(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
  veniceParams: Record<string, unknown>,
  forceTool?: string
): Promise<{ response: OpenAI.Chat.Completions.ChatCompletion; model: string }> {
  try {
    const response = await callVenice(
      VENICE_PRIMARY_MODEL,
      messages,
      tools,
      veniceParams,
      forceTool
    );
    return { response, model: VENICE_PRIMARY_MODEL };
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 500 || status === 503) {
      const response = await callVenice(
        VENICE_FALLBACK_MODEL,
        messages,
        tools,
        veniceParams,
        forceTool
      );
      return { response, model: VENICE_FALLBACK_MODEL };
    }
    throw err;
  }
}

function buildUserMessage(
  pool: Record<string, unknown>,
  uniswapData: Record<string, unknown> | null,
  sentimentData: Record<string, unknown> | null
): string {
  const lines: string[] = [];

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
    `  accruedPerformanceFee0: ${pool.accruedPerformanceFee0 ?? "unknown"}`
  );
  lines.push(
    `  accruedPerformanceFee1: ${pool.accruedPerformanceFee1 ?? "unknown"}`
  );
  lines.push("");

  if (uniswapData) {
    lines.push("Uniswap Trading API data:");
    if (uniswapData.forwardPrice != null)
      lines.push(
        `  Forward price (1 wstETH → USDC): $${uniswapData.forwardPrice}`
      );
    if (uniswapData.reversePrice != null)
      lines.push(
        `  Reverse price (USDC → 1 wstETH): $${uniswapData.reversePrice}`
      );
    if (uniswapData.spread != null)
      lines.push(
        `  Spread: $${uniswapData.spread} (${uniswapData.spreadBps ?? "?"} bps)`
      );
    if (uniswapData.priceImpact10x != null)
      lines.push(
        `  Price impact at 10x: ${uniswapData.priceImpactBps ?? "?"} bps`
      );
    if (uniswapData.gasEstimate != null)
      lines.push(`  Gas estimate: ${uniswapData.gasEstimate}`);
    if (uniswapData.approvalActive != null)
      lines.push(
        `  Approval: ${uniswapData.approvalActive ? "active" : "needs approval"}`
      );

    const oca = uniswapData.onChainAnalytics as
      | Record<string, unknown>
      | undefined;
    if (oca) {
      lines.push("");
      lines.push("On-chain analytics:");
      if (oca.lidoTvl != null) {
        const tvlB = (Number(oca.lidoTvl) / 1e9).toFixed(1);
        lines.push(
          `  Lido TVL: $${tvlB}B (${oca.lidoTvlChange24h != null ? `${Number(oca.lidoTvlChange24h).toFixed(1)}% 24h` : "?"}, ${oca.lidoTvlChange7d != null ? `${Number(oca.lidoTvlChange7d).toFixed(1)}% 7d` : "?"})`
        );
      }
      if (oca.poolLiquidity != null)
        lines.push(
          `  Pool liquidity (USD): $${Number(oca.poolLiquidity).toLocaleString()}`
        );
      if (oca.poolVolume24h != null)
        lines.push(
          `  Pool 24h volume: $${Number(oca.poolVolume24h).toLocaleString()}`
        );
    }
  } else {
    lines.push(
      "Uniswap Trading API data: UNAVAILABLE — make decision with pool state only."
    );
  }
  lines.push("");

  if (sentimentData) {
    lines.push("Sentiment (from Venice web search):");
    lines.push(
      `  Overall: ${sentimentData.sentiment} (confidence ${sentimentData.confidence})`
    );
    if (Array.isArray(sentimentData.signals)) {
      lines.push("  Signals:");
      for (const s of sentimentData.signals) {
        lines.push(`    - ${s}`);
      }
    }
  } else {
    lines.push(
      "Sentiment: UNAVAILABLE — make decision without qualitative signals."
    );
  }
  lines.push("");
  lines.push("Recommend optimal parameters.");

  return lines.join("\n");
}

// ── Inference pipeline ──────────────────────────────────────────────

interface InferenceInput {
  pool: Record<string, unknown>;
  uniswap?: Record<string, unknown> | null;
}

interface InferenceOutput {
  sentiment: Record<string, unknown> | null;
  recommendation: Record<string, unknown>;
  computeJobId: string;
  attestationHash: string;
  teeProvider: string;
  model: string;
}

async function runInference(input: InferenceInput): Promise<InferenceOutput> {
  const jobId = `tee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Step 1: Venice sentiment (web search ON)
  let sentiment: Record<string, unknown> | null = null;
  try {
    const sentimentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      [
        { role: "system", content: SENTIMENT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            "What is the current market sentiment for wstETH/USDC? Search for recent developments, social signals, governance news, and whale activity. Report using the report_sentiment function.",
        },
      ];

    const { response: sentimentResp } = await callWithFallback(
      sentimentMessages,
      [SENTIMENT_TOOL],
      {
        include_venice_system_prompt: false,
        enable_web_search: "on",
        strip_thinking_response: false,
      },
      "report_sentiment"
    );

    const sentArgs = extractToolArgs(sentimentResp, "report_sentiment");
    if (sentArgs) {
      sentiment = {
        sentiment: String(sentArgs.sentiment),
        confidence: Number(sentArgs.confidence),
        signals: Array.isArray(sentArgs.signals)
          ? sentArgs.signals.map(String)
          : [],
        timestamp: new Date().toISOString(),
      };
    }
  } catch (err: unknown) {
    console.error(`Sentiment call failed: ${(err as Error).message}`);
  }

  // Step 2: Venice analysis (web search OFF, all data + sentiment)
  const userMessage = buildUserMessage(
    input.pool,
    input.uniswap ?? null,
    sentiment
  );

  const dataSources: string[] = ["pool-reader"];
  const missingData: string[] = [];
  if (input.uniswap) dataSources.push("uniswap-data");
  else missingData.push("uniswap-data");
  if (sentiment) dataSources.push("venice-sentiment");
  else missingData.push("venice-sentiment");

  const { response: analyzeResp, model } = await callWithFallback(
    [
      { role: "system", content: ANALYZE_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    [REBALANCE_TOOL],
    {
      include_venice_system_prompt: false,
      enable_web_search: "off",
      strip_thinking_response: false,
    },
    "recommend_rebalance"
  );

  const args = extractToolArgs(analyzeResp, "recommend_rebalance");
  if (!args) {
    const raw = analyzeResp.choices[0]?.message;
    throw new Error(
      "Venice did not return a recommend_rebalance tool call. " +
      `finish_reason=${analyzeResp.choices[0]?.finish_reason}, ` +
      `has_tool_calls=${!!raw?.tool_calls?.length}, ` +
      `content_preview=${raw?.content?.slice(0, 200) ?? "null"}`
    );
  }

  // Validate and snap ticks to nearest valid tick spacing
  const snapTick = (tick: number) => Math.round(tick / TICK_SPACING) * TICK_SPACING;
  const rawTickLower = Number(args.newTickLower);
  const rawTickUpper = Number(args.newTickUpper);
  const newTickLower = isNaN(rawTickLower) ? rawTickLower : snapTick(rawTickLower);
  const newTickUpper = isNaN(rawTickUpper) ? rawTickUpper : snapTick(rawTickUpper);
  const newFee = Number(args.newFee);
  const confidence = Number(args.confidence);

  const errors: string[] = [];
  if (isNaN(newTickLower))
    errors.push(`newTickLower is not a number`);
  if (isNaN(newTickUpper))
    errors.push(`newTickUpper is not a number`);
  if (newTickUpper <= newTickLower)
    errors.push(`newTickUpper must be > newTickLower`);
  if (isNaN(newFee) || newFee < MIN_FEE || newFee > MAX_FEE)
    errors.push(`newFee must be between ${MIN_FEE} and ${MAX_FEE}`);
  if (isNaN(confidence) || confidence < 0 || confidence > 1)
    errors.push(`confidence must be between 0 and 1`);

  if (errors.length > 0) {
    throw new Error("Validation failed: " + errors.join("; "));
  }

  // Build a content hash as an integrity proof within the TEE
  // (The real attestation comes from the EigenCompute TEE platform itself)
  const contentForHash = JSON.stringify({
    input: { pool: input.pool, uniswap: input.uniswap },
    sentiment,
    recommendation: args,
    jobId,
    timestamp: Date.now(),
  });
  let hash = 0;
  for (let i = 0; i < contentForHash.length; i++) {
    hash = ((hash << 5) - hash + contentForHash.charCodeAt(i)) | 0;
  }
  const attestationHash = `tee-content-${Math.abs(hash).toString(16).padStart(8, "0")}`;

  return {
    sentiment,
    recommendation: {
      newTickLower,
      newTickUpper,
      newFee,
      confidence,
      reasoning: String(args.reasoning ?? ""),
      dataSources,
      missingData,
      model,
    },
    computeJobId: jobId,
    attestationHash,
    teeProvider: "eigencompute",
    model,
  };
}

// ── HTTP helpers ────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ── HTTP server ─────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS headers for flexibility
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      status: "ok",
      teeProvider: "eigencompute",
      model: VENICE_PRIMARY_MODEL,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // POST /inference
  if (req.method === "POST" && req.url === "/inference") {
    try {
      const body = await readBody(req);
      const input = JSON.parse(body) as InferenceInput;

      if (!input.pool || typeof input.pool !== "object") {
        sendJson(res, 400, { error: "Request body must include 'pool' object" });
        return;
      }

      console.log(
        `[${new Date().toISOString()}] Inference request received`
      );

      const result = await runInference(input);

      console.log(
        `[${new Date().toISOString()}] Inference complete: jobId=${result.computeJobId}`
      );

      sendJson(res, 200, result);
    } catch (err: unknown) {
      console.error(`Inference error: ${(err as Error).message}`);
      sendJson(res, 500, { error: (err as Error).message });
    }
    return;
  }

  // 404
  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `EigenCompute Venice Analyzer TEE service listening on 0.0.0.0:${PORT}`
  );
  console.log(`  POST /inference  — Run full Venice pipeline`);
  console.log(`  GET  /health     — Health check`);
  console.log(`  Model: ${VENICE_PRIMARY_MODEL} (fallback: ${VENICE_FALLBACK_MODEL})`);
});
