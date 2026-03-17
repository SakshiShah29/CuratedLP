# Phase 4 Implementation Plan: Venice AI + x402 + Locus + Agent Loop

*Last updated: 2026-03-18*

---

## Context

CuratedLP is a Uniswap v4 hook on Base that turns a concentrated liquidity pool into an AI-managed vault. Phases 1-3 built the on-chain contracts (hook, shares, enforcer, delegation). Phase 4 builds the **off-chain AI agent** — the brain that reads pool state, buys market data, reasons via Venice AI, and executes rebalances autonomously.

The `agent/` directory does not exist yet. This is greenfield TypeScript.

**Bounty targets**: Venice AI ($11,500) + Merit/x402 ($5,250) + Locus ($3,000) + Olas ($1,000) = **$20,750 total**.

---

## High-Level Architecture

```
+---------------------------------------------------------------------+
|                        Agent Loop (every 5 min)                     |
|                                                                     |
|  MONITOR                                                            |
|    Read Base RPC: tick, liquidity, swap volume, fee                 |
|        |                                                            |
|        v                                                            |
|  ANALYZE                                                            |
|    +-------------------+  +-------------------+  +--------------+   |
|    | Uniswap Trading   |  | x402 / AgentCash  |  | Olas Mech    |  |
|    | API (free, keyed) |  | (paid via Locus)  |  | (10+ reqs)   |  |
|    +--------+----------+  +--------+----------+  +------+-------+  |
|             |                      |                     |          |
|             +----------+-----------+---------------------+          |
|                        |                                            |
|                        v                                            |
|              +-------------------+                                  |
|              | Venice AI         |                                  |
|              | (primary brain)   |                                  |
|              | -> tick range     |                                  |
|              | -> fee            |                                  |
|              | -> confidence     |                                  |
|              +--------+----------+                                  |
|                       |                                             |
|                       v                                             |
|  DECIDE                                                             |
|    Different enough from current? ---- NO ----> IDLE (wait 5 min)   |
|             | YES                                                   |
|             v                                                       |
|  EXECUTE                                                            |
|    Build rebalance calldata                                         |
|    Redeem delegation via DelegationManager                          |
|             |                                                       |
|             v                                                       |
|  REPORT                                                             |
|    Log performance, persist cache, write payment log                |
+---------------------------------------------------------------------+
```

---

## Directory Structure

```
agent/
  package.json
  tsconfig.json
  .env.example
  .gitignore
  src/
    index.ts            Entry point and main loop
    config.ts           Env var loading and validation
    types.ts            Shared TypeScript interfaces and enums
    logger.ts           Structured logging and payment tx hash tracking
    cache.ts            In-memory + file-persisted data cache with TTL
    pool-reader.ts      On-chain state reader via viem multicall
    delegation.ts       ALREADY IMPLEMENTED -- delegation redemption via MetaMask DelegationManager
    locus.ts            Locus wallet: auth, balance, canSpend
    uniswap-api.ts      Uniswap Trading API quotes (free, keyed)
    x402-client.ts      AgentCash micropayments via CLI
    mech-client.ts      Olas Mech Marketplace requests via CLI
    venice.ts           Venice AI: prompt engineering, function calling, response parsing
    rebalancer.ts       Calldata encoding, decision logic, delegates to delegation.ts
    fsm.ts              Finite state machine orchestration
  tests/
    *.test.ts           Per-module unit tests
```

---

## Dependency Graph and Build Order

The dependency graph dictates a strict bottom-up build order. Modules at the bottom have zero internal dependencies. Modules at the top consume everything below them.

```
                   index.ts
                      |
                    fsm.ts
                      |
      +-------+-------+--------+-----------+
      |       |       |        |           |
  venice   x402    mech     uniswap    rebalancer
      |    client  client    api           |
      |       |                      delegation.ts
      |    locus.ts                  (already done)
      |                                    |
      |                              pool-reader.ts
      |
      +-- all modules depend on: config, types, logger, cache
```

**Build order**:

1. Scaffolding (package.json, tsconfig, env template)
2. Foundation (types, config, logger, cache)
3. Pool Reader
4. Locus Client
5. Uniswap API Client
6. x402 Client (depends on Locus)
7. Mech Client
8. Venice AI Client
9. Rebalancer (depends on pool-reader, delegation.ts)
10. FSM + Entry Point (depends on everything)

Each module is tested in isolation before the next is started.

---

## Two-Person Parallel Work Division

### Phase 0 — Shared Setup (Steps 1–2)

Steps 1 and 2 are prerequisites for everything. Do them together or have one person do them and merge before either track starts. Don't split these.

**One coordination point**: before diverging, agree on and add these interfaces to `types.ts`. Track B's FSM is built against these; Track A implements them. This is the only point where the two tracks must align.

```typescript
interface IPoolReader   { getPoolState(): Promise<PoolState | null> }
interface IVeniceClient { getRecommendation(pool: PoolState, market: MarketData | null, mech: MechResults | null, price: number | null): Promise<RebalanceRecommendation | null> }
interface IX402Client   { fetchMarketData(): Promise<MarketData | null> }
interface IMechClient   { runRequests(pool: PoolState): Promise<MechResults | null> }
interface IUniswapApi   { getPrice(): Promise<number | null> }
interface IRebalancer   { shouldRebalance(pool: PoolState, rec: RebalanceRecommendation): boolean; executeRebalance(rec: RebalanceRecommendation): Promise<{ txHash: string; success: boolean }> }
```

