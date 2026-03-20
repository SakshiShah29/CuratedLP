# Phase 4 Implementation Plan — REVISED

## Venice AI + EigenCompute + Locus + Olas + Uniswap API

*Last updated: 2026-03-20 (v2 — replaces original phase4-implementation-plan.md)*

*Depends on: openclaw-agent-spec.md, curator-agent-identity-spec.md, phase3-testing.md*

---

## What Changed and Why

Merit Systems dropped out of the Synthesis hackathon. This removes the
x402/AgentCash bounty ($5,250) and the `market-data` tool that depended
on it. EigenCloud ($5,000) replaces it as the new bounty target.

**Key changes from the original Phase 4 plan:**

| Aspect | Original Plan | Revised Plan |
|---|---|---|
| `market-data.ts` (AgentCash x402) | Core tool, 3-4 paid API calls/cycle | **REMOVED entirely** |
| `uniswap-quote.ts` | Single quote call (1 API call/cycle) | **EXPANDED → `uniswap-data.ts` (4 API calls/cycle: forward, reverse, large, approval)** |
| `eigencompute.ts` | Did not exist | **NEW — wraps Venice inference in a TEE** |
| Data pipeline | x402 endpoints for price/vol/sentiment | **Uniswap API × 4 calls for price/spread/depth + Olas Mech for predictions** |
| Venice web search | Not used | **OFF — Venice receives structured data, not web prose** |
| Bounty: Merit/x402 ($5,250) | Targeted | **DROPPED** |
| Bounty: EigenCloud ($5,000) | Not targeted | **NEW TARGET** |
| Uniswap API depth | 1 requestId per cycle | **4 requestIds per cycle (1,152+/day)** |
| Total Phase 4 bounty value | $20,750 | **$20,500** (nearly identical) |
| Locus spending | Pays for x402 + Olas | Pays for Olas Mech requests only |
| Tool count | 8 | **8** (pool-reader, check-budget, uniswap-data, eigencompute, olas-analyze, venice-analyze, execute-rebalance, claim-fees) |

**What stays exactly the same:**

- OpenClaw architecture (reasoning layer + CLI tools)
- SKILL.md as the agent's decision framework
- The heartbeat cycle (OBSERVE → REASON → ANALYZE → DECIDE → ACT → REFLECT)
- All Phase 3 tools (pool-reader, execute-rebalance, claim-fees)
- Venice AI as the primary intelligence (venice-analyze)
- Uniswap Trading API as the primary data source (expanded to 4 calls)
- Olas Mech for cross-checks (olas-analyze)
- Locus for agent spending controls (check-budget)
- Foundation libraries (config.ts, types.ts, logger.ts, cache.ts)

---

## Context

Phases 1-3 built the on-chain contracts (hook, shares, enforcer) and
the OpenClaw agent base (SKILL.md, pool-reader, execute-rebalance,
claim-fees, delegation lifecycle). Phase 3 testing validated that
OpenClaw can invoke tools and make autonomous decisions using a
simple on-chain-only heuristic.

Phase 4 replaces that simple heuristic with real intelligence: Venice
AI for market analysis (running inside EigenCompute TEE for
verifiability), Locus for autonomous spending controls, Olas Mech for
cross-checking, and Uniswap Trading API for price quotes.

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
        uniswap-data.ts        NEW — Uniswap Trading API × 4 calls (price, spread, depth, approval)
        olas-analyze.ts        NEW — Olas Mech 10+ requests
        venice-analyze.ts      NEW — Venice AI recommendation (structured data input)
        eigencompute.ts        NEW — EigenCompute TEE wrapper for Venice
      lib/
        config.ts              NEW — env var loading + validation
        cache.ts               NEW — file-persisted data cache with TTL
        logger.ts              NEW — structured logging + payment log
        types.ts               NEW — shared TypeScript interfaces
    Dockerfile                 NEW — EigenCompute deployment image
    package.json               UPDATED — add openai, pino
    .env.example               UPDATED — add Venice, Locus, Uniswap keys
```

**What Phase 4 does NOT add:**

fsm.ts and index.ts are not needed. OpenClaw's LLM runtime IS the FSM.
It reads the SKILL.md, invokes tools via exec, and reasons about what
to do each heartbeat. The TypeScript tools are stateless CLI commands,
not parts of a state machine.

**Bounty targets**: Venice AI ($11,500) + EigenCloud ($5,000) + Locus ($3,000) + Olas ($1,000) = $20,500 total from Phase 4. Combined with Uniswap ($5,000) + MetaMask ($5,000) + ENS ($1,500) + Self ($1,000) from other phases = $33,000 grand total.

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
       |   uniswap-data ---------> Uniswap Trading API × 4 calls (NEW, free)
       |     \-- forward quote (wstETH→USDC price)
       |     \-- reverse quote (USDC→wstETH price → bid/ask spread)
       |     \-- small quote (price impact → liquidity depth)
       |     \-- check_approval (vault token approval status)
       |   olas-analyze ---------> Olas Mech Marketplace (NEW, paid via Locus)
       |   venice-analyze -------> Venice AI API (NEW)
       |     \-- receives structured data from uniswap-data + olas
       |     \-- enable_web_search: "off" (has all quant data already)
       |     \-- optionally wrapped in eigencompute for verifiability
       |
       | DECIDE
       |   Agent reasons holistically (replaces Phase 3 simple heuristic)
       |
       | ACT
       |   execute-rebalance ----> DelegationManager → Hook (existing)
       |   claim-fees -----------> DelegationManager → Hook (existing)
       |
       | REFLECT
       |   Log cycle results + payment tx hashes + all Uniswap requestIds
```

