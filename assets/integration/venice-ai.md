# Venice AI Integration Reference

*Source: https://docs.venice.ai/llms-full.txt*
*Last updated: 2026-03-20 (v2 — aligned with revised Phase 4 plan)*

---

## What Is Venice AI

Venice AI provides HTTP-based REST and streaming interfaces for AI inference with **uncensored models and private inference** — no data retention, no restrictive content policies. Existing OpenAI SDKs work by pointing `baseURL` at Venice.

---

## Role in CuratedLP

Venice AI is the **intelligence layer** — the agent's brain. Every heartbeat cycle, Venice runs a **two-call pipeline**:

1. **Call #1 — Sentiment** (`enable_web_search: "on"`): Gathers qualitative signals (social sentiment, governance news, whale movements) that structured APIs cannot provide.
2. **Call #2 — Analysis** (`enable_web_search: "off"`): Receives ALL structured data (pool state + Uniswap Trading API quotes + DeFiLlama TVL + DexScreener pool analytics + sentiment from Call #1) and returns a tick range + fee recommendation.

Both calls run inside an **EigenCompute TEE** for verifiable inference. The recommendation is then cross-checked by **Olas Mech** before the agent decides whether to act.

**Bounty target**: Venice AI — $11,500

---

## Authentication

All requests require a Bearer token:

```
Authorization: Bearer VENICE_API_KEY
```

API keys managed at: https://venice.ai/settings/api

**Base URL**: `https://api.venice.ai/api/v1`

---

## OpenAI SDK Compatibility

Venice implements the OpenAI API spec. Use standard OpenAI libraries with Venice's base URL:

### TypeScript (Primary for CuratedLP)

```typescript
import OpenAI from "openai";

const venice = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: "https://api.venice.ai/api/v1"
});

const response = await venice.chat.completions.create({
  model: "zai-org-glm-4.7",
  messages: [{ role: "user", content: "Hello" }]
});
```

---

## Available Models

### Text/Chat Models (Relevant to CuratedLP)

| Model ID | Size | Tier | Key Features |
|---|---|---|---|
| `zai-org-glm-4.7` | — | L | Flagship reasoning/agents, function calling, 128k context |
| `qwen3-235b-a22b-thinking-2507` | 235B MoE | L | Reasoning model (`<think>` blocks) |
| `deepseek-ai-DeepSeek-R1` | — | L | Reasoning model (`<think>` blocks) |
| `grok-41-fast` | — | L | Grok with x-search |
| `kimi-k2-thinking` | — | L | Reasoning model (`<think>` blocks) |
| `gemini-3-pro-preview` | — | L | Google Gemini 3 Pro |
| `hermes-3-llama-3.1-405b` | 405B | L | Large open-source model |
| `llama-3.3-70b` | 70B | M | Good balance of speed/quality |
| `qwen3-next-80b` | 80B | M | Strong reasoning |
| `google-gemma-3-27b-it` | 27B | M | Google Gemma 3 |
| `mistral-31-24b` | 24B | S | Vision + function calling |
| `venice-uncensored` | — | S | No content restrictions |
| `qwen3-4b` | 4B | XS | Fast, reasoning capable, function calling |
| `llama-3.2-3b` | 3B | XS | Lightweight, function calling |

### Rate Limits by Tier

| Tier | Requests/min | Tokens/min |
|---|---|---|
| XS | 500 | 1,000,000 |
| S | 75 | 750,000 |
| M | 50 | 750,000 |
| L | 20 | 500,000 |

Partner tier available for higher limits — contact api@venice.ai.

### Models with Function Calling Support

- `zai-org-glm-4.7`
- `qwen3-4b`
- `mistral-31-24b`
- `llama-3.2-3b`

### Models with Reasoning (`<think>` blocks)

- `qwen3-4b`
- `deepseek-ai-DeepSeek-R1`
- `qwen3-235b-a22b-thinking-2507`
- `kimi-k2-thinking`

---