### Track A — Data & Intelligence (Steps 4, 5, 6, 7, 8)

| Step | Module | Blocked by |
|---|---|---|
| 5 | `uniswap-api.ts` | nothing — start immediately |
| 4 | `locus.ts` | nothing — start immediately |
| 7 | `mech-client.ts` | nothing — start immediately |
| 8 | `venice.ts` | nothing — start immediately |
| 6 | `x402-client.ts` | step 4 (`locus.ts`) merged |

Steps 4, 5, 7, and 8 are fully independent — work on all four in parallel.

### Track B — On-Chain & Orchestration (Steps 3, 9, 10)

| Step | Module | Blocked by |
|---|---|---|
| 3 | `pool-reader.ts` | nothing — start immediately |
| 10 | `fsm.ts` + `index.ts` | nothing — build against the agreed interfaces using stub no-ops |
| 9 | `rebalancer.ts` | step 3 (`pool-reader.ts`) merged |

`fsm.ts` can be built to completion using stub implementations of the Track A interfaces. When Track A modules merge, replace stubs with real constructors — this is a short wiring step, not a rewrite.

### Integration

Once all Track A modules are merged and tested, Track B wires them into the FSM. Then both run the end-to-end verification checklist together on Base Sepolia.

---

## Step 1: Project Scaffolding

Set up the `agent/` directory as a standalone TypeScript Node project.

**package.json** should declare the following runtime dependencies:
- **openai** — Venice AI is OpenAI-compatible; this SDK handles chat completions, function calling, streaming, and retries out of the box
- **viem** — Modern EVM library for RPC reads, ABI encoding, transaction signing. The standard for Uniswap v4 TypeScript tooling
- **dotenv** — Loads environment variables from `.env` file
- **pino** — Lightweight structured JSON logging with child-logger support

Dev dependencies:
- **typescript** and **@types/node** for compilation
- **tsx** for running TypeScript directly without a build step
- **vitest** for fast, native ESM testing

The **tsconfig** should target ES2022 with NodeNext module resolution, strict mode enabled, and output to `dist/`. Source maps on for debugging.

**.env.example** lists every environment variable the agent needs (detailed in the Env Vars section below).

**.gitignore** should exclude `node_modules/`, `dist/`, `.env`, `.cache/`, and `payment-log.json`.

**Verification**: `npm install && npx tsc --noEmit` compiles with zero errors.

---

## Step 2: Foundation Modules

Four small utility modules that every other module depends on.

### types.ts — Shared Type Definitions

Defines the data shapes that flow between modules:

- **PoolState** — Everything read from the on-chain hook: current tick, sqrtPriceX96, tick range (lower/upper), total liquidity, current fee (uint24), cumulative volume, cumulative fee revenue, total swaps, and total idle assets (amount0/amount1).

- **RebalanceRecommendation** — The output of Venice AI's function call: newTickLower (int, divisible by 60), newTickUpper (int, divisible by 60, must be > tickLower), newFee (int, hundredths of bip), confidence (float 0-1), and reasoning (string).

- **MarketData** — Aggregated output from x402 data sources: wstETH/USDC price, 24h volume, volatility percentage, sentiment (bullish/bearish/neutral), and timestamp.

- **MechResults** — Aggregated output from 10+ Olas Mech requests: price direction prediction (p_yes/p_no/confidence), drop probability, rise probability, volatility estimate, tick range recommendation, fee recommendation, resistance/support checks, sentiment, price oracle cross-check, total request count, and array of all tx hashes for bounty proof.

- **FSMState enum** — IDLE, MONITOR, ANALYZE, DECIDE, EXECUTE, REPORT.

- **CycleResult** — Full record of a single agent cycle: cycle number, start/end time, final state, pool state snapshot, market data, mech results, Venice recommendation, whether rebalance was executed, rebalance tx hash, all payment tx hashes, and any errors encountered.

### config.ts — Configuration Management

Loads all configuration from environment variables via `dotenv`. Validates at startup and refuses to start if required values are missing (fail-fast pattern).