---

## Where Does Market Data Come From Now?

With AgentCash/x402 removed, the agent's primary market data source
is the Uniswap Trading API — expanded from a single quote call to a
multi-call data tool that extracts price, spread, liquidity depth,
and approval status from the same API.

**1. Uniswap Trading API — Expanded (free with API key, 4 calls/cycle)**

The old `uniswap-quote` tool made a single quote call. The new
`uniswap-data` tool makes 4 calls per cycle, extracting structured
financial signals that are far more useful than web-scraped prose:

```
  Call 1: Forward Quote (wstETH → USDC)
  POST /v1/quote
  tokenIn: wstETH, tokenOut: USDC, amount: 1e18 (1 wstETH)
  Returns: price, gasEstimate, route, requestId
  Signal: current mid-market price

  Call 2: Reverse Quote (USDC → wstETH)
  POST /v1/quote
  tokenIn: USDC, tokenOut: wstETH, amount: 3400e6 (~1 wstETH worth)
  Returns: price, gasEstimate, route, requestId
  Signal: bid/ask spread = |forwardPrice - reversePrice|
          Wide spread → thin liquidity or volatile conditions
          → agent should widen tick range

  Call 3: Large Quote (10 wstETH → USDC)
  POST /v1/quote
  tokenIn: wstETH, tokenOut: USDC, amount: 10e18 (10 wstETH)
  Returns: price, gasEstimate, route, requestId
  Signal: price impact = |largePrice - smallPrice| / smallPrice
          High impact → shallow liquidity at current price
          → agent should widen range or raise fee

  Call 4: Check Approval
  POST /v1/check_approval
  walletAddress: vault hook address, token: wstETH, amount: max
  Returns: requestId, approval status, gasFee
  Signal: whether Permit2 approval is active for the vault
```

**Why 4 calls is better than web search:**

Each call returns structured JSON with exact numbers. The agent feeds
Venice precise data instead of hoping Venice finds the right web pages:

```
  Uniswap Market Data:
    Forward price (1 wstETH → USDC): $3,412.50
    Reverse price (USDC → 1 wstETH): $3,415.20
    Spread: $2.70 (0.08%) — normal, liquidity healthy
    Large order price (10 wstETH): $3,408.30
    Price impact at 10x: 0.12% — moderate depth
    Approval status: active (Permit2)
    Gas estimate: 0.0003 ETH
```

Venice gets exact numbers and can reason precisely about spread width,
price impact, and implied liquidity depth. Compare this to Venice web
search which would return prose like "wstETH is trading around $3,400
on Binance" — no spread, no depth, no precision.

**Every call generates a requestId** logged to the submission proof
file. At 4 calls per cycle × 288 cycles per day = **1,152+ logged
Uniswap API interactions** with real request IDs. This is an extremely
strong Uniswap bounty submission.

**2. Olas Mech Marketplace (paid, USDC via Locus)**

10+ requests for price predictions, volatility estimates, directional
sentiment, and cross-check analysis. Paid from Locus wallet. Results
feed into Venice as supplementary qualitative data alongside the
structured Uniswap numbers.

**3. Venice AI (free with API key, `enable_web_search: "off"`)**

Venice receives all structured data from uniswap-data and olas-analyze
as input. With precise quantitative data already provided, Venice's
`enable_web_search` is set to `"off"` for the primary inference call.
Venice focuses purely on analysis and recommendation — not data
gathering.

Optional: a separate lightweight Venice call with `enable_web_search:
"on"` can fetch qualitative sentiment (DeFi news, Lido governance
updates) as a supplementary signal. This is a stretch goal, not core.

**Data pipeline summary:**

```
  pool-reader (free, on-chain)
       |
       | Pool state: tick, liquidity, fee, volume, idle balances
       v
  uniswap-data (free, 4 API calls)
       |
       | Price: $3,412.50
       | Spread: 0.08%
       | Price impact at 10x: 0.12%
       | Approval: active
       | 4 requestIds logged
       v
  olas-analyze (paid via Locus, 10+ Mech requests)
       |
       | Predictions: 62% up, 38% down
       | Volatility estimate: 12% annualized
       | Sentiment: moderately bullish
       | 10+ tx hashes logged
       v
  venice-analyze (free, structured input, web search OFF)
       |
       | Recommendation: tick [-180, 120], fee 3500, confidence 0.82
       | Reasoning: "Spread is tight, depth is good, Olas sees upward
       |  bias — shift range slightly above current price, moderate fee"
       v
  eigencompute (optional TEE wrapper)
       |
       | Same recommendation + attestation hash proving verifiable compute
       v
  Agent DECIDES → execute-rebalance or skip
```