## Chat Completions API

**Endpoint**: `POST /chat/completions`

### Full Request Schema

```json
{
  "model": "zai-org-glm-4.7",
  "messages": [
    {
      "role": "system",
      "content": "You are an AI agent managing concentrated liquidity..."
    },
    {
      "role": "user",
      "content": "Pool state + market data + sentiment..."
    }
  ],
  "temperature": 0.7,
  "top_p": 1.0,
  "max_tokens": 2048,
  "stream": false,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "recommend_rebalance",
        "description": "Recommend a rebalance action",
        "parameters": {
          "type": "object",
          "properties": {
            "newTickLower": { "type": "integer" },
            "newTickUpper": { "type": "integer" },
            "newFee": { "type": "integer" },
            "confidence": { "type": "number" },
            "reasoning": { "type": "string" }
          },
          "required": ["newTickLower", "newTickUpper", "newFee", "confidence", "reasoning"]
        }
      }
    }
  ],
  "venice_parameters": {
    "include_venice_system_prompt": false,
    "enable_web_search": "off",
    "strip_thinking_response": false
  }
}
```

### Response Schema

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "zai-org-glm-4.7",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_...",
            "type": "function",
            "function": {
              "name": "recommend_rebalance",
              "arguments": "{\"newTickLower\": -180, \"newTickUpper\": 120, \"newFee\": 3500, \"confidence\": 0.82, \"reasoning\": \"Spread is tight, depth is good, sentiment is bullish with governance tailwinds...\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 1250,
    "completion_tokens": 350,
    "total_tokens": 1600
  }
}
```

---

## Venice-Specific Parameters

These go inside the `venice_parameters` object in the request body:

| Parameter | Type | Default | CuratedLP Usage |
|---|---|---|---|
| `enable_web_search` | string | `"off"` | `"on"` for sentiment call, `"off"` for analysis call |
| `enable_web_scraping` | boolean | `false` | Not used |
| `enable_web_citations` | boolean | `false` | Not used |
| `strip_thinking_response` | boolean | `false` | `false` — keep reasoning for audit trail |
| `disable_thinking` | boolean | `false` | `false` — reasoning is valuable |
| `include_venice_system_prompt` | boolean | `true` | `false` — use only our custom prompts |
| `prompt_cache_key` | string | — | Optional routing hint for cache hits |

### Model Feature Suffix Syntax

Parameters can be appended directly to model ID:
```
qwen3-4b:enable_web_search=auto&disable_thinking=true
```

---

## Two-Call Venice Pipeline

Venice serves two distinct roles in each heartbeat cycle. This is the core intelligence architecture.

### Call #1: Sentiment Gathering (`enable_web_search: "on"`)

**Purpose:** Gather qualitative signals that structured APIs cannot provide — social media sentiment, governance news, whale movements, market mood.

**System prompt:**

```
You are a DeFi sentiment analyst. Search for current information about
wstETH, Lido, and the ETH ecosystem. Summarize:

1. Social media sentiment (Twitter/X, Reddit, CT)
2. Governance news (Lido proposals, ETH protocol changes)
3. Whale movements (large wstETH transfers, Aave/Compound deposits)
4. Market mood (risk-on vs risk-off, macro events affecting crypto)

Respond using the report_sentiment function with fields:
- sentiment: "bullish" | "bearish" | "neutral"
- confidence: 0 to 1
- signals: array of 3-5 key observations with source context
```

**Venice parameters:**

```json
{
  "venice_parameters": {
    "include_venice_system_prompt": false,
    "enable_web_search": "on",
    "strip_thinking_response": false
  }
}
```

**Example output:**

```json
{
  "sentiment": "moderately_bullish",
  "confidence": 0.72,
  "signals": [
    "Lido V3 governance vote passing with 94% approval — bullish for wstETH utility",
    "Large wstETH accumulation on Aave over past 48h — whales positioning long",
    "ETH gas fees at monthly low — favorable for LP rebalancing costs"
  ]
}
```

### Call #2: Analysis + Recommendation (`enable_web_search: "off"`)

**Purpose:** Receive ALL structured data + sentiment from Call #1 and produce a tick range + fee recommendation. Web search is OFF because all data is already provided.

**System prompt:**

```
You are an AI agent managing concentrated liquidity for a wstETH/USDC
pool on Uniswap v4 on Base.