**Required** (agent won't start): RPC URL, Venice API key, hook address, agent private key.

**Required for full operation** (agent starts but degrades without): Uniswap API key, Locus API key + wallet ID, delegation signed bytes + curator smart account address.

**Optional with sensible defaults**: confidence threshold (0.6), cycle interval (300,000ms = 5 min), Venice primary model (zai-org-glm-4.7), Venice fallback model (llama-3.3-70b), max x402 per-tx ($0.50), max x402 daily ($5.00), Locus API base URL, pool constants (tick spacing 60, max fee 100000, min rebalance interval 30 blocks).

All secrets are redacted when the loaded config is logged at startup.

### logger.ts — Structured Logging + Payment Tracking

Wraps the `pino` library with a factory function that creates per-module child loggers. Every log entry automatically includes the source module name and the current cycle number.

Additionally maintains a **payment-log.json** file — a single append-only ledger tracking every payment tx hash across all integrations (x402, Olas, rebalance). Each entry records: source (which integration), tx hash, amount paid, timestamp, and chain. This file is the primary artifact for bounty submission proof.

### cache.ts — Graceful Degradation Cache

An in-memory key-value store where every entry has a TTL. Default TTLs: 10 minutes for market data, 30 minutes for Olas results.

On every REPORT phase, the cache writes its contents to `agent/.cache/` on disk. On startup, the cache restores from disk. This means the agent can restart without losing the last known good data — critical for graceful degradation when data sources fail.

The cache is the safety net: if x402 endpoints are down, if Locus budget is exhausted, if Olas times out — the FSM uses the last successfully cached value rather than crashing.

**Verification**: Import config, create logger, call `loadConfig()`, see structured JSON output.

---

## Step 3: Pool Reader — `pool-reader.ts`

Responsible for reading all on-chain state from the deployed `CuratedVaultHook` contract.

```
pool-reader.ts                    CuratedVaultHook (Base Sepolia)
     |                                      |
     |--- viem multicall ----------------->|
     |    getPerformanceMetrics()           |--- volume, feeRevenue, swapCount,
     |    totalAssets()                     |    liquidity, tickLower, tickUpper,
     |    activeCuratorId()                 |    currentFee, amount0, amount1
     |<------------------------------------|
     |
     +--- Returns structured PoolState
```

Uses **viem's multicall** to batch all reads into a single RPC round-trip. This minimizes latency and RPC costs.

**On-chain functions called**:
- `getPerformanceMetrics()` — returns volume, fee revenue, swap count, liquidity, tick lower, tick upper, and current fee in one call
- `totalAssets()` — returns idle token0 and token1 held by the hook
- `activeCuratorId()` — identifies which curator is currently active

The ABI can be extracted from Foundry's compiled output at `out/CuratedVaultHook.sol/CuratedVaultHook.json`, or hand-crafted as a const array matching the Solidity function signatures.

**Verification**: Run against Base Sepolia at the deployed hook address. The agent should log the full pool state — current tick, tick range, total liquidity, fee, and idle assets.

---

## Step 4: Locus Client — `locus.ts`

The agent's operational wallet. Every micropayment the agent makes flows through Locus.

```
                  locus.ts
                     |
    +----------------+----------------+
    |                |                |
 authenticate()   getBalance()    canSpend(amount)
    |                |                |
    v                v                v
 POST /api/auth   GET balance     1. amount <= per-tx limit ($0.50)?
 apiKey -> JWT    from Locus API  2. dailySpent + amount <= daily cap ($5.00)?
 (15-min TTL)                     3. balance >= amount?
                                  4. All pass -> true, increment daily counter
                                  5. Any fail -> false
```

**Authentication flow**: The Locus API key (prefix `claw_dev_*`) is exchanged for a JWT via `POST /api/auth`. The JWT has a 15-minute TTL. Before every API call, the client checks whether the JWT is within 1 minute of expiry — if so, it automatically re-authenticates. This prevents mid-request expiry failures.

**`canSpend()` is the critical bridge to x402-client.ts**. Before every paid data request, the x402 client calls `canSpend(price)`. This enforces three spending controls:
1. **Per-transaction limit** ($0.50) — no single API call can exceed this
2. **Daily allowance** ($5.00) — cumulative spending cap, resets at midnight UTC
3. **Balance check** — verifies the wallet actually has sufficient USDC

If any check fails, `canSpend` returns false and the x402 client skips that data source, falling back to cached data.

The client also exposes `getBalance()` for pre-flight checks and `transferUSDC()` for future use (e.g., paying Olas mechs with USDC if native ETH isn't available).

**API base**: `https://beta-api.paywithlocus.com/api`

**Verification**: Authenticate with a real API key, check wallet balance, confirm `canSpend(0.01)` returns true when balance is sufficient.

---

## Step 5: Uniswap API Client — `uniswap-api.ts`

The simplest module. Fetches price quotes from the Uniswap Trading API.

```
uniswap-api.ts                    Uniswap Trading API
     |                                    |
     |--- GET /v1/quote ----------------->|
     |    x-api-key header                |
     |    tokenIn: wstETH                 |
     |    tokenOut: USDC                  |
     |    chainId: 8453 (Base)            |
     |<-----------------------------------|
     |    price, gasEstimate, route       |
     |
     +--- Returns numeric wstETH/USDC price
```

This is free tier — requires only an API key from developers.uniswap.org, no payment. The client sends the chain ID (8453 for Base mainnet, 84532 for Base Sepolia), token addresses, and a swap amount. The response includes the quoted price, gas estimate, and the optimal routing path.

The module exposes two methods: a full `getQuote()` with all parameters, and a convenience `getPrice()` that returns just the wstETH/USDC price as a number.

Rate limiting: respect 429 responses with exponential backoff.

**Verification**: Call the API with a real key, get a valid wstETH/USDC quote. Log the response — this is Uniswap bounty proof.

---

## Step 6: x402 Client — `x402-client.ts`

The paid market data layer. Buys real-time price feeds, volatility metrics, and sentiment data via x402 micropayments.

```
x402-client.ts                        AgentCash CLI              x402 Endpoint
     |                                     |                          |
     |-- locus.canSpend($0.003)? ----+     |                          |
     |                               |     |                          |
     |   YES                         |     |                          |
     |   |                           |     |                          |
     |   +-- npx agentcash fetch --->|     |                          |
     |       --max-amount 0.50       |---->| HTTP request              |
     |                               |     |<----| 402 + pricing       |
     |                               |     |---->| SIWX or USDC sign   |
     |                               |     |<----| Data returned        |
     |<-- { data, paymentInfo } -----|     |                          |
     |                                                                 |
     |   NO (budget exhausted)                                         |
     |   +-- cache.get('lastMarketData')                               |
     |   +-- return stale data with warning                            |
```

**Implementation approach**: Shells out to the `npx agentcash fetch` CLI rather than reimplementing the x402 protocol. The CLI handles the entire 402 negotiation cycle — initial request, SIWX authentication attempt (free if the endpoint supports it), USDC payment signing if still needed, and retry with payment proof attached. The CLI outputs structured JSON to stdout, which the module parses.

This is the pragmatic choice for hackathon speed. The alternative — implementing direct HTTP with 402 header parsing, SIWX challenge signing, and USDC credential construction — is fragile and duplicates what AgentCash already solves.

**Startup discovery**: On agent boot, the client runs `npx agentcash discover` against all known origins (stableenrich.dev, stablesocial.dev) to catalog available endpoints with their schemas and pricing. This catalog is cached so that per-cycle requests don't need to re-discover.

**`fetchMarketData()` — the key aggregation method**:

1. Checks Locus budget first (`canSpend` with the estimated total cost)
2. Fires off 3-4 requests in parallel to different endpoints:
   - **Price feed** (wstETH/USDC) from stableenrich.dev — ~$0.001-0.01 per request
   - **Volatility metrics** from stableenrich.dev — ~$0.01-0.05 per request
   - **Sentiment / social signals** from stablesocial.dev — ~$0.005-0.02 per request
   - **On-chain analytics** (optional, budget permitting) — ~$0.005-0.03 per request
3. Each individual request: checks `canSpend(endpoint_price)` independently, sets `--max-amount` guard, logs the payment tx hash to the payment ledger
4. Uses `Promise.allSettled` — if one source fails or is too expensive, the others still complete
5. Any failed source falls back to cached data from the last successful cycle

**Daily cost at 5-minute intervals**: ~4 calls per cycle, 288 cycles per day = ~1,152 calls/day, costing roughly $0.05-$0.50/day depending on endpoint pricing.

**Verification**: Discover endpoints on stableenrich.dev, make one paid fetch, confirm payment tx hash in the response and in `payment-log.json`.

---

## Step 7: Mech Client — `mech-client.ts`

Sends 10+ requests to the Olas Mech Marketplace for cross-checking Venice AI's analysis.

```
mech-client.ts                     mechx CLI (Python)          Olas Mech Marketplace
     |                                   |                          (Base)
     |-- spawns 10 requests ----------->|                              |
     |   in parallel batches            |                              |
     |                                  |-- on-chain request -------->|
     |                                  |                              |-- routes to AI mech
     |                                  |<-- result (p_yes/p_no) -----|
     |                                  |                              |
     |<-- parsed JSON responses --------|                              |
     |                                                                  |
     +-- Aggregates all results into MechResults                        |
     +-- Tracks requestCount (must be >= 10) and txHashes[]             |
```

**Why CLI shelling**: The mech-client SDK is Python-only (`pip install mech-client`). Since our agent is TypeScript, we have two options: (A) shell out to the `mechx request` CLI and parse its JSON output, or (B) implement an HTTP off-chain mode by discovering the mech's HTTP URL from its `ComplementaryServiceMetadata` contract. Option A is simpler and handles all on-chain mechanics (payment, request routing, result fetching) automatically. This is the recommended approach for hackathon speed.

**The 10 required requests** (bounty minimum — must demonstrate at least 10 per session):

| # | What we're asking | Mech tool | What we get back |
|---|---|---|---|
| 1 | wstETH/USDC price direction next 4 hours | prediction_request | Directional probability (p_yes/p_no/confidence) |
| 2 | Probability wstETH drops >2% in 4 hours | superforecaster | Calibrated downside probability |
| 3 | Probability wstETH rises >2% in 4 hours | superforecaster | Calibrated upside probability |
| 4 | Current wstETH/USD spot price | price_oracle | Numeric price for cross-checking |
| 5 | ETH implied volatility next 24 hours | openai-gpt-4o | Volatility narrative + estimate |
| 6 | Optimal concentrated liquidity tick range given current vol | openai-gpt-4o | Range recommendation narrative |
| 7 | Optimal LP fee tier for wstETH/USDC in current conditions | openai-gpt-4o | Fee recommendation narrative |
| 8 | Probability ETH breaks above resistance level in 4 hours | prediction_request | Resistance breakout probability |
| 9 | Probability ETH breaks below support level in 4 hours | prediction_request | Support breakdown probability |
| 10 | Current DeFi market sentiment for ETH ecosystem | openai-gpt-4o | Sentiment summary |

**Execution strategy**: All 10 requests fire simultaneously via `Promise.allSettled` with the `--use-offchain` flag (faster than on-chain result fetching) and a 120-second timeout per request. Partial failures are logged but don't abort the analysis — if 7 out of 10 succeed, the agent proceeds with what it has.

**Latency consideration**: On-chain mech requests can take 10-30 seconds each for confirmation. Running all 10 in parallel keeps total wall-clock time around 30-60 seconds rather than 5+ minutes if sequential.

**Payment**: On Base, the agent pays with native ETH per-request (or USDC if the specific mech supports it). The mech's price is discoverable via `maxDeliveryRate` on the contract (divide by 10^8 for the actual price in native token).

**Tracking**: The client maintains a running request count and an array of all tx hashes. The FSM checks `getRequestCount() >= 10` before considering the session's Olas bounty requirement met.

**Verification**: Run `mechx mech list --chain-config base` to discover available mechs. Send one test request. Verify a response is returned and the tx hash is recorded.

---

## Step 8: Venice AI Client — `venice.ts`

The intelligence layer — the agent's brain. Takes all collected data and produces a structured rebalance recommendation.

```
venice.ts
  |
  |  Inputs (from ANALYZE phase):
  |  +-- PoolState (from pool-reader)
  |  +-- MarketData (from x402-client, or null if failed)
  |  +-- MechResults (from mech-client, or null if failed)
  |  +-- Uniswap price quote (from uniswap-api, or null if failed)
  |
  |  Sends to Venice AI:
  |  +-- System prompt (constant, cached by Venice across cycles)
  |  +-- User message (built per-cycle from all available data)
  |  +-- recommend_rebalance function tool definition
  |
  |  Receives:
  |  +-- Function call with { newTickLower, newTickUpper, newFee, confidence, reasoning }
  |  +-- OR null if validation fails / API errors
  |
  v
  Validated RebalanceRecommendation -> passed to DECIDE phase
```

**SDK**: Uses the standard `openai` npm package, pointing `baseURL` at `https://api.venice.ai/api/v1`. Venice explicitly implements the OpenAI API spec, so the SDK handles chat completions, function calling, streaming, and type safety out of the box.

**Model selection**:
- **Primary**: `zai-org-glm-4.7` — Venice's flagship model. 128k context window (fits all market data easily), supports function calling (structured output), and is the highest quality option for financial analysis.
- **Fallback**: `llama-3.3-70b` — M-tier with higher rate limits (50 req/min vs 20 req/min for L-tier). Used when the primary model returns 429 or 500.

**System prompt design**: A constant prompt that stays the same across all FSM cycles. Venice automatically caches this, reducing token costs on subsequent calls. The prompt describes:
- The agent's role (expert Uniswap v4 concentrated liquidity manager for wstETH/USDC on Base)
- Pool parameters (tick spacing 60, fee range 100-100000 in hundredths of bip)
- Output format requirements (ticks must be divisible by 60, tickUpper > tickLower, fee in range, confidence 0-1)
- Decision framework (high volatility = wider range + higher fee, low volatility = tighter range + lower fee, strong trend = shift range directionally, high volume = higher fee, confidence < 0.5 = no rebalance)

**User message construction**: Built fresh each cycle from all available data. The message is structured into labeled sections — pool state, x402 market data, Olas Mech analysis, Uniswap quote. If a data source failed (returned null), that section is omitted entirely rather than sending nulls. Venice then works with whatever data is available, noting in its reasoning what information was missing.

**Function calling**: Venice is instructed to respond exclusively via the `recommend_rebalance` tool, which forces structured output. The tool definition specifies five required fields: newTickLower (integer), newTickUpper (integer), newFee (integer), confidence (number 0-1), and reasoning (string). When Venice responds with `finish_reason: "tool_calls"`, the client extracts and parses the function arguments.

**Venice-specific parameters**:
- `include_venice_system_prompt: false` — uses only our custom system prompt, not Venice's default
- `enable_web_search: "auto"` — lets Venice decide if real-time web data would supplement the market data we've already provided
- `strip_thinking_response: false` — preserves `<think>` reasoning blocks for audit trail and dashboard logging

**Response validation** (after parsing the function call):
1. newTickLower must be divisible by tick spacing (60)
2. newTickUpper must be divisible by tick spacing (60)
3. newTickUpper must be greater than newTickLower
4. newFee must be between 1 and 100000 (0.0001% to 10%)
5. confidence must be between 0 and 1

If any validation check fails, the raw response is logged and the function returns null. The FSM then skips the cycle.

**Fallback logic**: If the primary model returns 429 (rate limited) or 500 (inference failed), the client retries once with the fallback model. If the fallback also fails, the function returns null and the FSM skips the cycle. No infinite retry loops.

**Balance checking**: Before the first Venice call each session, check credits via `GET /billing/balance`. Log a warning if the balance is low.

**Verification**: Send a hardcoded pool state (e.g., tick at -60, range [-120, 120], fee 3000, some fabricated market data). Confirm Venice returns a valid function call response. Parse and validate the recommendation. Log the reasoning trail.

---

## Step 9: Rebalancer — `rebalancer.ts`

Encodes rebalance calldata and coordinates with the existing `delegation.ts` to execute on-chain.

```
rebalancer.ts
  |
  |  shouldRebalance(currentPoolState, veniceRecommendation) -> boolean
  |    +-- Tick range changed by > 60 (one tick spacing)?
  |    +-- OR fee changed by > 500 (0.05%)?
  |    +-- AND confidence >= threshold (default 0.6)?
  |    +-- AND >= 30 blocks since last rebalance (rate limit)?
  |    +-- All conditions met -> true, otherwise false
  |
  |  executeRebalance(recommendation) -> { txHash, success }
  |    |
  |    +-- 1. Encode rebalance calldata via viem:
  |    |      rebalance(newTickLower, newTickUpper, newFee, maxIdleToken0, maxIdleToken1)
  |    |      target = hook contract address
  |    |
  |    +-- 2. Pass to delegation.ts (already implemented):
  |    |      delegation.ts builds DelegationManager.redeemDelegations() call
  |    |      routes through Curator Smart Account
  |    |      Smart Account calls hook.rebalance()
  |    |      CuratedVaultCaveatEnforcer validates: fee in bounds, rate limit met
  |    |
  |    +-- 3. Wait for tx receipt, return hash
  |
  |  maxIdleToken0 / maxIdleToken1 set to max uint256 (hackathon simplicity)
```

**Decision logic in `shouldRebalance()`**: The agent does not rebalance on every cycle. It only acts when Venice's recommendation is meaningfully different from the current on-chain state. The thresholds are:
- The new tick range differs from the current by more than one tick spacing (60 ticks) on either bound
- OR the new fee differs from the current fee by more than 500 (0.05%)
- AND Venice's confidence score meets or exceeds the configured threshold (default 0.6)
- AND at least 30 blocks have passed since the last rebalance (enforced both here as a check and on-chain by the CuratedVaultCaveatEnforcer)

This prevents unnecessary gas spend and churn from marginal changes.

**Calldata encoding**: Uses viem's `encodeFunctionData` to produce the exact bytes for `rebalance(int24,int24,uint24,uint256,uint256)`. The `maxIdleToken0` and `maxIdleToken1` parameters are set to `type(uint256).max` for hackathon simplicity — a production system would compute expected idle amounts from the price and new tick range plus a slippage tolerance.

**On-chain execution path**: The rebalancer does NOT call the hook directly (that would fail — `msg.sender` must be the Curator Smart Account). Instead, it passes the encoded calldata to `delegation.ts`, which constructs the `DelegationManager.redeemDelegations()` transaction. The DelegationManager validates the signed delegation, the CuratedVaultCaveatEnforcer checks the fee bounds and rate limit, and if everything passes, the call routes through the Curator Smart Account to `hook.rebalance()`.

**Verification**: Unit test the calldata encoding by comparing output against `cast calldata "rebalance(int24,int24,uint24,uint256,uint256)" -120 120 3000 <max> <max>`. Full integration test requires the delegation setup from Phase 3.

---

## Step 10: FSM + Entry Point — `fsm.ts`, `index.ts`

### FSM State Machine (`fsm.ts`)

The core orchestrator. Manages state transitions and coordinates all modules through a single `runCycle()` method.

```
                     +----------+
                     |   IDLE   |<-----------+----------+---------+
                     +----------+            |          |         |
                          |                  |          |         |
                     timer expires           |          |         |
                          v                  |          |         |
                     +----------+            |          |         |
                +--->| MONITOR  |            |          |         |
                |    +----------+            |          |         |
                |         |                  |          |         |
                |    RPC fails?              |          |         |
                |    YES -----> log -------->|          |         |
                |    NO: pool state read     |          |         |
                |         |                  |          |         |
                |         v                  |          |         |
                |    +----------+            |          |         |
                |    | ANALYZE  |            |          |         |
                |    +----------+            |          |         |
                |         |                  |          |         |
                |    Venice returns null?    |          |         |
                |    YES -----> log -------->|          |         |
                |    NO: recommendation      |          |         |
                |         |                  |          |         |
                |         v                  |          |         |
                |    +----------+            |          |         |
                |    | DECIDE   |            |          |         |
                |    +----------+            |          |         |
                |      /      \              |          |         |
                |    NO        YES           |          |         |
                |   change    change         |          |         |
                |    |          |            |          |         |
                |    +--------->|            |          |         |
                |               v            |          |         |
                |         +----------+       |          |         |
                |         | EXECUTE  |       |          |         |
                |         +----------+       |          |         |
                |              |             |          |         |
                |         tx fails? ---------+          |         |
                |         tx succeeds                   |         |
                |              |                        |         |
                |              v                        |         |
                |         +----------+                  |         |
                |         | REPORT   |                  |         |
                |         +----------+                  |         |
                |              |                        |         |
                +----<---------+----------<-------------+---------+
```

**State-by-state breakdown**:

**MONITOR**: Calls `poolReader.getPoolState()`. This is the only mandatory data source — if the RPC call fails, the entire cycle aborts to IDLE. On success, the agent has a complete snapshot of the current on-chain state: tick, range, liquidity, fee, volume, revenue.

**ANALYZE**: The most complex phase. Three data sources fire in parallel (since they're independent of each other), then Venice consumes their results sequentially:

```
                    ANALYZE
                       |
         +-------------+-------------+
         |             |             |
   uniswap-api    x402-client    mech-client
   (free quote)   (paid data)    (10+ paid reqs)
         |             |             |
         +------+------+------+------+
                |             |
         Promise.allSettled   |
                |             |
         All results          |
         (some may be null)   |
                |             |
                v             |
           venice.ts          |
           (sequential,       |
            needs all data)   |
                |
                v
         RebalanceRecommendation (or null)
```

`Promise.allSettled` is used for the parallel phase — if x402 fails but Uniswap and Olas succeed, the agent still has useful data for Venice. Venice receives whatever data is available, with null fields indicating which sources were unavailable. Venice's system prompt instructs it to work with partial data and note what's missing in its reasoning.

**DECIDE**: Pure computation, no I/O. Calls `rebalancer.shouldRebalance()` with the current pool state and Venice's recommendation. If the recommendation is null (Venice failed), skips to IDLE. If the recommendation isn't different enough or confidence is below threshold, skips to IDLE. Only if all conditions are met does the FSM advance to EXECUTE.

**EXECUTE**: Calls `rebalancer.executeRebalance()` which encodes the calldata and delegates to `delegation.ts` for on-chain execution. If the transaction reverts, the error is logged but the agent does NOT retry — the enforcer's rate limit means a rapid retry could fail for the same reason. The agent waits for the next cycle.

**REPORT**: Writes the complete `CycleResult` to the structured log. Persists the cache to disk. Appends any new payment tx hashes to `payment-log.json`. This phase is best-effort — if logging fails, the agent continues.

### Entry Point (`index.ts`)

The main function performs startup initialization and then runs the FSM in an infinite loop.

**Startup sequence**:
1. Load and validate configuration (fail fast on missing required vars)
2. Initialize all module clients (pool reader, locus, uniswap, x402, mech, venice, rebalancer)
3. Restore the data cache from disk (last known good state)
4. **Pre-flight checks**: authenticate with Locus (verify API key works, get JWT), check wallet balance (log warning if low), verify Venice AI is reachable (health check)
5. **One-time discovery**: discover x402 endpoints on stableenrich.dev and stablesocial.dev, cache the endpoint catalog with pricing
6. Create the FSM instance with all dependencies injected

**Main loop**:
- Call `fsm.runCycle()`, log the result summary (cycle number, whether rebalance was executed, count of payments, count of errors)
- Persist cache to disk
- Wait for `cycleIntervalMs` (default 5 minutes)
- Repeat forever

**Circuit breaker**: If 3 consecutive cycles fail at the MONITOR step (RPC unreachable), the agent enters exponential backoff mode: 5 min → 10 min → 20 min → 30 min cap. The backoff resets on the first successful MONITOR read. This prevents the agent from hammering a dead RPC endpoint.

### Cycle Timing Budget

The 5-minute cycle provides ample headroom:

```
Phase         Expected     Max
------        --------     ---
MONITOR       1-2s         10s
ANALYZE       30-90s       180s    (Olas is the bottleneck)
DECIDE        <1ms         1s
EXECUTE       5-15s        60s
REPORT        <1s          5s
------        --------     ---
Total active  ~40-110s     ~256s
Idle buffer   ~190-260s    ~44s
```

Even in the worst case (every service is slow), the agent finishes with 44 seconds to spare before the next cycle.

---

## Error Handling Strategy

### Design Patterns

**Null-return pattern**: Every module function returns `T | null` rather than throwing. The FSM checks for null and degrades gracefully. This keeps the control flow in the FSM clean and prevents a single failing data source from crashing the entire agent.

**Promise.allSettled for parallel I/O**: The ANALYZE phase fires three data sources simultaneously. `allSettled` ensures that if one source fails (rejects), the others still complete and their results are available. The FSM inspects each result's status and uses the cache for any that failed.

**Cache as safety net**: Every successful data fetch is cached with a TTL. When a source fails, the FSM falls back to the cached version. The cache persists to disk, so even an agent restart doesn't lose the last known good data.

**Auto-retry with model fallback**: Venice AI retries once with a fallback model on 429/500. Locus auto-refreshes expired JWT tokens. These are the only retry behaviors — everything else fails gracefully to null.

**No retry on transaction revert**: If the rebalance transaction reverts on-chain, the error reason is logged but the agent does NOT retry in the same cycle. The enforcer's rate limit means a rapid retry would likely fail again, and retrying with different parameters without new data would be arbitrary. The agent waits for the next cycle.

**Circuit breaker**: If the RPC is down (MONITOR fails 3 times in a row), the agent backs off exponentially to avoid hammering a dead endpoint and wasting resources.

### Per-Module Error Matrix

```
Module          Error Scenario                    Recovery
-----------     ----------------------------      --------------------------------
pool-reader     RPC timeout                       Retry once with 5s delay, then
                                                  abort entire cycle

pool-reader     Invalid data (zero liquidity)     Log warning, proceed with degraded
                                                  state

locus           JWT expired                       Auto-refresh, retry original call

locus           Insufficient balance              canSpend returns false for all
                                                  remaining calls; agent uses cached
                                                  data only

locus           API unreachable                   Use last known balance from cache

x402-client     402 price too expensive            Skip that data source, use cache

x402-client     Endpoint completely down          Try alternative origin; if all fail,
                                                  use cache

x402-client     Daily budget exhausted            All canSpend calls return false;
                                                  agent enters data-free mode (cache
                                                  only for remainder of day)

mech-client     CLI not installed (Python          Log error at startup, skip Olas
                missing)                          entirely; agent still functions
                                                  without Mech data

mech-client     Individual request timeout        Kill that process after 120s; the
                (>120s)                           remaining requests still proceed

mech-client     Fewer than 10 requests succeed    Log warning (bounty requirement may
                                                  not be met); proceed with partial
                                                  results

venice          Rate limited (429)                Switch to fallback model, retry once

venice          Server error (500)                Retry once with fallback model; if
                                                  that fails, return null (skip cycle)

venice          Invalid response (ticks not       Log raw response for debugging;
                divisible by 60, etc.)            return null (skip cycle)

venice          Low confidence (< threshold)      Pass to DECIDE, which correctly
                                                  skips the rebalance

rebalancer      Transaction reverts               Log revert reason; do NOT retry
                                                  (rate limit risk from enforcer)

rebalancer      Gas estimation fails              Log error, abort EXECUTE phase

rebalancer      Delegation expired or revoked     Log as CRITICAL; halt the agent
                                                  (human intervention required)
```

---

## Key On-Chain Interfaces the Agent Interacts With

```
Contract                       Source File                           What the Agent Does
----------------------------   ------------------------------------  ---------------------------------
CuratedVaultHook               src/CuratedVaultHook.sol             READS: getPerformanceMetrics(),
                                                                    totalAssets(), getCurrentFee(),
                                                                    getCurator()
                                                                    WRITES: rebalance() (via delegation)

CuratedVaultCaveatEnforcer     src/CuratedVaultCaveatEnforcer.sol   Called indirectly -- validates that
                                                                    rebalance params are within the fee
                                                                    bounds and rate limit set by the
                                                                    delegator

DelegationManager              MetaMask Delegation Framework        delegation.ts calls
                                                                    redeemDelegations() to route the
                                                                    rebalance through the Curator Smart
                                                                    Account
```

**Key constants from contracts**: tick spacing = 60, DEFAULT_FEE = 3000 (0.30%), MAX_FEE = 100000 (10%), MIN_REBALANCE_INTERVAL = 30 blocks (~1 min on Base), MAX_PERFORMANCE_FEE_BPS = 2000 (20%).

---

## Environment Variables

**Required** (agent refuses to start without these):

| Variable | Purpose |
|---|---|
| `BASE_SEPOLIA_RPC` | Base Sepolia RPC endpoint for on-chain reads and tx submission |
| `VENICE_API_KEY` | Venice AI API key for inference calls |
| `HOOK_ADDRESS` | Deployed CuratedVaultHook contract address |
| `AGENT_PRIVATE_KEY` | Agent EOA private key for signing delegation redemption txs |

**Required for full operation** (agent starts but degrades without):

| Variable | Purpose |
|---|---|
| `UNISWAP_API_KEY` | Uniswap Trading API key for price quotes |
| `LOCUS_API_KEY` | Locus API key (`claw_dev_*`) for wallet management |
| `LOCUS_WALLET_ID` | Locus smart wallet ID |
| `DELEGATION_SIGNED_BYTES` | Pre-signed delegation from Curator Smart Account |
| `CURATOR_SMART_ACCOUNT` | MetaMask Smart Account address that delegated to the agent |
| `MECHX_CHAIN_RPC` | RPC endpoint for Olas Mech requests on Base |

**Optional with defaults**:

| Variable | Default | Purpose |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | 0.6 | Minimum Venice AI confidence to trigger rebalance |
| `CYCLE_INTERVAL_MS` | 300000 | Time between FSM cycles (5 minutes) |
| `MAX_X402_PER_TX` | 0.50 | Maximum USDC per single x402 payment |
| `MAX_X402_DAILY` | 5.00 | Maximum USDC daily x402 spend |
| `POOL_MANAGER_ADDRESS` | — | Uniswap v4 PoolManager address on Base |

---

## Verification Checklist

Run the agent for 3+ cycles on Base Sepolia and confirm:

- [ ] **MONITOR**: Pool state read each cycle — logs current tick, tick range, liquidity, fee
- [ ] **Venice AI**: Recommendation logged with reasoning trail and confidence score
- [ ] **Olas**: 10+ mech request tx hashes recorded in `payment-log.json`
- [ ] **x402**: Payment tx hashes visible in Locus wallet transaction history
- [ ] **Rebalance**: At least one rebalance tx confirmed on-chain, OR skipped with logged reason (confidence too low, not different enough)
- [ ] **Resilience**: Agent survives intermittent API failures — uses cache, continues to next cycle
- [ ] **Negative test**: Stop the agent entirely, confirm the vault is unaffected (LPs can still deposit/withdraw, swaps still work at the last-set fee)
- [ ] **Payment log**: `payment-log.json` contains all tx hashes across all integrations for bounty submission

---

## Bounty Alignment

| Bounty | Prize | How CuratedLP Satisfies It |
|---|---|---|
| **Venice AI** | $11,500 | Every FSM cycle sends pool state + market data to Venice for analysis. Function calling produces structured recommendations. Reasoning trail logged. Private inference (no data retention). Highest-value bounty — must be robust. |
| **Merit/x402** | $5,250 | Every FSM cycle pays for 3-4 market data calls via x402 micropayments. ~1,152 calls/day at 5-min intervals. Each payment generates a verifiable USDC tx on Base. |
| **Locus** | $3,000 | Agent's sole payment infrastructure. Every x402 call flows through Locus wallet with per-tx ($0.50), daily ($5), and total ($50) spending controls. MCP integration at mcp.paywithlocus.com. |
| **Olas** | $1,000 | 10+ distinct mech requests per session (predictions, price oracle, analysis). Each generates an on-chain tx hash. Results are load-bearing input to Venice AI's decision. |
| **Total** | **$20,750** | All payment tx hashes consolidated in `payment-log.json` for submission proof. |
