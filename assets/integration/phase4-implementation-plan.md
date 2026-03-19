# Phase 4 Implementation Plan: Venice AI + x402 + Locus + Olas

*Last updated: 2026-03-20*

*Depends on: openclaw-agent-spec.md, curator-agent-identity-spec.md, phase3-testing.md*

---

## Context

Phases 1-3 built the on-chain contracts (hook, shares, enforcer) and
the OpenClaw agent base (SKILL.md, pool-reader, execute-rebalance,
claim-fees, delegation lifecycle). Phase 3 testing validated that
OpenClaw can invoke tools and make autonomous decisions using a
simple on-chain-only heuristic.

Phase 4 replaces that simple heuristic with real intelligence: Venice
AI for market analysis, x402/AgentCash for paid market data, Locus
for autonomous spending, Olas Mech for cross-checking, and Uniswap
Trading API for price quotes.

**What already exists from Phase 3:**

```
  agent/
    workspace/
      SKILL.md                 Phase 3 version (simple heuristic)
    src/
      setup.ts                 One-time curator setup
      delegation.ts            Delegation lifecycle demo
      sub-delegation.ts        3-party chain demo
      tools/
        pool-reader.ts         Reads hook state (working)
        execute-rebalance.ts   Triggers rebalance via delegation (working)
        claim-fees.ts          Triggers fee claim via delegation (working)
    package.json               viem, @metamask/smart-accounts-kit, dotenv
    tsconfig.json
    .env.example
```

**What Phase 4 adds:**

```
  agent/
    workspace/
      SKILL.md                 UPDATED — full autonomous reasoning framework
    src/
      tools/
        check-budget.ts        NEW — Locus wallet balance + daily spend
        uniswap-quote.ts       NEW — Uniswap Trading API price quote
        market-data.ts         NEW — AgentCash x402 paid data
        olas-analyze.ts        NEW — Olas Mech 10+ requests
        venice-analyze.ts      NEW — Venice AI recommendation
      lib/
        config.ts              NEW — env var loading + validation
        cache.ts               NEW — file-persisted data cache with TTL
        logger.ts              NEW — structured logging + payment log
        types.ts               NEW — shared TypeScript interfaces
    package.json               UPDATED — add openai, pino
    .env.example               UPDATED — add Venice, Locus, Uniswap keys
```

**What Phase 4 does NOT add:**

fsm.ts and index.ts are not needed. OpenClaw's LLM runtime IS the FSM.
It reads the SKILL.md, invokes tools via exec, and reasons about what
to do each heartbeat. The TypeScript tools are stateless CLI commands,
not parts of a state machine.

**Bounty targets**: Venice AI ($11,500) + Merit/x402 ($5,250) + Locus ($3,000) + Olas ($1,000) = $20,750 total.

---

## Architecture — Phase 4

```
  OpenClaw Runtime (reasoning)
       |
       | reads SKILL.md (Phase 4 version — full decision framework)
       | heartbeat fires every 5 minutes
       |
       | OBSERVE
       |   pool-reader ---------> Base Sepolia RPC (existing)
       |   check-budget --------> Locus API (NEW)
       |
       | REASON ABOUT DATA NEEDS
       |   Agent decides what to fetch based on budget + cache freshness
       |
       | ANALYZE
       |   uniswap-quote -------> Uniswap Trading API (NEW, free)
       |   market-data ----------> AgentCash x402 (NEW, paid via Locus)
       |   olas-analyze ---------> Olas Mech Marketplace (NEW, paid)
       |   venice-analyze -------> Venice AI API (NEW)
       |
       | DECIDE
       |   Agent reasons holistically (replaces Phase 3 simple heuristic)
       |
       | ACT
       |   execute-rebalance ----> DelegationManager → Hook (existing)
       |   claim-fees -----------> DelegationManager → Hook (existing)
       |
       | REFLECT
       |   Log cycle results + payment tx hashes
```

---

## What Changes from Phase 3