You will receive:
1. Structured market data from the Uniswap Trading API (price, spread, depth)
2. On-chain analytics: DeFiLlama (Lido protocol TVL) + DexScreener (pool liquidity, volume, price, estimated APY)
3. Sentiment analysis (social signals, governance news, whale movements)

Use ALL of this data to recommend:

1. Optimal tick range [tickLower, tickUpper] (must be divisible by 60)
2. Recommended swap fee (100 = 0.01%, 3000 = 0.30%, max 100000 = 10%)
3. Confidence score 0 to 1
4. Brief reasoning explaining your recommendation

Key decision signals:
- Spread (bid/ask width): wide spread → raise fee, widen range
- Price impact at 10x: high impact → shallow depth → widen range
- Price impact > current fee → fee is too low for the liquidity depth
- TVL declining → capital flight, widen range defensively
- Bullish sentiment → shift range above current price
- Bearish sentiment → shift range below or widen defensively

Respond using the recommend_rebalance function.
```

**User message per cycle (structured, not prose):**

```
Pool state:
  currentTick: -201840
  tickLower: -202200, tickUpper: -201400
  totalLiquidity: 50000000
  currentFee: 3000 (0.30%)
  cumulativeVolume: 1500000
  idleToken0: 0.02 wstETH
  accruedPerformanceFee: 0.001 wstETH

Uniswap Trading API data:
  Forward price (1 wstETH → USDC): $3,412.50
  Reverse price (USDC → 1 wstETH): $3,415.20
  Spread: $2.70 (0.08%, 8 bps) — HEALTHY
  Price impact at 10x (10 wstETH): $3,408.30
  Price impact: 0.12% (12 bps) — MODERATE depth
  Gas estimate: 0.0003 ETH
  Approval: active

On-chain analytics:
  Lido TVL: $14.2B (−1.3% 24h, −0.8% 7d)
  Pool liquidity (USD): $2,450,000
  Pool 24h volume: $380,000
  Pool price: $3,412.50
  Price change 24h: +1.2%
  Estimated fee APY: 4.2%

Sentiment (from Venice web search):
  Overall: moderately bullish (confidence 0.72)
  Signals:
    - Lido V3 governance vote passing with 94% approval
    - Large wstETH accumulation on Aave over past 48h
    - ETH gas fees at monthly low

