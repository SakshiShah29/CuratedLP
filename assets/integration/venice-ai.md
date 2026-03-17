# Venice AI Integration Reference

*Source: https://docs.venice.ai/llms-full.txt*
*Last updated: 2026-03-17*

---

## What Is Venice AI

Venice AI provides HTTP-based REST and streaming interfaces for AI inference with **uncensored models and private inference** — no data retention, no restrictive content policies. It offers text generation, image creation, embeddings, audio, and video via an **OpenAI-compatible API**. Existing OpenAI SDKs work by pointing `baseURL` at Venice.

---

## Role in CuratedLP

Venice AI is the **intelligence layer** — the agent's brain. Every FSM cycle, pool state + market data (from x402/AgentCash and Olas) are sent to Venice AI, which returns a tick range + fee recommendation for the rebalance.

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

### Python

```python
from openai import OpenAI

client = OpenAI(
    api_key="VENICE_API_KEY",
    base_url="https://api.venice.ai/api/v1"
)

response = client.chat.completions.create(
    model="zai-org-glm-4.7",
    messages=[{"role": "user", "content": "Hello"}]
)
```

---

## Available Models

### Text/Chat Models (Relevant to CuratedLP)

| Model ID | Size | Tier | Context | Key Features |
|---|---|---|---|---|
| `zai-org-glm-4.7` | — | — | 128k | Flagship, function calling |
| `qwen3-235b-a22b-thinking-2507` | 235B MoE | L | — | Reasoning model |
| `deepseek-ai-DeepSeek-R1` | — | L | — | Reasoning model |
| `grok-41-fast` | — | L | — | Grok with x-search |
| `kimi-k2-thinking` | — | L | — | Reasoning model |
| `llama-3.3-70b` | 70B | M | — | Good balance of speed/quality |
| `qwen3-next-80b` | 80B | M | — | Strong reasoning |
| `mistral-31-24b` | 24B | S | — | Vision + function calling |
| `qwen3-4b` | 4B | XS | — | Fast, reasoning capable, function calling |
| `venice-uncensored` | — | S | — | No content restrictions |

### Rate Limits by Tier

| Tier | Requests/min | Tokens/min |
|---|---|---|
| XS | 500 | 1,000,000 |
| S | 75 | 750,000 |
| M | 50 | 750,000 |
| L | 20 | 500,000 |