---

## What Is EigenCompute and How Does It Fit?

EigenCompute is EigenLayer's verifiable compute service. You deploy a
Docker image that runs inside a Trusted Execution Environment (TEE).
The TEE produces a cryptographic attestation proving that the code
ran unmodified inside the enclave.

**For CuratedLP, EigenCompute wraps the Venice inference step.**

Instead of the agent calling Venice directly, it calls the Venice
inference inside an EigenCompute TEE. The result: every rebalance
recommendation is verifiably computed — you can prove the AI actually
ran the analysis it claims it did, with no tampering.

```
  WITHOUT EigenCompute:
  Agent → Venice API → recommendation (trust the agent's claim)

  WITH EigenCompute:
  Agent → EigenCompute TEE → Venice API → recommendation + attestation
  (cryptographic proof the inference happened correctly)
```

**Why this matters for the project narrative:**

LPs currently trust the curator agent to honestly relay Venice's
recommendations. With EigenCompute, they don't need to trust —
they can verify. The TEE attestation proves:
- The Venice API was actually called (not a hardcoded response)
- The pool state data was actually passed (not manipulated)
- The recommendation was not altered after Venice returned it

**EigenCloud bounty requirements (all achievable):**

| Requirement | How We Satisfy It |
|---|---|
| Working Docker image on EigenCompute | Dockerfile that runs venice-analyze inside TEE |
| GitHub repo with README + setup instructions | Already needed for Uniswap bounty |
| Live demo or recorded demo (2-5 mins) | Part of our hackathon demo |
| Architecture diagram showing EigenCompute fit | Agent → EigenCompute → Venice → on-chain action |
| Supported stack: Node.js inside TEE | Our tools are already Node.js/TypeScript |

---

## The eigencompute.ts Tool

**Purpose:** Run Venice AI inference inside an EigenCompute TEE,
producing a verifiable attestation alongside the recommendation.

**Input:** Same as venice-analyze: pool state JSON (required),
Olas results JSON (optional), Uniswap price (optional).

**Output fields:** Everything from venice-analyze PLUS:
attestationHash, teeProvider, computeJobId, verifiable (boolean).

**Implementation approach:**

Option A — Full TEE deployment (ideal):

```
  1. Package venice-analyze.ts logic into a Docker image
  2. Deploy to EigenCompute via their CLI/API
  3. eigencompute.ts triggers the compute job with input data
  4. EigenCompute runs the Venice call inside TEE
  5. Returns recommendation + attestation hash
  6. Agent verifies attestation, uses recommendation
```

The Dockerfile:
```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src/tools/venice-analyze.ts ./src/tools/
COPY src/lib/ ./src/lib/
RUN npm install && npm run build
ENTRYPOINT ["node", "dist/tools/venice-analyze.js"]
```

Option B — Attestation wrapper (fallback if TEE setup is complex):

```
  1. eigencompute.ts calls venice-analyze locally
  2. Hashes the input + output together
  3. Submits the hash to EigenCompute for TEE-signed attestation
  4. Returns recommendation + attestation
```

This is weaker but still demonstrates the pattern. Option A is
preferred for a stronger bounty submission.

**SKILL.md update:** Add eigencompute to Available Tools section.
In the ANALYZE phase, the agent can choose to run Venice inference
through EigenCompute (verifiable but slower) or directly (faster but
unverified). For the demo, always use EigenCompute. In production,
agent would use judgment.

**Verification:**

Standalone: Build Docker image. Deploy to EigenCompute. Run with
real pool state input. Confirm output includes recommendation
(same as venice-analyze) PLUS attestationHash and computeJobId.
Verify attestation via EigenCompute's verification endpoint.

OpenClaw: Run one heartbeat. Verify agent invokes eigencompute
instead of (or in addition to) venice-analyze. Verify output
includes verifiable=true and attestation fields.

---

## What Changes from Phase 3

| Aspect | Phase 3 | Phase 4 |
|---|---|---|
| Decision intelligence | Simple heuristic (idle balance proxy) | Venice AI with structured Uniswap data + Olas predictions |
| Data sources | On-chain only (pool-reader) | On-chain + Uniswap API × 4 (price/spread/depth/approval) + Olas |
| Market data quality | None | Exact prices, bid/ask spread, price impact — structured JSON |
| Spending | None | Locus wallet pays for Olas Mech (USDC) |
| Verifiability | Trust the agent | EigenCompute TEE attestation on Venice calls |
| SKILL.md | Simple guidelines | Full autonomous framework with budget-adaptive strategy |
| Tools | 3 (pool-reader, execute-rebalance, claim-fees) | 8 (add check-budget, uniswap-data, olas-analyze, venice-analyze, eigencompute) |
| Uniswap API calls/cycle | 0 | 4 (forward quote, reverse quote, large quote, check approval) |
| Execution path | Unchanged | Unchanged — same delegation redemption |