Recommend optimal parameters.
```

**Venice parameters:**

```json
{
  "venice_parameters": {
    "include_venice_system_prompt": false,
    "enable_web_search": "off",
    "strip_thinking_response": false,
    "disable_thinking": false
  }
}
```

### Why Two Calls Instead of One

1. **Call #1 uses web search** to gather qualitative signals that no API provides. This is the only Venice call with web search ON.
2. **Call #2 receives everything** as structured input and focuses purely on analysis. Web search is OFF — no risk of Venice finding stale or contradictory web pages.
3. **Both calls run inside EigenCompute TEE**, so the attestation covers the full pipeline: sentiment gathered → data assembled → analysis produced → recommendation output.

---

## EigenCompute TEE Integration

Both Venice calls are wrapped in an EigenCompute Trusted Execution Environment for verifiable inference.

```
WITHOUT EigenCompute:
Agent → Venice (sentiment) → Venice (analyze) → recommendation
(trust the agent's claim at every step)

WITH EigenCompute:
Agent → EigenCompute TEE → Venice (sentiment) → Venice (analyze)
     → recommendation + single attestation hash
(cryptographic proof the full pipeline ran correctly)
```

The TEE attestation proves:
- Venice's web search was actually executed for sentiment (not fabricated)
- The pool state and market data were actually passed (not manipulated)
- The recommendation was not altered after Venice returned it
- The same Docker image (by digest) produced the result every time

Non-deterministic web search results from Call #1 do not affect TEE consensus — EigenCompute's mainnet alpha uses a single TEE instance proving code integrity, not output reproducibility.

---

## Data Pipeline (Replaces x402/AgentCash)

Venice no longer receives market data from x402/AgentCash (Merit dropped out). The revised data pipeline:

```
pool-reader (free, on-chain)
     |
     | Pool state: tick, liquidity, fee, volume, idle balances
     v
uniswap-data (free, 4 Uniswap API calls + DeFiLlama + DexScreener)
     |
     | Price: $3,412.50, Spread: 0.08%
     | Price impact at 10x: 0.12%, Approval: active
     | Lido TVL: $14.2B (−1.3%), Pool liquidity: $2.4M, Fee APY: 4.2%
     | 4 requestIds logged
     v
venice-sentiment (free, Venice web search ON) — Call #1
     |
     | Sentiment: moderately bullish (0.72 confidence)
     | Signals: governance vote, whale accumulation, low gas
     v
venice-analyze (free, Venice web search OFF) — Call #2
     |
     | Input: pool state + uniswap data + DeFiLlama + DexScreener + sentiment
     | Recommendation: tick [-180, 120], fee 3500, confidence 0.82
     v
eigencompute (TEE wrapper — covers both Venice calls)
     |
     | Same recommendation + attestation hash
     v
olas-analyze (paid via Locus, cross-checks Venice recommendation)
     |
     | Agrees: yes, Olas prediction: 62% up
     | Flags: none, 10+ tx hashes logged
     v
Agent DECIDES → execute-rebalance or skip
```

---

## Function Call Flow

```
venice-analyze.ts
    |
    |-- Call #1: Sentiment (enable_web_search: "on")
    |     |-- Build messages (sentiment system prompt)
    |     |-- Define report_sentiment tool
    |     |-- POST /chat/completions
    |     |-- Parse sentiment JSON
    |     v
    |   { sentiment, confidence, signals }
    |
    |-- Call #2: Analysis (enable_web_search: "off")
    |     |-- Build messages (LP manager system prompt + all data)
    |     |     - Pool state (from pool-reader)
    |     |     - Uniswap data (from uniswap-data: 4 quotes + DeFiLlama + DexScreener)
    |     |     - Sentiment (from Call #1 above)
    |     |-- Define recommend_rebalance tool
    |     |-- POST /chat/completions
    |     |-- Parse tool_calls[0].function.arguments
    |     |-- Validate: ticks divisible by 60, fee within bounds
    |     v
    |   { newTickLower, newTickUpper, newFee, confidence, reasoning }
    |
    |-- Both calls wrapped in EigenCompute TEE
    |     → attestationHash proves full pipeline integrity
    |
    v
eigencompute.ts returns:
    sentiment + recommendation + attestationHash + computeJobId
    |
    v
olas-analyze.ts cross-checks Venice recommendation
    |-- Validates directional bias, confidence, tick range
    |-- Returns agrees/disagrees + own prediction + flags
    |
    v
Agent DECIDES (OpenClaw reasoning)
    |-- If confidence >= threshold AND Olas agrees → execute-rebalance
    |-- If Olas disagrees → widen range defensively or skip
    |-- If confidence < threshold → skip, wait for next cycle
```

---

## Model Selection for CuratedLP

**Primary**: `zai-org-glm-4.7` (GLM 4.7)
- L-tier flagship model for reasoning and agents
- Best function calling support (critical — both modes rely on structured tool output)
- 128k context window (fits all market data comfortably)

**Fallback**: `llama-3.3-70b`
- M-tier (higher rate limits: 50 req/min vs 20 req/min)
- Good reasoning for financial data
- Used when primary model returns 429/500

**For reasoning audit trail (optional override)**: `qwen3-235b-a22b-thinking-2507`
- L-tier reasoning model with `<think>` blocks
- Override via `VENICE_PRIMARY_MODEL` env var when auditable step-by-step reasoning is needed
- Trade-off: reasoning models may be less reliable at structured function calling

---

## Reasoning Models

Models like `qwen3-235b-a22b-thinking-2507` and `deepseek-ai-DeepSeek-R1` include reasoning steps:

```
<think>
The spread is 8 bps — healthy, no liquidity concern...
Price impact at 10x is 12 bps — moderate depth...
Lido TVL down 1.3% — slight capital flight, factor into range width...
Pool liquidity is $2.4M, volume $380K — healthy pool depth...
Sentiment is moderately bullish with governance tailwinds...
Fee APY at 4.2% is competitive, slight fee increase justified...
</think>

Based on the analysis, I recommend...
```

Control reasoning output:
- `strip_thinking_response: true` — removes `<think>` blocks from response
- `disable_thinking: true` — model skips reasoning entirely (faster, cheaper)

**For CuratedLP**: Keep reasoning enabled (`strip_thinking_response: false`) — the `<think>` blocks provide an audit trail for why the agent made a particular recommendation. Log these for the curator dashboard and EigenCompute attestation verification.

---

## Failure Modes

| Failure | Agent Behavior |
|---|---|
| Sentiment call fails (Call #1) | Proceed with analysis using structured data only. Venice notes "sentiment unavailable" in reasoning. |
| Analysis call fails (Call #2) | Return null — agent skips the cycle entirely. |
| EigenCompute TEE unavailable | Fall back to direct venice-analyze (unverified but functional). Agent logs "running unverified". |
| Venice rate limited (429) | Fallback to secondary model (`llama-3.3-70b`). If both fail, skip cycle. |
| Insufficient Venice balance (402) | Skip cycle, log warning. |

---

## Rate Limiting

### Response Headers

| Header | Purpose |
|---|---|
| `x-ratelimit-limit-requests` | Max requests in window |
| `x-ratelimit-remaining-requests` | Requests remaining |
| `x-ratelimit-reset-requests` | Unix timestamp when limit resets |
| `x-ratelimit-limit-tokens` | Max tokens per minute |
| `x-ratelimit-remaining-tokens` | Tokens remaining |
| `x-ratelimit-reset-tokens` | Seconds until token limit resets |

### Abuse Protection

More than 20 failed requests in 30 seconds triggers a 30-second block.

**Retry strategy**: Use exponential backoff for 429 and 500/503 responses. Check `x-ratelimit-reset-requests` header for 429s. Fall back to secondary model if primary is rate-limited.

---

## Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `AUTHENTICATION_FAILED` | 401 | Bad auth |
| `AUTHENTICATION_FAILED_INACTIVE_KEY` | 401 | Pro subscription inactive |
| `INVALID_API_KEY` | 401 | Invalid key |
| `INSUFFICIENT_BALANCE` | 402 | Out of credits (DIEM/USD) |
| `UNAUTHORIZED` | 403 | Forbidden |
| `INVALID_REQUEST` | 400 | Bad parameters |
| `INVALID_MODEL` | 400 | Model not found |
| `MODEL_NOT_FOUND` | 404 | Specified model not found |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limited |
| `INFERENCE_FAILED` | 500 | Processing error |
| `UNKNOWN_ERROR` | 500 | Generic error |

---

## Balance & Usage Tracking

### Check Balance

```
GET /billing/balance
```

Returns DIEM and USD balances.

### Response Headers (per request)

| Header | Purpose |
|---|---|
| `x-venice-balance-diem` | DIEM token balance before request |
| `x-venice-balance-usd` | USD credit balance before request |
| `x-venice-model-id` | Model used for the request |
| `x-venice-model-deprecation-warning` | Deprecation notice (if applicable) |

### Usage Analytics

```
GET /billing/usage-analytics?lookback=7d
```

Returns daily totals, per-model breakdown, per-API-key breakdown.

---

## Prompt Caching

Venice automatically caches system prompts — no code changes needed. For the CuratedLP agent, both system prompts (sentiment analyst + LP manager) stay constant across cycles and will be cached, reducing token costs.

Optional: Use `prompt_cache_key` parameter as a routing hint for better cache hit rates. Use `cache_control` property on message content for manual caching.

---

## Cost Estimation

At 5-minute heartbeat cycles (288 cycles/day), with two Venice calls per cycle:

- **Call #1 (Sentiment):** ~500 prompt tokens + ~300 completion = ~800 tokens
- **Call #2 (Analysis):** ~1,500 prompt tokens + ~500 completion = ~2,000 tokens
- **Total per cycle:** ~2,800 tokens
- **Daily total:** ~806,400 tokens

With Venice's token-based pricing and prompt caching (both system prompts cached), costs should be minimal — well under $2/day for text inference. Venice API calls are **free** relative to Locus budget (only Olas Mech costs USDC).

---

## Solidity Impact

**None.** Venice AI is entirely TypeScript-side:
- No contract changes
- No on-chain interaction with Venice
- Venice recommendation is consumed off-chain, then executed via MetaMask delegation redemption calling `rebalance()`

---

## Bounty Alignment (Venice AI: $11,500)

| Requirement | How CuratedLP Satisfies It |
|---|---|
| Use Venice AI for inference | Two Venice calls per heartbeat cycle — sentiment gathering + analysis |
| Meaningful integration | Venice is the core brain — all rebalance decisions flow through it |
| Function calling | Structured `report_sentiment` + `recommend_rebalance` tools for typed output |
| Web search | Call #1 uses `enable_web_search: "on"` to gather real-time qualitative sentiment |
| Private inference | No data retention — LP strategy stays private |
| Flagship model | `zai-org-glm-4.7` — best function calling for structured output; `qwen3-235b-a22b-thinking-2507` available for `<think>` reasoning audit trail |
| Verifiable compute | Both calls wrapped in EigenCompute TEE with attestation hash |
| Data quality | Venice receives exact structured data (Uniswap prices, DeFiLlama TVL, DexScreener pool analytics) + qualitative sentiment — references specific numbers in reasoning |

**Venice is the highest-value bounty ($11,500)** — the integration must be robust, well-documented, and demonstrably load-bearing.

---

## API Endpoints Used by CuratedLP

| Endpoint | Method | Purpose |
|---|---|---|
| `/chat/completions` | POST | Text inference — both sentiment + analysis calls |
| `/models` | GET | List available models |
| `/models/traits` | GET | Model capabilities metadata |
| `/billing/balance` | GET | Check credits (DIEM/USD) |
| `/billing/usage-analytics` | GET | Usage analytics |
| `/api_keys/rate_limits` | GET | Check rate limit status |

---

## Quick Start Checklist

- [ ] Get API key from https://venice.ai/settings/api
- [ ] Set `VENICE_API_KEY` environment variable
- [ ] Install OpenAI SDK: `npm install openai`
- [ ] Initialize client with Venice base URL
- [ ] Design system prompt for sentiment gathering (Call #1)
- [ ] Design system prompt for LP analysis (Call #2)
- [ ] Define `report_sentiment` function tool schema (Call #1)
- [ ] Define `recommend_rebalance` function tool schema (Call #2)
- [ ] Test Call #1 with web search ON — verify sentiment JSON returned
- [ ] Test Call #2 with sample structured data — verify recommendation JSON returned
- [ ] Wire into heartbeat: uniswap-data → venice-sentiment → venice-analyze
- [ ] Wrap both calls in EigenCompute TEE
- [ ] Add reasoning logging for dashboard / attestation
- [ ] Implement fallback model selection on rate limit
- [ ] Add balance checking before requests
- [ ] Integrate Olas cross-check downstream of Venice output