| Aspect | Phase 3 | Phase 4 |
|---|---|---|
| Decision intelligence | Simple heuristic (idle balance proxy) | Venice AI with full market data |
| Data sources | On-chain only (pool-reader) | On-chain + x402 + Olas + Uniswap API |
| Spending | None | Locus wallet pays for data (USDC) |
| SKILL.md | Simple guidelines | Full autonomous framework with budget-adaptive strategy |
| Tools | 3 (pool-reader, execute-rebalance, claim-fees) | 8 (add check-budget, uniswap-quote, market-data, olas-analyze, venice-analyze) |
| Execution path | Unchanged | Unchanged — same delegation redemption |

The Phase 3 tools (pool-reader, execute-rebalance, claim-fees) are NOT
modified. Phase 4 only adds new tools alongside them.

---

## Build Order

Phase 4 tools have minimal dependencies on each other. Most can be
built in parallel. The only dependency is that market-data requires
check-budget (to verify Locus balance before spending).

```
  Foundation (lib modules — build first)
       |
       +-- config.ts, types.ts, logger.ts, cache.ts
       |
       | (all tools depend on these)
       |
  +----+----+----+----+
  |    |    |    |    |
  v    v    v    v    v
 check uniswap olas venice market
 budget quote  analyze analyze data
  |                           |
  |    (market-data calls     |
  +--- check-budget before ---+
       each paid request)

  After all tools pass isolation tests:
       |
       v
  Update SKILL.md with full Phase 4 decision framework
       |
       v
  Update .env.example with new env vars
       |
       v
  End-to-end OpenClaw integration test
```

**Recommended build sequence:**

| Step | What | Depends on | Bounty |
|---|---|---|---|
| 1 | Foundation libs (config, types, logger, cache) | Nothing | — |
| 2 | check-budget (Locus client) | Step 1 | Locus ($3,000) |
| 3 | uniswap-quote (Trading API) | Step 1 | Uniswap ($5,000) |
| 4 | olas-analyze (Mech requests) | Step 1 | Olas ($1,000) |
| 5 | market-data (x402/AgentCash) | Steps 1 + 2 | Merit ($5,250) |
| 6 | venice-analyze (Venice AI) | Step 1 | Venice ($11,500) |
| 7 | Update SKILL.md | Steps 2-6 | — |
| 8 | End-to-end test | All | All |

Steps 2, 3, and 4 can be built in parallel. Step 5 needs step 2
(check-budget) merged first. Step 6 is independent but should be
built after steps 3-5 so that test data is available to feed Venice.

---

## Two-Person Parallel Work Division

The tool-based architecture makes parallel work straightforward. Each
tool is a standalone CLI script with no in-process dependencies on
other tools. Two people can build tools simultaneously — OpenClaw's
SKILL.md is the only integration point, and it's updated at the end.

### Shared Setup (Step 1)

Both people need Step 1 (foundation libs) done first. Do this together
or have one person do it and merge before splitting.

**Coordination point:** agree on the JSON output contracts in types.ts
before diverging. Each tool's output shape must match what the SKILL.md
documents.

### Person A — Payments + Paid Data (Steps 2, 4, 5)

| Step | Tool | Blocked by | Bounty |
|---|---|---|---|
| 2 | check-budget | Nothing | Locus ($3,000) |
| 5 | market-data | Step 2 (same person, no wait) | Merit ($5,250) |
| 4 | olas-analyze | Nothing | Olas ($1,000) |

Person A builds check-budget first (smallest tool), then immediately
uses it inside market-data. olas-analyze is independent and can be
built in parallel with either. Zero cross-person dependencies.

### Person B — Free Data + Intelligence (Steps 3, 6)

| Step | Tool | Blocked by | Bounty |
|---|---|---|---|
| 3 | uniswap-quote | Nothing | Uniswap ($5,000) |
| 6 | venice-analyze | Nothing | Venice ($11,500) |

Person B's tools have zero dependencies on Person A. uniswap-quote
and venice-analyze can be built in parallel.