The Phase 3 tools (pool-reader, execute-rebalance, claim-fees) are NOT
modified. Phase 4 only adds new tools alongside them.

---

## Build Order

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
 check uniswap olas venice eigen
 budget quote  analyze analyze compute
                              |
                              | (eigencompute wraps
                              |  venice-analyze)
                              +--- depends on venice-analyze

  After all tools pass isolation tests:
       |
       v
  Update SKILL.md with full Phase 4 decision framework
       |
       v
  Build Dockerfile for EigenCompute
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
| 3 | uniswap-data (Trading API × 4 calls) | Step 1 | Uniswap ($5,000) |
| 4 | olas-analyze (Mech requests) | Step 1 | Olas ($1,000) |
| 5 | venice-analyze (Venice AI) | Step 1 | Venice ($11,500) |
| 6 | eigencompute (TEE wrapper) | Step 5 | EigenCloud ($5,000) |
| 7 | Dockerfile + EigenCompute deploy | Step 6 | EigenCloud ($5,000) |
| 8 | Update SKILL.md | Steps 2-6 | — |
| 9 | End-to-end test | All | All |

Steps 2, 3, and 4 can be built in parallel. Step 5 is independent.
Step 6 wraps Step 5, so it must come after. Step 7 is the Docker
packaging for the EigenCloud bounty.

---

## Step-by-Step Implementation

### Step 1: Foundation Libraries

Four small utility modules in `agent/src/lib/` that every tool depends on.
**Unchanged from the original plan.** See the original phase4-implementation-plan.md
for full details on types.ts, config.ts, logger.ts, cache.ts.

One change to types.ts — remove `MarketData` interface (was for x402),
add `EigenComputeResult` interface:

```typescript
export interface EigenComputeResult extends RebalanceRecommendation {
  attestationHash: string;
  teeProvider: string;
  computeJobId: string;
  verifiable: boolean;
}
```

One change to config.ts — remove x402-related env vars
(MAX_X402_PER_TX, MAX_X402_DAILY), keep everything else.

---

### Step 2: check-budget Tool (Locus)

**Unchanged from the original plan.** Queries Locus wallet balance,
returns canSpend boolean, tracks daily spending.

With x402 removed, the only paid data source is Olas Mech. The
budget-adaptive strategy simplifies:

```
  Budget remaining        Data strategy
  > $1.00 (comfortable)   FULL: uniswap + olas + venice
  $0.10 - $1.00           PARTIAL: uniswap + venice (skip Olas, use cache)
  < $0.10 (near broke)    MINIMAL: uniswap + venice only (free sources)
  $0.00                   CACHE-ONLY: uniswap + cache + venice with partial data
```

Venice API calls and Uniswap API calls are free (covered by API keys).
Only Olas Mech requests cost USDC. This means the Locus wallet needs
less funding — $5-10 USDC covers the entire hackathon instead of $10+.

---

### Step 3: uniswap-data Tool (expanded from uniswap-quote)

**Purpose:** Extract structured market signals from the Uniswap Trading
API via multiple quote calls. This is the agent's primary source of
real-time, precise financial data.

**Input:** None (reads UNISWAP_API_KEY from env vars).

**Output fields:** forwardPrice, reversePrice, spread, spreadBps,
priceImpact10x, priceImpactBps, gasEstimate, approvalActive,
requestIds (array of 4), timestamp.

**Implementation:**

Four parallel API calls using Promise.allSettled:

```typescript
// Call 1: Forward quote — wstETH → USDC (current price)
const forward = await postQuote({
  type: 'EXACT_INPUT',
  tokenIn: WSTETH,
  tokenOut: USDC,
  tokenInChainId: CHAIN_ID,
  tokenOutChainId: CHAIN_ID,
  amount: parseUnits('1', 18).toString(),   // 1 wstETH
  swapper: HOOK_ADDRESS,
});

// Call 2: Reverse quote — USDC → wstETH (for bid/ask spread)
const reverse = await postQuote({
  type: 'EXACT_INPUT',
  tokenIn: USDC,
  tokenOut: WSTETH,
  tokenInChainId: CHAIN_ID,
  tokenOutChainId: CHAIN_ID,
  amount: parseUnits('3400', 6).toString(), // ~1 wstETH worth of USDC
  swapper: HOOK_ADDRESS,
});

// Call 3: Large quote — 10 wstETH → USDC (for price impact / depth)
const large = await postQuote({
  type: 'EXACT_INPUT',
  tokenIn: WSTETH,
  tokenOut: USDC,
  tokenInChainId: CHAIN_ID,
  tokenOutChainId: CHAIN_ID,
  amount: parseUnits('10', 18).toString(),  // 10 wstETH
  swapper: HOOK_ADDRESS,
});

// Call 4: Check approval status
const approval = await postCheckApproval({
  walletAddress: HOOK_ADDRESS,
  token: WSTETH,
  amount: MaxUint256.toString(),
  chainId: CHAIN_ID,
});
```