Partner tier doubles all limits.

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
      "content": "You are an expert DeFi liquidity manager..."
    },
    {
      "role": "user",
      "content": "Given this market data, recommend tick range and fee..."
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
        "content": "Based on the analysis...",
        "tool_calls": [
          {
            "id": "call_...",
            "type": "function",
            "function": {
              "name": "recommend_rebalance",
              "arguments": "{\"newTickLower\": -120, \"newTickUpper\": 180, \"newFee\": 3000, \"confidence\": 0.82, \"reasoning\": \"Volatility is moderate...\"}"
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

### Streaming Response (SSE)

```
data: {"choices":[{"delta":{"content":"Based"}}]}
data: {"choices":[{"delta":{"content":" on"}}]}
...
data: [DONE]
```

---

## Venice-Specific Parameters

These go inside the `venice_parameters` object in the request body:

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `enable_web_search` | string | `"off"` | `"off"`, `"on"`, `"auto"` — real-time web data |
| `enable_web_scraping` | boolean | `false` | Scrape up to 5 detected URLs in prompt |
| `enable_web_citations` | boolean | `false` | Include `[REF]0[/REF]` source citations |
| `strip_thinking_response` | boolean | `false` | Remove `<think></think>` reasoning blocks |
| `disable_thinking` | boolean | `false` | Disable reasoning entirely |
| `include_venice_system_prompt` | boolean | `true` | Append Venice default system prompt |
| `character_slug` | string | — | Use a public Venice character persona |
| `enable_x_search` | boolean | `false` | Use xAI native search (Grok models only) |
| `include_search_results_in_stream` | boolean | `false` | Include search results as first stream chunk |
| `return_search_results_as_documents` | boolean | `false` | Return search results as tool call |
| `prompt_cache_key` | string | — | Routing hint for prompt cache hits |

### Model Feature Suffix Syntax

Parameters can be appended directly to model ID:
```
qwen3-4b:enable_web_search=auto&disable_thinking=true
```

---

## Function Calling / Tool Use

Venice supports OpenAI-compatible function calling. Define tools in the `tools` array:

```typescript
const response = await venice.chat.completions.create({
  model: "zai-org-glm-4.7",
  messages: [...],
  tools: [
    {
      type: "function",
      function: {
        name: "recommend_rebalance",
        description: "Recommend rebalance parameters for the LP vault",
        parameters: {
          type: "object",
          properties: {
            newTickLower: { type: "integer", description: "Lower tick boundary" },
            newTickUpper: { type: "integer", description: "Upper tick boundary" },
            newFee: { type: "integer", description: "Fee in hundredths of bip" },
            confidence: { type: "number", description: "0-1 confidence score" },
            reasoning: { type: "string", description: "Explanation of recommendation" }
          },
          required: ["newTickLower", "newTickUpper", "newFee", "confidence", "reasoning"]
        }
      }
    }
  ]
});

// Extract structured recommendation
const toolCall = response.choices[0].message.tool_calls?.[0];
if (toolCall) {
  const recommendation = JSON.parse(toolCall.function.arguments);
  // { newTickLower: -120, newTickUpper: 180, newFee: 3000, confidence: 0.82, reasoning: "..." }
}
```

When the model decides to call a function, the response includes:
- `finish_reason: "tool_calls"`
- `message.tool_calls[]` array with `id`, `type: "function"`, `function.name`, `function.arguments` (JSON string)

---

## Web Search Integration

Venice can augment responses with real-time web data:

```json
{
  "venice_parameters": {
    "enable_web_search": "auto",
    "enable_web_citations": true
  }
}
```

- `"auto"`: Venice decides if web search is needed based on the prompt
- `"on"`: Always search
- `enable_web_scraping`: Scrape up to 5 URLs found in prompt
- `enable_web_citations`: Adds `[REF]0[/REF]` inline citations with sources

**Useful for CuratedLP**: Can supplement x402 market data with real-time web search for breaking news, protocol announcements, or market events that affect wstETH/USDC.

---

## Reasoning Models

Models like `deepseek-ai-DeepSeek-R1` and `qwen3-235b-a22b-thinking-2507` include reasoning steps:

```
<think>
The current tick is at -60, liquidity is concentrated...
Given the 2% implied volatility, a wider range would...
Fee should increase because volume is high...
</think>

Based on the analysis, I recommend...
```

Control reasoning output:
- `strip_thinking_response: true` — removes `<think>` blocks from response
- `disable_thinking: true` — model skips reasoning entirely (faster, cheaper)

**For CuratedLP**: Keep reasoning enabled (`strip_thinking_response: false`) — the `<think>` blocks provide an audit trail for why the agent made a particular recommendation. Log these for the curator dashboard.

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

**Retry strategy**: Use exponential backoff for 429 and 500/503 responses. Check `x-ratelimit-reset-requests` header for 429s.

---

## Error Codes

| Code | HTTP Status | Meaning |
|---|---|---|
| `AUTHENTICATION_FAILED` | 401 | Bad auth |
| `INVALID_API_KEY` | 401 | Invalid key |
| `INSUFFICIENT_BALANCE` | 402 | Out of credits |
| `UNAUTHORIZED` | 403 | Forbidden |
| `INVALID_REQUEST` | 400 | Bad parameters |
| `INVALID_MODEL` | 400 | Model not found |
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

### Usage Analytics

```
GET /billing/usage-analytics?lookback=7d
```

Returns daily totals, per-model breakdown, per-API-key breakdown.

---

## Prompt Caching

Venice automatically caches system prompts — no code changes needed. For the CuratedLP agent, the system prompt describing the vault, pool parameters, and analysis framework will be cached across FSM cycles, reducing token costs.

Optional: Use `prompt_cache_key` parameter as a routing hint for better cache hit rates.

---

## CuratedLP Integration Design

### venice.ts Responsibilities

| Function | Purpose |
|---|---|
| `analyzeMarketData(context)` | Send pool state + market data to Venice, get recommendation |
| `getRebalanceRecommendation(data)` | Structured function call returning `{ tickLower, tickUpper, fee, confidence }` |
| `checkBalance()` | Verify Venice credits before making requests |

### System Prompt Design

The agent uses a carefully crafted system prompt that stays constant across cycles (cached by Venice):

```typescript
const SYSTEM_PROMPT = `You are an expert Uniswap v4 concentrated liquidity manager for a wstETH/USDC vault on Base.

Your job: analyze market data and recommend optimal tick range + fee parameters for the next rebalance.

Pool parameters:
- Token pair: wstETH/USDC
- Tick spacing: 60
- Current tick range: provided in user message
- Max fee: 100000 (10%)
- Min fee: 100 (0.01%)

You MUST respond using the recommend_rebalance function with:
- newTickLower: must be divisible by 60
- newTickUpper: must be divisible by 60, must be > newTickLower
- newFee: in hundredths of bip (3000 = 0.30%)
- confidence: 0-1 score
- reasoning: brief explanation

Decision framework:
- High volatility → wider tick range, higher fee
- Low volatility → tighter tick range, lower fee
- Strong directional trend → shift range in trend direction
- High volume → higher fee to capture more revenue
- If confidence < 0.5, recommend NO rebalance (return current values)`;
```

### User Message Per Cycle

Each FSM cycle sends a user message containing all collected data:

```typescript
const userMessage = `
Current pool state:
- Current tick: ${currentTick}
- Current range: [${currentTickLower}, ${currentTickUpper}]
- Total liquidity: ${totalLiquidity}
- Current fee: ${currentFee}

Market data (from x402/AgentCash):
- wstETH/USDC price: $${price}
- 24h volume: $${volume}
- 24h volatility: ${volatility}%

Olas Mech analysis:
- Price direction prediction: ${mechPrediction.p_yes}% up, ${mechPrediction.p_no}% down (confidence: ${mechPrediction.confidence})
- Superforecaster 4h drop >2%: ${dropProb}%
- Superforecaster 4h rise >2%: ${riseProb}%
- Sentiment: ${sentiment}

Uniswap Trading API:
- Best swap route quote: ${quote}

Should we rebalance? If yes, recommend new tick range and fee.
`;
```

### Function Call Flow

```
venice.ts
    |
    |-- 1. Build messages array (system + user with market data)
    |-- 2. Define recommend_rebalance tool
    |-- 3. Call POST /chat/completions with function calling
    |-- 4. Parse tool_calls[0].function.arguments
    |-- 5. Validate: ticks divisible by 60, fee within bounds
    |-- 6. Return structured recommendation to FSM
    |
    v
index.ts (FSM DECIDE step)
    |-- If confidence >= threshold AND recommendation differs from current:
    |       -> Proceed to EXECUTE (rebalance via MetaMask delegation)
    |-- Else:
    |       -> Skip rebalance, wait for next cycle
```

### Model Selection for CuratedLP

**Primary**: `zai-org-glm-4.7` (GLM 4.7)
- 128k context window (fits all market data)
- Function calling support (structured output)
- Flagship quality for financial analysis

**Fallback**: `llama-3.3-70b`
- M-tier (higher rate limits: 50 req/min)
- Good reasoning for financial data

**For reasoning audit trail**: `deepseek-ai-DeepSeek-R1`
- L-tier reasoning model
- `<think>` blocks show step-by-step analysis
- Use `strip_thinking_response: false` to capture reasoning for dashboard logs

### Venice Parameters for CuratedLP

```json
{
  "venice_parameters": {
    "include_venice_system_prompt": false,
    "enable_web_search": "auto",
    "enable_web_citations": false,
    "strip_thinking_response": false,
    "disable_thinking": false
  }
}
```

- `include_venice_system_prompt: false` — use only our custom system prompt
- `enable_web_search: "auto"` — let Venice decide if real-time web data would help
- `strip_thinking_response: false` — keep reasoning for logging/dashboard

---

## Cost Estimation

At 5-minute FSM cycles (288 cycles/day):
- ~1,500 prompt tokens per request (system + user message with data)
- ~500 completion tokens per response (recommendation + reasoning)
- ~2,000 tokens total per cycle
- ~576,000 tokens/day

With Venice's token-based pricing and prompt caching (system prompt cached), costs should be minimal — well under $1/day for text inference.

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
| Use Venice AI for inference | Every FSM cycle sends market data to Venice for analysis |
| Meaningful integration | Venice is the core brain — all rebalance decisions flow through it |
| Function calling | Structured `recommend_rebalance` tool for typed output |
| Private inference | No data retention — LP strategy stays private |
| Reasoning models | DeepSeek-R1 provides auditable `<think>` reasoning trail |
| Web search | `enable_web_search: "auto"` for real-time market context |

**Venice is the highest-value bounty ($11,500)** — the integration must be robust, well-documented, and demonstrably load-bearing.

---

## All API Endpoints (Reference)

### Core (Used by CuratedLP)

| Endpoint | Method | Purpose |
|---|---|---|
| `/chat/completions` | POST | Text inference (primary) |
| `/models` | GET | List available models |
| `/models/traits` | GET | Model capabilities |
| `/billing/balance` | GET | Check credits |
| `/api_keys/rate_limits` | GET | Check rate limits |

### Additional (Not used by CuratedLP but available)

| Endpoint | Method | Purpose |
|---|---|---|
| `/image/generate` | POST | Image generation |
| `/embeddings` | POST | Create embeddings |
| `/audio/speech` | POST | Text-to-speech |
| `/audio/transcriptions` | POST | Transcribe audio |
| `/video/queue` | POST | Video generation |
| `/characters` | GET | List AI characters |
| `/billing/usage` | GET | Usage history |
| `/billing/usage-analytics` | GET | Usage analytics |

---

## Quick Start Checklist

- [ ] Get API key from https://venice.ai/settings/api
- [ ] Set `VENICE_API_KEY` environment variable
- [ ] Install OpenAI SDK: `npm install openai`
- [ ] Initialize client with Venice base URL
- [ ] Design system prompt for LP management
- [ ] Define `recommend_rebalance` function tool schema
- [ ] Test with sample market data
- [ ] Wire into FSM ANALYZE -> DECIDE flow
- [ ] Add reasoning logging for dashboard
- [ ] Implement fallback model selection on rate limit
- [ ] Add balance checking before requests