### Integration (Both — Steps 7, 8)

| Step | What | Blocked by |
|---|---|---|
| 7 | Update SKILL.md | All tools from both people pass isolation tests |
| 8 | End-to-end OpenClaw integration test | Step 7 |

Done together once both tracks are merged.

### Why this split works

Zero cross-person blocking. The only dependency (market-data needs
check-budget) lives entirely within Person A's track:

```
  Person A                          Person B
  +--------------------------+      +--------------------------+
  |                          |      |                          |
  | Step 1: foundation libs  |<---->| Step 1: foundation libs  |
  | (shared)                 |      | (shared)                 |
  +--------------------------+      +--------------------------+
           |                                 |
           v                                 v
  +--------------------------+      +--------------------------+
  | Step 2: check-budget     |      | Step 3: uniswap-quote   |
  | Step 4: olas-analyze     |      | Step 6: venice-analyze   |
  | (parallel, independent)  |      | (parallel, independent)  |
  +--------------------------+      +--------------------------+
           |                                 |
           v                                 |
  +--------------------------+               |
  | Step 5: market-data      |               |
  | (uses own check-budget)  |               |
  +--------------------------+               |
           |                                 |
           +----------------+----------------+
                            |
                            v
                   Both tools merged
                            |
                            v
               +--------------------------+
               | Step 7: update SKILL.md  |
               | Step 8: integration test |
               | (both people together)   |
               +--------------------------+
```

---

## Step 1: Foundation Libraries

Four small utility modules in `agent/src/lib/` that every tool depends on.

### types.ts

Defines the data shapes that flow between tools. These match the JSON
output contracts specified in openclaw-agent-spec.md section 5:

- **PoolState** — all fields from pool-reader output
- **BudgetStatus** — all fields from check-budget output
- **MarketData** — all fields from market-data output
- **MechResults** — all fields from olas-analyze output
- **RebalanceRecommendation** — all fields from venice-analyze output
- **RebalanceResult** — all fields from execute-rebalance output
- **ClaimResult** — all fields from claim-fees output

### config.ts

Loads all configuration from environment variables via dotenv. Validates
at startup. Fails fast if required values are missing.