**Derived signals (computed from raw quotes):**

```typescript
const forwardPrice = parseFloat(forward.quote) / 1e6;  // USDC output per wstETH
const reversePrice = 3400 / (parseFloat(reverse.quote) / 1e18); // USDC per wstETH via reverse
const spread = Math.abs(forwardPrice - reversePrice);
const spreadBps = (spread / forwardPrice) * 10000;
const largePricePerUnit = (parseFloat(large.quote) / 1e6) / 10;
const priceImpact = Math.abs(forwardPrice - largePricePerUnit) / forwardPrice;
const priceImpactBps = priceImpact * 10000;
```

**What each signal tells Venice:**

| Signal | Meaning | Agent Action |
|---|---|---|
| `spread` | Bid/ask width, proxy for short-term volatility | Wide spread → widen tick range, raise fee |
| `spreadBps` | Spread in basis points, comparable across price levels | >50 bps = volatile, <10 bps = calm |
| `priceImpact10x` | How much price moves at 10x trade size | High impact → shallow depth → widen range |
| `priceImpactBps` | Impact in bps, directly informs fee setting | Impact > fee → fee is too low |
| `gasEstimate` | Current gas cost for a swap | Informs whether rebalance tx is worth it |
| `approvalActive` | Whether Permit2 approval is live | False → alert, may block execution |

**Rate limiting:** Uniswap Trading API has rate limits. All 4 calls
use the same API key. If any call returns 429, back off exponentially.
Partial results are fine — forward quote alone is sufficient minimum.

**Failure mode:** Returns whatever succeeded. If forward quote fails
(the most critical), returns null. Agent proceeds with pool-reader
data only and tells Venice "Uniswap data unavailable."

**SKILL.md update:** Replace `uniswap-quote` with `uniswap-data` in
Available Tools. Document all output fields and what they mean. In the
ANALYZE phase, uniswap-data is always invoked first (free, highest
value per call). Venice receives the full output as structured input.

**Verification:**

Standalone: Run `bun run src/tools/uniswap-data.ts` with a real API
key. Confirm JSON output with all fields populated: forwardPrice,
reversePrice, spread, spreadBps, priceImpact10x, priceImpactBps,
gasEstimate, approvalActive, and 4 requestIds. Log all requestIds
to payment-log.json (these are Uniswap bounty proof). Verify that
spread and priceImpact values are sensible (spread < 1% for a liquid
pair, price impact < 5%).

OpenClaw: Run one heartbeat. Verify the agent invokes uniswap-data
and includes ALL derived signals in the data it passes to Venice.
Verify the agent references specific numbers in its reasoning:
"Spread is 0.08% (healthy), price impact at 10x is 0.12% (moderate
depth), conditions favor a tighter range." Verify 4 requestIds
logged per cycle.

---

### Step 4: olas-analyze Tool

**Unchanged from the original plan.** Shells out to mechx CLI for 10+
parallel Mech requests. 120-second timeout per request. Payment via
Locus wallet (USDC on Base). Returns predictions, volatility estimates,
sentiment, tx hashes.

The 10 required requests remain the same (predictions, price oracle,
GPT-4o analysis for tick ranges, fees, volatility, sentiment).

---

### Step 5: venice-analyze Tool

**Updated from original — now receives structured Uniswap data instead
of relying on web search for market data.**

Venice's role changes from "data gatherer + analyzer" to pure
"analyzer + recommender." It receives precise structured data from
uniswap-data and olas-analyze, and focuses on reasoning.

**Input:** Pool state JSON (required), Uniswap data JSON (optional),
Olas results JSON (optional). Any input can be omitted if that data
source was unavailable. Venice works with whatever is provided.

**Output fields:** newTickLower, newTickUpper, newFee, confidence
(0 to 1), reasoning (text), dataSources (list), missingData (list),
model (which Venice model was used).

**Implementation:** Uses openai SDK pointing at Venice API. System
prompt defines the agent's role and output format. Function calling
forces structured output. Response validated (ticks divisible by 60,
fee in range, confidence 0-1). Fallback to secondary model on 429/500.

Updated system prompt:

```
You are an AI agent managing concentrated liquidity for a wstETH/USDC
pool on Uniswap v4 on Base.

You will receive structured market data from the Uniswap Trading API
and Olas Mech predictions. Use this data to recommend:

1. Optimal tick range [tickLower, tickUpper] (must be divisible by 60)
2. Recommended swap fee (100 = 0.01%, 3000 = 0.30%, max 100000 = 10%)
3. Confidence score 0 to 1
4. Brief reasoning explaining your recommendation

Key decision signals from Uniswap data:
- Spread (bid/ask width): wide spread → raise fee, widen range
- Price impact at 10x: high impact → shallow depth → widen range
- Price impact > current fee → fee is too low for the liquidity depth

Respond using the recommend_rebalance function.
```

User message per-cycle (structured, not prose):

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

Olas Mech cross-check (8/10 succeeded):
  Price direction: 62% up, 38% down (moderate bullish)
  Volatility estimate: 12% annualized
  Sentiment: moderately bullish
  Tick range suggestion: [-202000, -201600]
  Fee suggestion: 3500

Recommend optimal parameters.
```

Venice-specific parameters:
- `include_venice_system_prompt: false` (use only our prompt)
- **`enable_web_search: "off"`** (all quant data provided via structured input)
- `strip_thinking_response: false` (preserve reasoning for audit)

**Optional secondary call with web search:**

After the primary structured analysis, the agent MAY make a lightweight
second Venice call with `enable_web_search: "on"` to check for
qualitative signals:

```
"Are there any significant DeFi news events, Lido governance proposals,
or ETH ecosystem developments in the last 24 hours that could affect
wstETH/USDC liquidity? Brief answer only."
```

This is a stretch goal — the primary recommendation comes from
structured data alone. The qualitative check is additive context.

**Failure mode:** Returns null. Agent skips the cycle.

**SKILL.md update:** Add venice-analyze to Available Tools. Document
that it takes structured Uniswap data as input (not raw web search).
In the ANALYZE phase, venice-analyze is invoked AFTER uniswap-data
and olas-analyze so all structured data is available. Replace Phase 3
heuristic with Venice-driven reasoning. Update error handling.

### Step 6: eigencompute Tool

**NEW tool — does not exist in the original plan.**

**Purpose:** Run Venice AI inference inside an EigenCompute TEE,
producing a verifiable attestation that the recommendation was
computed honestly.

**Input:** Same as venice-analyze: pool state JSON (required),
Olas results JSON (optional), Uniswap price (optional).

**Output:** Everything from venice-analyze plus attestation fields.

**Implementation:**

```typescript
// eigencompute.ts — simplified flow

import { execSync } from 'child_process';

export async function runVerifiableInference(input: VeniceInput): Promise<EigenComputeResult> {
  // 1. Serialize input to JSON file
  const inputPath = writeInputFile(input);

  // 2. Submit to EigenCompute
  //    This runs our Docker image inside the TEE
  const jobId = submitEigenComputeJob({
    image: 'curatedlp/venice-analyzer:latest',
    input: inputPath,
    env: {
      VENICE_API_KEY: process.env.VENICE_API_KEY,
    },
  });

  // 3. Wait for completion (poll or webhook)
  const result = await waitForCompletion(jobId, { timeout: 60_000 });

  // 4. Return recommendation + attestation
  return {
    ...result.output,           // newTickLower, newTickUpper, newFee, etc.
    attestationHash: result.attestation.hash,
    teeProvider: 'eigencompute',
    computeJobId: jobId,
    verifiable: true,
  };
}
```

**The Dockerfile** (Step 7):

```dockerfile
FROM node:20-slim
WORKDIR /app

# Copy only what's needed for Venice inference
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --production

COPY src/tools/venice-analyze.ts ./src/tools/
COPY src/lib/config.ts src/lib/types.ts src/lib/cache.ts ./src/lib/

# Build
RUN npx tsc

# Entry point: takes pool state as arg, returns recommendation JSON
ENTRYPOINT ["node", "dist/tools/venice-analyze.js"]
```

This image contains only the Venice inference logic — no private keys,
no delegation code, no execution tools. It reads VENICE_API_KEY from
the environment (injected by EigenCompute at runtime) and produces
a recommendation JSON on stdout.

**EigenCompute deployment steps:**

1. Build and push Docker image: `docker build -t curatedlp/venice-analyzer .`
2. Register with EigenCompute CLI
3. Test: submit a job with sample pool state, verify attestation returned
4. Integrate into eigencompute.ts tool

**SKILL.md update:** Add eigencompute to Available Tools. In the ANALYZE
phase, the agent uses eigencompute instead of venice-analyze directly
when verifiability is desired. The tool has the same output format
plus attestation fields. If EigenCompute is down, fall back to direct
venice-analyze (unverified but functional).

---

### Step 7: Dockerfile + EigenCompute Deployment

This is the EigenCloud bounty deliverable. The required artifacts:

1. **Dockerfile** — packages venice-analyze into a TEE-compatible image
2. **Docker image deployed on EigenCompute** — running and verifiable
3. **Architecture diagram** — showing how EigenCompute fits in the stack:

```
  OpenClaw Agent (reasoning)
       |
       | ANALYZE phase
       v
  eigencompute.ts (tool)
       |
       | submits job
       v
  +-----------------------------------------------+
  |  EigenCompute TEE                              |
  |                                                |
  |  Docker: curatedlp/venice-analyzer             |
  |    |                                           |
  |    | VENICE_API_KEY injected via TEE env       |
  |    |                                           |
  |    v                                           |
  |  venice-analyze logic                          |
  |    |                                           |
  |    | calls Venice API from inside TEE          |
  |    v                                           |
  |  recommendation JSON                           |
  |    + TEE attestation hash                      |
  +-----------------------------------------------+
       |
       | recommendation + attestation
       v
  OpenClaw Agent
       |
       | DECIDE: use verified recommendation
       v
  execute-rebalance → on-chain