Required (tool won't start): BASE_SEPOLIA_RPC, HOOK_ADDRESS.

Required for specific tools:
- check-budget: LOCUS_API_KEY, LOCUS_WALLET_ID
- uniswap-quote: UNISWAP_API_KEY
- venice-analyze: VENICE_API_KEY
- execute-rebalance / claim-fees: CURATOR_PRIVATE_KEY, MOLTBOT_PRIVATE_KEY, ENFORCER_ADDRESS

Optional with defaults: confidence threshold (0.6), Venice primary model
(zai-org-glm-4.7), Venice fallback model (llama-3.3-70b), max x402
per-tx ($0.50), max x402 daily ($5.00).

### logger.ts

Wraps the pino library with a factory function that creates per-tool
child loggers. Every log entry includes the source tool name.

Maintains a payment-log.json file — append-only ledger tracking every
payment tx hash across all integrations. Each entry records: source,
tx hash, amount, timestamp, network, endpoint. This file is the primary
bounty submission proof.

### cache.ts

In-memory key-value store where every entry has a TTL. Default TTLs:
10 minutes for market data, 30 minutes for Olas results.

On tool completion, cache writes to disk at agent/.cache/. On tool
startup, cache restores from disk. This means tools can use stale-but-
available data when live sources fail.

**Verification:**

Standalone: Run bun run src/lib/config.ts. Confirm it loads env vars,
logs structured JSON output with secrets redacted, and fails fast if
required vars are missing.

---

## Step 2: check-budget Tool

**Purpose:** Check Locus wallet balance and daily spending status.

**Input:** None (reads LOCUS_API_KEY and LOCUS_WALLET_ID from env vars).

**Output fields:** balanceUSDC, dailySpent, dailyCap, dailyRemaining,
perTxMax, canSpend (boolean).

**Implementation details:**

Authentication flow: Locus API key (claw_dev_* prefix) is exchanged
for a JWT via POST /api/auth. JWT has 15-minute TTL. Before every API
call, the tool checks whether the JWT is within 1 minute of expiry —
if so, auto-refreshes.

canSpend logic: checks three conditions:
1. Amount does not exceed per-tx limit ($0.50)
2. dailySpent + amount does not exceed daily cap ($5.00)
3. Wallet balance is sufficient

API base: https://beta-api.paywithlocus.com/api

**Failure mode:** Returns canSpend as false with stale balance. The
agent (via OpenClaw reasoning) uses cache for all paid data sources.

**SKILL.md update:** Add check-budget to the Available Tools section
with its invocation pattern and output fields. Add it to the OBSERVE
phase of the heartbeat protocol (invoked alongside pool-reader at the
start of every cycle). Add budget-adaptive data strategy to the
Decision Guidelines section — the agent should reference the budget
when deciding which paid data sources to fetch.

**Verification:**

Standalone: Run bun run src/tools/check-budget.ts with a real Locus
API key. Confirm JSON output with balanceUSDC and canSpend fields.
Confirm canSpend is true when balance is sufficient.

OpenClaw: Run one heartbeat. Verify the agent invokes check-budget
alongside pool-reader at the start of the cycle. Verify the agent
references the budget in its reasoning when deciding which data sources
to fetch (e.g., "Budget is $4.20, I can afford full fetch").

---

## Step 3: uniswap-quote Tool

**Purpose:** Get current wstETH/USDC price quote from Uniswap Trading API.

**Input:** None (reads UNISWAP_API_KEY from env vars).

**Output fields:** price, gasEstimate, route, requestId.

**Implementation details:**

Single POST /v1/quote call to trade-api.gateway.uniswap.org with:
- x-api-key header
- x-universal-router-version: 2.0
- tokenIn: wstETH on Base (0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452)
- tokenOut: USDC on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- chainId: 84532 (Base Sepolia) or 8453 (Base mainnet)
- amount: 1000000 (1 USDC equivalent for a price quote)
- type: EXACT_INPUT

Free tier — no payment needed. Rate limiting: respect 429 responses
with exponential backoff.

**Failure mode:** Returns null. Agent proceeds without price data.

**SKILL.md update:** Add uniswap-quote to the Available Tools section.
Add it to the ANALYZE phase of the heartbeat protocol as a free data
source that is always invoked (no budget check needed). Update the
error handling section to note that if uniswap-quote fails, the agent
proceeds with other data sources and notes the missing price.

**Verification:**

Standalone: Run bun run src/tools/uniswap-quote.ts with a real API key.
Confirm JSON output with a numeric price and a requestId. Log the
requestId — this is Uniswap bounty proof.

OpenClaw: Run one heartbeat. Verify the agent invokes uniswap-quote
and includes the price in the data it passes to Venice (or references
in its own reasoning if Venice is not yet integrated). Verify the agent
still functions if the tool returns null (e.g., API key invalid) — it
should note "Uniswap price unavailable" in reasoning and proceed.

---

## Step 4: olas-analyze Tool

**Purpose:** Send 10+ requests to Olas Mech Marketplace for cross-check
analysis.

**Input:** Pool state JSON passed as argument.

**Output fields:** priceDirection (p_up, p_down, confidence),
dropProbability, riseProbability, volatilityEstimate,
tickRangeRecommendation, feeRecommendation, sentiment, requestCount,
successCount, txHashes (array), fromCache (boolean).

**Implementation details:**

Shells out to the mechx CLI (Python, installed via pip install
mech-client). The 10 required requests:

| # | Prompt | Tool |
|---|---|---|
| 1 | wstETH/USDC price direction next 4 hours | prediction_request |
| 2 | Probability wstETH drops >2% in 4 hours | superforecaster |
| 3 | Probability wstETH rises >2% in 4 hours | superforecaster |
| 4 | Current wstETH/USD spot price | price_oracle |
| 5 | ETH implied volatility next 24 hours | openai-gpt-4o |
| 6 | Optimal tick range for wstETH/USDC given vol | openai-gpt-4o |
| 7 | Optimal LP fee for wstETH/USDC | openai-gpt-4o |
| 8 | Probability ETH breaks above resistance | prediction_request |
| 9 | Probability ETH breaks below support | prediction_request |
| 10 | DeFi market sentiment for ETH ecosystem | openai-gpt-4o |

All 10 fire in parallel with 120-second timeout per request. Partial
failures are OK — agent sees successCount and adjusts confidence.

Payment: on Base, the agent pays with USDC per request (via Locus
wallet). Mech price discoverable via maxDeliveryRate on the contract.

**Failure mode:** Returns whatever succeeded. If all fail, returns
cached results with fromCache as true.

**SKILL.md update:** Add olas-analyze to the Available Tools section
with its invocation pattern (takes pool state JSON as argument) and
output fields. Add it to the ANALYZE phase. It should only be invoked
when the budget allows (it's a paid source). Update the Decision
Guidelines to note that Olas results feed into Venice as supplementary
data. Update error handling to note that partial Olas results
(successCount < 10) are still usable — the agent should note the
shortfall in reasoning.

**Verification:**

Standalone: Run mechx mech list --chain-config base to discover mechs.
Run bun run src/tools/olas-analyze.ts --pool '<pool-json>' with a
real pool state from pool-reader. Confirm JSON output with
requestCount >= 10, successCount > 0, and txHashes array non-empty.
Verify tx hashes are recorded in payment-log.json.

OpenClaw: Run one heartbeat. Verify the agent invokes olas-analyze
with the pool state from pool-reader as the argument. Verify the
agent includes Olas results in what it passes to Venice. If
successCount < 10, verify the agent notes this in reasoning ("only
8/10 Mech requests succeeded"). If olas-analyze fails entirely, verify
the agent proceeds with other data sources and notes "Olas data
unavailable, using cache" or similar.

---

## Step 5: market-data Tool

**Purpose:** Fetch real-time market data via AgentCash x402 micropayments.
Paid from Locus wallet (USDC, gasless).

**Input:** None (discovers endpoints on first run, caches catalog).

**Output fields:** price, volume24h, volatility, sentiment, timestamp,
sources (list), totalCost, paymentTxHashes (list), fromCache (boolean).

**Implementation details:**

Shells out to npx agentcash fetch CLI for each data endpoint. The CLI
handles the full 402 negotiation cycle: initial request, SIWX auth
attempt (free if supported), USDC payment if still 402, retry with
payment proof.

Startup discovery: on first run, calls npx agentcash discover against
stableenrich.dev and stablesocial.dev. Caches the endpoint catalog.

For each request:
1. Check Locus budget via check-budget logic (canSpend with endpoint price)
2. If budget allows, call agentcash fetch with --max-amount guard
3. If budget exhausted or endpoint fails, fall back to cached data
4. Log payment tx hash to payment-log.json

3-4 requests per heartbeat: price feed, volatility, sentiment,
optionally on-chain analytics. Uses Promise.allSettled — partial
failures are fine.

Daily cost at 5-minute intervals: ~4 calls per cycle, 288 cycles
per day = ~1,152 calls/day, roughly $0.05-$0.50/day.

**Failure mode:** Returns whatever succeeded plus cached data for
failures. fromCache is true if all live sources failed.

**SKILL.md update:** Add market-data to the Available Tools section
with its invocation pattern and output fields. Add it to the ANALYZE
phase as a paid data source — the agent must check budget (via
check-budget output) before invoking. Update the Decision Guidelines
to link the budget-adaptive strategy to this tool: when budget is
comfortable, invoke market-data; when budget is tight, skip it and use
cached data. Update error handling to note that fromCache=true means
stale data — the agent should lower its confidence in decisions.

**Verification:**

Standalone: Run npx agentcash discover https://stableenrich.dev to
verify endpoint catalog is returned. Run bun run src/tools/market-data.ts.
Confirm JSON output with price, volatility, sentiment fields.
Confirm paymentTxHashes array is non-empty. Confirm the same tx hashes
appear in payment-log.json. Confirm Locus wallet balance decreased
by the totalCost amount.

OpenClaw: Run one heartbeat. Verify the agent checks budget first
(via check-budget), then invokes market-data only if canSpend is true.
If budget is low, verify the agent skips market-data and notes
"budget insufficient, using cached market data" in reasoning.
Verify payment-log.json is appended with new tx hashes after each
heartbeat that fetches paid data.

---

## Step 6: venice-analyze Tool

**Purpose:** Send all gathered data to Venice AI and receive a structured
rebalance recommendation.

**Input:** Pool state JSON (required), market data JSON (optional),
Olas results JSON (optional), Uniswap price (optional). Any argument
can be omitted if that data source was unavailable.

**Output fields:** newTickLower, newTickUpper, newFee, confidence
(0 to 1), reasoning (text), dataSources (list), missingData (list),
model (which Venice model was used).

**Implementation details:**

Uses the openai npm package, pointing baseURL at https://api.venice.ai/api/v1.
Venice implements the OpenAI API spec, so the SDK handles chat
completions, function calling, and type safety.

Model selection:
- Primary: zai-org-glm-4.7 (128k context, function calling)
- Fallback: llama-3.3-70b (higher rate limits, used on 429/500)

System prompt: constant across cycles (Venice caches it). Describes
the agent's role as an expert Uniswap v4 concentrated liquidity
manager for wstETH/USDC on Base. Specifies output format requirements:
ticks divisible by 60, fee in range 100-100000, confidence 0-1.

Decision framework in the system prompt:
- High volatility → wider range, higher fee
- Low volatility → tighter range, lower fee
- Strong trend → shift range directionally
- High volume → higher fee
- Confidence < 0.5 → recommend no rebalance

User message: built per-cycle from all available data. Structured
into labeled sections — pool state, x402 market data, Olas Mech
analysis, Uniswap quote. Missing sources are noted explicitly so
Venice adjusts its confidence accordingly.

Function calling: Venice responds via a recommend_rebalance tool
with five required fields: newTickLower (int), newTickUpper (int),
newFee (int), confidence (float 0-1), reasoning (string).

Response validation:
1. newTickLower divisible by 60
2. newTickUpper divisible by 60
3. newTickUpper > newTickLower
4. newFee between 1 and 100000
5. confidence between 0 and 1

If validation fails, raw response is logged and tool returns null.

Venice-specific parameters:
- include_venice_system_prompt: false (use only our prompt)
- enable_web_search: "auto" (supplement our data if Venice decides to)
- strip_thinking_response: false (preserve reasoning for audit trail)

**Failure mode:** Returns null. Agent skips the cycle.

**SKILL.md update:** Add venice-analyze to the Available Tools section
with its invocation pattern (takes pool state as required arg, market
data, Olas results, and Uniswap price as optional args) and output
fields. Add it to the ANALYZE phase as the final step — invoked after
all data sources have been gathered. Replace the Phase 3 simple
heuristic in the Decision Guidelines with Venice-driven reasoning:
the agent should pass Venice's confidence, tick range, and fee to its
DECIDE phase and act based on whether the recommendation is meaningful
and confidence is sufficient. Update error handling for Venice failure
(429/500 → fallback model, both fail → skip cycle).

This is the step where the SKILL.md transitions from Phase 3 to
Phase 4. After this update, the SKILL.md has the full autonomous
reasoning framework.

**Verification:**

Standalone: Run bun run src/tools/venice-analyze.ts --pool '<pool-json>'
with a real pool state from pool-reader. Optionally add --market,
--olas, --price args with real data from the other tools. Confirm JSON
output with newTickLower, newTickUpper, newFee (all valid), confidence
between 0 and 1, and a reasoning string. Confirm ticks are divisible
by 60. Test with missing data args — confirm Venice still responds
and lists missing sources in missingData field.

OpenClaw: Run one heartbeat. Verify the agent gathers data from all
available sources (pool-reader, check-budget, uniswap-quote,
market-data, olas-analyze), then passes them as arguments to
venice-analyze. Verify the agent reads Venice's confidence and
reasoning, then DECIDES whether to act based on the recommendation.
Verify:
- High confidence + meaningful change → agent calls execute-rebalance
- Low confidence → agent skips and logs "confidence too low"
- Venice returns null (simulated failure) → agent skips entire cycle
Verify the agent's reasoning trail references Venice's output
("Venice recommends [-180, 180] at 5000 with 0.82 confidence").

---

## Step 7: Final SKILL.md Review

Each step above includes its own SKILL.md update. By the time all
tools are built and tested, the SKILL.md should already be the full
Phase 4 version. This step is a review pass to ensure consistency:

- All 8 tools are listed in the Available Tools section with correct
  invocation patterns and output fields
- The heartbeat protocol reflects the full flow: OBSERVE (pool-reader +
  check-budget) → REASON about data needs → ANALYZE (uniswap-quote +
  market-data + olas-analyze + venice-analyze) → DECIDE → ACT → REFLECT
- The Decision Guidelines section has the full autonomous framework
  (budget-adaptive strategy, Venice-driven reasoning, fee claiming
  matrix) and no remnants of the Phase 3 simple heuristic
- The error handling section covers all failure modes for all tools
- The constraints section is unchanged from Phase 3
- The Phase 3 tool specs (pool-reader, execute-rebalance, claim-fees)
  are unchanged

---

## Step 8: Update .env.example

Add new environment variables:

Required for Phase 4 tools:
- VENICE_API_KEY — Venice AI API key
- UNISWAP_API_KEY — Uniswap Trading API key
- LOCUS_API_KEY — Locus API key (claw_dev_* prefix)
- LOCUS_WALLET_ID — Locus smart wallet ID

Optional with defaults:
- CONFIDENCE_THRESHOLD — minimum Venice confidence to act (default: 0.6)
- VENICE_PRIMARY_MODEL — Venice model (default: zai-org-glm-4.7)
- VENICE_FALLBACK_MODEL — fallback model (default: llama-3.3-70b)
- MAX_X402_PER_TX — max USDC per x402 payment (default: 0.50)
- MAX_X402_DAILY — max USDC daily x402 spend (default: 5.00)

---

## New Dependencies

Add to package.json:
- openai — Venice AI SDK (OpenAI-compatible)
- pino — structured JSON logging

The existing dependencies (viem, @metamask/smart-accounts-kit, dotenv)
remain unchanged.

---

## Testing Strategy

### Tool-level isolation tests (before OpenClaw)

Each tool is tested standalone before wiring into OpenClaw:

| Tool | Test command | What to verify |
|---|---|---|
| check-budget | bun run src/tools/check-budget.ts | Returns balance, canSpend is true |
| uniswap-quote | bun run src/tools/uniswap-quote.ts | Returns valid price, requestId logged |
| olas-analyze | bun run src/tools/olas-analyze.ts --pool '...' | Returns results from 10+ requests, tx hashes |
| market-data | bun run src/tools/market-data.ts | Returns price data, payment tx hashes |
| venice-analyze | bun run src/tools/venice-analyze.ts --pool '...' | Returns recommendation with valid ticks |

### Incremental OpenClaw integration

After each tool passes isolation testing, update the SKILL.md to
include it and verify OpenClaw uses it correctly:

```
  Phase 3 base (already working)
       |
       | Add check-budget
       | Verify: agent reads budget, adapts data strategy
       v
  Phase 4a: budget awareness
       |
       | Add uniswap-quote
       | Verify: agent fetches price, includes in reasoning
       v
  Phase 4b: + price data
       |
       | Add market-data
       | Verify: agent pays for data via Locus, uses in reasoning
       | Verify: payment-log.json has x402 tx hashes
       v
  Phase 4c: + paid market data
       |
       | Add olas-analyze
       | Verify: agent sends 10+ Mech requests, uses results
       | Verify: payment-log.json has Olas tx hashes
       v
  Phase 4d: + Olas cross-check
       |
       | Add venice-analyze
       | Verify: agent sends all data to Venice, gets recommendation
       | Verify: agent reasons about confidence, acts or skips
       v
  Phase 4 complete: full autonomous reasoning
```

This incremental approach means each integration is validated before
the next is added. If venice-analyze fails, the agent still has
check-budget + uniswap-quote + market-data + olas-analyze working.

### End-to-end verification

Run the agent for 3+ heartbeat cycles on Base Sepolia and verify:

**OBSERVE phase:**
- [ ] pool-reader returns valid state each cycle
- [ ] check-budget returns Locus balance and spending status

**REASON phase:**
- [ ] Agent adapts data gathering to budget (full/partial/minimal)
- [ ] Agent explains its data strategy in reasoning log

**ANALYZE phase:**
- [ ] uniswap-quote returns a price (free, keyed)
- [ ] market-data returns paid data with tx hashes
- [ ] olas-analyze returns 10+ Mech results with tx hashes
- [ ] venice-analyze returns recommendation with confidence + reasoning

**DECIDE phase:**
- [ ] Agent reasons holistically about whether to act
- [ ] Agent skips when confidence is low or change is insignificant
- [ ] Agent acts when confidence is high and change is meaningful

**ACT phase:**
- [ ] Rebalance tx confirmed on Sepolia via delegation
- [ ] Hook state changed (tick range and/or fee)
- [ ] Fee claim works when fees are accrued

**REFLECT phase:**
- [ ] Cycle log written with all data gathered + decision reasoning
- [ ] payment-log.json has tx hashes from x402 + Olas

**Autonomous decision testing:**
- [ ] Agent makes DIFFERENT decisions across cycles (not robotic)
- [ ] Agent adapts when budget runs low (skips paid sources)
- [ ] Agent handles Venice failure gracefully (skips cycle)
- [ ] Agent handles x402 failure gracefully (uses cache)

---

## Bounty Alignment

| Bounty | Prize | How Phase 4 Satisfies It |
|---|---|---|
| Venice AI | $11,500 | venice-analyze tool sends pool state + all market data to Venice. Function calling produces structured recommendations. Reasoning trail logged. Private inference (no data retention). |
| Merit/x402 | $5,250 | market-data tool pays for 3-4 data calls per cycle via x402 micropayments. ~1,152 calls/day. Each payment generates verifiable USDC tx on Base. |
| Locus | $3,000 | check-budget tool queries Locus wallet. All x402 payments flow through Locus with per-tx ($0.50) and daily ($5.00) spending controls. |
| Olas | $1,000 | olas-analyze tool sends 10+ distinct Mech requests per session. Each generates on-chain tx hash. Results are load-bearing input to Venice. |
| Uniswap | $5,000 | uniswap-quote tool makes real API calls with real key. requestId logged. Combined with pool-reader reading from Uniswap v4 hook. |

Total: $20,750. All payment tx hashes consolidated in payment-log.json
for submission proof.

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Venice rate limited (429) | Fallback to secondary model. If both fail, skip cycle. |
| x402 facilitator limit | 1000 free tx/month is plenty. Monitor daily count. |
| Locus API unreachable | check-budget returns canSpend=false. Agent uses cache. |
| Olas Mech timeout (>120s per request) | 120s kill per process. Partial results OK. |
| All data sources fail simultaneously | Agent has cache. Venice works with partial data. Worst case: skip cycle. |
| Budget exhausted mid-day | Agent automatically shifts to minimal/cache-only strategy. Still observes and reasons. |
| mechx CLI not installed (Python missing) | Log error at startup. Skip Olas entirely. Agent still functions with Venice + x402. |