```

4. **GitHub repo with README** — includes EigenCompute setup instructions
5. **Live demo** — show the attestation hash in the agent's logs during
   the rebalance flow. "This recommendation was computed inside a TEE —
   here's the attestation proving it."

---

### Step 8: Update SKILL.md

Each step above includes its own SKILL.md update. By the time all
tools are built, the SKILL.md should be the full Phase 4 version.

Final review checklist:
- All 8 tools listed in Available Tools with correct invocation + output
- Heartbeat protocol: OBSERVE (pool-reader + check-budget) → REASON →
  ANALYZE (uniswap-quote + olas-analyze + eigencompute/venice-analyze)
  → DECIDE → ACT → REFLECT
- Decision Guidelines: budget-adaptive strategy, Venice-driven reasoning
- No remnants of x402/AgentCash/market-data tool
- EigenCompute documented as optional verifiable wrapper for Venice
- Error handling covers all failure modes including EigenCompute timeout

---

### Step 9: Update .env.example

Required for Phase 4 tools:
- VENICE_API_KEY — Venice AI API key
- UNISWAP_API_KEY — Uniswap Trading API key
- LOCUS_API_KEY — Locus API key
- LOCUS_WALLET_ID — Locus smart wallet ID

Optional with defaults:
- CONFIDENCE_THRESHOLD — minimum Venice confidence to act (default: 0.6)
- VENICE_PRIMARY_MODEL — Venice model (default: qwen3-235b)
- VENICE_FALLBACK_MODEL — fallback model (default: llama-3.3-70b)
- EIGENCOMPUTE_ENABLED — use TEE for Venice calls (default: true)

**Removed from original plan:** MAX_X402_PER_TX, MAX_X402_DAILY
(no longer relevant without x402)

---

## New Dependencies

Add to package.json:
- `openai` — Venice AI SDK (OpenAI-compatible)
- `pino` — structured JSON logging

The existing dependencies (viem, @metamask/smart-accounts-kit, dotenv)
remain unchanged. No x402-related packages needed.

---

## Testing Strategy

### Tool-level isolation tests

| Tool | Test command | What to verify |
|---|---|---|
| check-budget | `bun run src/tools/check-budget.ts` | Returns balance, canSpend is true |
| uniswap-data | `bun run src/tools/uniswap-data.ts` | Returns forwardPrice, spread, priceImpact, 4 requestIds |
| olas-analyze | `bun run src/tools/olas-analyze.ts --pool '...'` | Returns results from 10+ requests, tx hashes |
| venice-analyze | `bun run src/tools/venice-analyze.ts --pool '...'` | Returns recommendation with valid ticks, uses structured Uniswap data |
| eigencompute | `bun run src/tools/eigencompute.ts --pool '...'` | Returns recommendation + attestationHash + verifiable=true |

### Incremental OpenClaw integration

```
  Phase 3 base (already working)
       |
       | Add check-budget
       | Verify: agent reads budget, adapts data strategy
       v
  Phase 4a: budget awareness
       |
       | Add uniswap-data (4 calls: forward, reverse, large, approval)
       | Verify: agent fetches price + spread + depth, includes in reasoning
       | Verify: 4 requestIds logged per cycle
       v
  Phase 4b: + structured price data
       |
       | Add olas-analyze
       | Verify: agent sends 10+ Mech requests, uses results
       | Verify: payment-log.json has Olas tx hashes
       v
  Phase 4c: + Olas cross-check
       |
       | Add venice-analyze
       | Verify: agent passes structured Uniswap data + Olas to Venice
       | Verify: Venice reasons about spread, depth, predictions (not web)
       | Verify: agent reasons about confidence, acts or skips
       v
  Phase 4d: + Venice intelligence
       |
       | Add eigencompute
       | Verify: Venice runs inside TEE, attestation returned
       | Verify: agent logs attestation hash in REFLECT
       v
  Phase 4 complete: full autonomous + verifiable reasoning
```

### End-to-end verification

Run the agent for 3+ heartbeat cycles on Base Sepolia and verify:

**OBSERVE phase:**
- [ ] pool-reader returns valid state each cycle
- [ ] check-budget returns Locus balance and spending status

**REASON phase:**
- [ ] Agent adapts data gathering to budget (full/partial/minimal)
- [ ] Agent explains its data strategy in reasoning log

**ANALYZE phase:**
- [ ] uniswap-data returns forwardPrice, spread, priceImpact, 4 requestIds
- [ ] Agent derives spread and depth signals from quote comparison
- [ ] olas-analyze returns 10+ Mech results with tx hashes
- [ ] venice-analyze returns recommendation with confidence + reasoning
- [ ] Venice references specific Uniswap numbers in reasoning (not generic)
- [ ] eigencompute returns attestation hash (verifiable=true)

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
- [ ] payment-log.json has tx hashes from Olas Mech
- [ ] EigenCompute attestation hash logged

**Autonomous decision testing:**
- [ ] Agent makes DIFFERENT decisions across cycles (not robotic)
- [ ] Agent adapts when budget runs low (skips Olas, uses cache)
- [ ] Agent handles Venice failure gracefully (skips cycle)
- [ ] Agent handles EigenCompute failure gracefully (falls back to direct Venice)

---

## Bounty Alignment — Revised

| Bounty | Prize | How Phase 4 Satisfies It |
|---|---|---|
| Venice AI | $11,500 | venice-analyze receives structured Uniswap data + Olas predictions. Function calling produces structured recommendations. Reasoning trail shows Venice analyzing exact spread, depth, and directional signals. Private inference (zero data retention). |
| EigenCloud | $5,000 | Venice inference packaged as Docker image, deployed on EigenCompute TEE. Every recommendation has a verifiable attestation. Working demo shows attestation hash in agent logs. |
| Locus | $3,000 | check-budget queries Locus wallet. Olas Mech payments flow through Locus with per-tx and daily spending controls. Agent adapts behavior based on remaining budget. |
| Olas | $1,000 | olas-analyze sends 10+ distinct Mech requests per session. Each generates on-chain tx hash. Results are load-bearing input to Venice. |
| Uniswap | $5,000 | uniswap-data makes 4 real API calls per cycle with real key. Forward/reverse/large quotes + check_approval. 4 requestIds logged per cycle = 1,152+/day. Combined with pool-reader reading from Uniswap v4 hook + AI Skills. Deepest API integration of any bounty submission. |

Phase 4 total: $20,500. Combined with MetaMask ($5,000) + ENS ($1,500) + Self ($1,000) from other phases = **$33,000 grand total**.

---

## Risk Mitigation — Revised

| Risk | Mitigation |
|---|---|
| Venice rate limited (429) | Fallback to secondary model. If both fail, skip cycle. |
| EigenCompute TEE unavailable | Fall back to direct venice-analyze (unverified but functional). Agent logs "running unverified". |
| EigenCompute Docker build issues | Test Dockerfile locally first. Image is minimal (Node.js + venice-analyze only). |
| Locus API unreachable | check-budget returns canSpend=false. Agent uses cache for Olas data. Venice + Uniswap still work (free). |
| Olas Mech timeout (>120s) | 120s kill per request. Partial results OK. Agent notes shortfall. |
| Uniswap API rate limited (429) | Exponential backoff. Forward quote is most critical — if only 1/4 calls succeed, use that. Partial data is fine. |
| Uniswap API key invalid | Tool returns null. Agent proceeds with pool-reader on-chain data only. Venice gets less context but still functions. |
| All data sources fail simultaneously | Agent has cache. Venice works with pool state alone (confidence will be low). Worst case: skip cycle. |
| Budget exhausted mid-day | Only affects Olas (paid source). Venice + Uniswap are free. Agent shifts to minimal strategy automatically. |

---

## Files Changed Summary

**New files (Phase 4):**

| File | Purpose |
|---|---|
| `src/tools/check-budget.ts` | Locus wallet balance + spending controls |
| `src/tools/uniswap-data.ts` | Uniswap Trading API × 4 calls (price, spread, depth, approval) |
| `src/tools/olas-analyze.ts` | Olas Mech 10+ requests |
| `src/tools/venice-analyze.ts` | Venice AI inference (structured Uniswap data as input, web search off) |
| `src/tools/eigencompute.ts` | EigenCompute TEE wrapper |
| `src/lib/config.ts` | Env var loading + validation |
| `src/lib/cache.ts` | File-persisted cache with TTL |
| `src/lib/logger.ts` | Structured logging + payment log |
| `src/lib/types.ts` | Shared TypeScript interfaces |
| `Dockerfile` | EigenCompute deployment image |

**Removed files (vs original plan):**

| File | Reason |
|---|---|
| `src/tools/market-data.ts` | Merit/x402 bounty dropped. Venice web search replaces it. |

**Modified files:**

| File | Change |
|---|---|
| `workspace/SKILL.md` | Full Phase 4 decision framework (replaces Phase 3 heuristic) |
| `package.json` | Add openai, pino |
| `.env.example` | Add Venice, Locus, Uniswap, EigenCompute vars. Remove x402 vars. |