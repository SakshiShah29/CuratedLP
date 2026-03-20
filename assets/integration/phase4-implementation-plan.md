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
| `uniswap-quote.ts` | Single quote call (1 API call/cycle) | **EXPANDED → `uniswap-data.ts` (4 Uniswap API calls + DeFiLlama on-chain analytics per cycle)** |
| `eigencompute.ts` | Did not exist | **NEW — wraps Venice inference in a TEE** |
| Data pipeline | x402 endpoints for price/vol/sentiment | **Uniswap API × 4 calls for price/spread/depth + DeFiLlama for on-chain analytics + Venice web search for sentiment + Olas Mech for cross-checking** |
| Venice web search | Not used | **TWO-CALL PIPELINE — Call #1: web search ON for sentiment. Call #2: web search OFF for analysis with all structured data** |
| Bounty: Merit/x402 ($5,250) | Targeted | **DROPPED** |
| Bounty: EigenCloud ($5,000) | Not targeted | **NEW TARGET** |
| Uniswap API depth | 1 requestId per cycle | **4 requestIds per cycle (1,152+/day) + DeFiLlama analytics** |
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
       |     \-- large quote (price impact → liquidity depth)
       |     \-- check_approval (vault token approval status)
       |     \-- DeFiLlama on-chain analytics (TVL, yields, protocol flows)
       |   venice-sentiment -----> Venice AI API, web search ON (NEW, free)
       |     \-- "Summarize wstETH/USDC sentiment: social signals,
       |          governance news, whale movements, market mood"
       |     \-- Returns structured sentiment JSON
       |   venice-analyze -------> Venice AI API, web search OFF (NEW, free)
       |     \-- receives: pool state + uniswap data + DeFiLlama + sentiment
       |     \-- enable_web_search: "off" (has all data already)
       |     \-- wrapped in eigencompute for verifiability
       |   olas-analyze ---------> Olas Mech Marketplace (NEW, paid via Locus)
       |     \-- cross-checks Venice's recommendation
       |     \-- validates directional bias + confidence
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

**1. Uniswap Trading API + DeFiLlama (free, 4 API calls + analytics/cycle)**

The old `uniswap-quote` tool made a single quote call. The new
`uniswap-data` tool makes 4 Uniswap API calls per cycle plus DeFiLlama
on-chain analytics, extracting structured financial signals that are
far more useful than web-scraped prose:

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

  Call 5: DeFiLlama On-Chain Analytics (free, no API key)
  GET https://api.llama.fi/protocol/lido
  GET https://yields.llama.fi/chart/<pool-uuid>
  Returns: TVL, TVL change (24h/7d), yield data, protocol flows
  Signals:
    - TVL trending down → capital flight, widen range defensively
    - TVL spike → new deposits, tighter range may capture more fees
    - Yield comparison → is our pool competitive vs alternatives?
    - Protocol-level flows → Lido staking/unstaking trends
```

**Why structured data is better than web search for quant inputs:**

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

  DeFiLlama Analytics:
    Lido TVL: $14.2B (−1.3% 24h)
    wstETH/USDC pool yield: 4.2% APY
    Protocol flows: net −$180M outflow (7d)
```

Venice gets exact numbers and can reason precisely about spread width,
price impact, implied liquidity depth, and macro protocol trends.

**Every Uniswap call generates a requestId** logged to the submission
proof file. At 4 calls per cycle × 288 cycles per day = **1,152+
logged Uniswap API interactions** with real request IDs. This is an
extremely strong Uniswap bounty submission.

**2. Venice AI — Two-Call Sentiment + Analysis Pipeline (free)**

Venice serves two distinct roles in each heartbeat cycle:

**Call #1: Sentiment Gathering (`enable_web_search: "on"`)**

```
  venice-analyze --mode sentiment
  Prompt: "Summarize current sentiment for wstETH/USDC:
           social signals, governance news, whale movements,
           market mood. Return as structured JSON with fields:
           sentiment (bullish/bearish/neutral), confidence (0-1),
           signals (array of key observations)."
  Returns:
    {
      "sentiment": "moderately_bullish",
      "confidence": 0.72,
      "signals": [
        "Lido V3 governance vote passing with 94% approval",
        "Large wstETH accumulation on Aave over past 48h",
        "ETH gas fees at monthly low — favorable for LP rebalancing"
      ]
    }
```

This call uses Venice's web search capability to gather qualitative
signals that structured APIs cannot provide: social media sentiment,
governance developments, whale behavior patterns, and market narrative.

**Call #2: Analysis + Recommendation (`enable_web_search: "off"`)**

```
  venice-analyze --mode analyze
  Input: pool state + uniswap data + DeFiLlama analytics + sentiment from Call #1
  Returns:
    {
      "tickLower": -180, "tickUpper": 120,
      "fee": 3500, "confidence": 0.82,
      "reasoning": "Spread is tight, depth is good, sentiment is
       bullish with governance tailwinds — shift range slightly above
       current price. TVL outflow suggests caution, moderate fee."
    }
```

This call receives ALL structured data and the sentiment signal. With
every input already provided, web search is OFF — Venice focuses purely
on analysis and recommendation, not data gathering.

**Both calls run inside EigenCompute TEE**, so the attestation covers
the full pipeline: sentiment gathering → analysis → recommendation.
Non-deterministic web search results don't affect TEE consensus because
EigenCompute's mainnet alpha uses a single TEE instance (attestation
proves code integrity, not output reproducibility).

**3. Olas Mech Marketplace — Cross-Check Layer (paid, USDC via Locus)**

Olas Mech's role is to **validate Venice's recommendation**, not to
provide upstream data. After Venice produces a recommendation, the
agent sends it to Olas for independent cross-checking:

```
  olas-analyze --recommendation '<venice output JSON>'
  Olas validates:
    - Does Venice's directional bias align with Olas's own prediction?
    - Is Venice's confidence justified given market conditions?
    - Are the tick range and fee within reasonable bounds?
  Returns:
    {
      "agrees": true,
      "olasPrediction": { "direction": "up", "probability": 0.62 },
      "confidence": 0.68,
      "flags": [],
      "txHashes": ["0x...", "0x...", ...]
    }
```

If Olas disagrees with Venice (e.g., Venice says bullish but Olas
predicts down), the agent can reduce confidence, widen the tick range
defensively, or skip the rebalance entirely. This provides a safety
net against Venice hallucinations or stale web search data.

10+ Mech requests per cycle, paid from Locus wallet. All tx hashes
logged for submission proof.

**Data pipeline summary:**

```
  pool-reader (free, on-chain)
       |
       | Pool state: tick, liquidity, fee, volume, idle balances
       v
  uniswap-data (free, 4 Uniswap API calls + DeFiLlama)
       |
       | Price: $3,412.50, Spread: 0.08%
       | Price impact at 10x: 0.12%, Approval: active
       | Lido TVL: $14.2B (−1.3%), Pool yield: 4.2% APY
       | 4 requestIds logged
       v
  venice-sentiment (free, Venice web search ON)
       |
       | Sentiment: moderately bullish (0.72 confidence)
       | Signals: governance vote, whale accumulation, low gas
       v
  venice-analyze (free, Venice web search OFF)
       |
       | Input: pool state + uniswap data + DeFiLlama + sentiment
       | Recommendation: tick [-180, 120], fee 3500, confidence 0.82
       | Reasoning: "Spread is tight, depth good, bullish sentiment
       |  with governance tailwinds, TVL outflow suggests caution"
       v
  eigencompute (TEE wrapper — covers both Venice calls)
       |
       | Same recommendation + attestation hash proving verifiable compute
       v
  olas-analyze (paid via Locus, cross-checks Venice recommendation)
       |
       | Agrees: yes, Olas prediction: 62% up
       | Flags: none
       | 10+ tx hashes logged
       v
  Agent DECIDES → execute-rebalance or skip
```

---

## What Is EigenCompute and How Does It Fit?

EigenCompute is EigenLayer's verifiable compute service. You deploy a
Docker image that runs inside a Trusted Execution Environment (TEE).
The TEE produces a cryptographic attestation proving that the code
ran unmodified inside the enclave.

**For CuratedLP, EigenCompute wraps the entire Venice pipeline
(both sentiment and analysis calls).**

Instead of the agent calling Venice directly, both Venice calls
run inside an EigenCompute TEE. The result: every rebalance
recommendation is verifiably computed — you can prove the AI actually
gathered sentiment, analyzed the data, and produced the recommendation
with no tampering at any stage.

```
  WITHOUT EigenCompute:
  Agent → Venice (sentiment) → Venice (analyze) → recommendation
  (trust the agent's claim at every step)

  WITH EigenCompute:
  Agent → EigenCompute TEE → Venice (sentiment) → Venice (analyze)
       → recommendation + single attestation hash
  (cryptographic proof the full pipeline ran correctly)
```

Running both calls inside the TEE is important: if only the analysis
call were verified, an attacker could fake bearish sentiment input to
manipulate Venice into a bad recommendation. Wrapping both calls means
the attestation covers: sentiment gathered → data assembled → analysis
produced → recommendation output. No tampering possible at any stage.

Non-deterministic web search results from the sentiment call do not
affect TEE consensus. EigenCompute's mainnet alpha uses a single TEE
instance — the attestation proves the code (Docker digest) ran
unmodified inside Intel TDX, not that outputs are reproducible. This
is inherent to any live data source and is perfectly acceptable.

**Why this matters for the project narrative:**

LPs currently trust the curator agent to honestly relay Venice's
recommendations. With EigenCompute, they don't need to trust —
they can verify. The TEE attestation proves:
- Venice's web search was actually executed for sentiment (not fabricated)
- The pool state and market data were actually passed (not manipulated)
- The recommendation was not altered after Venice returned it
- The same Docker image (by digest) produced the result every time

**EigenCloud bounty requirements (all achievable):**

| Requirement | How We Satisfy It |
|---|---|
| Working Docker image on EigenCompute | Dockerfile that runs both Venice calls (sentiment + analysis) inside TEE |
| GitHub repo with README + setup instructions | Already needed for Uniswap bounty |
| Live demo or recorded demo (2-5 mins) | Part of our hackathon demo |
| Architecture diagram showing EigenCompute fit | Agent → EigenCompute TEE → Venice (sentiment) → Venice (analyze) → on-chain action |
| Supported stack: Node.js inside TEE | Our tools are already Node.js/TypeScript |

---

## The eigencompute.ts Tool

**Purpose:** Run the full Venice AI pipeline (sentiment + analysis)
inside an EigenCompute TEE, producing a verifiable attestation
alongside the recommendation.

**Input:** Pool state JSON (required), Uniswap data JSON (required),
DeFiLlama analytics JSON (required).

**Output fields:** Everything from venice-analyze PLUS:
sentiment (from Call #1), attestationHash, teeProvider, computeJobId,
verifiable (boolean).

**Implementation approach:**

Option A — Full TEE deployment (ideal):

```
  1. Package venice-analyze.ts logic (both sentiment + analysis modes)
     into a single Docker image
  2. Deploy to EigenCompute via their CLI/API
  3. eigencompute.ts triggers the compute job with input data
  4. EigenCompute TEE runs:
     a. Venice Call #1 (web search ON) → sentiment JSON
     b. Venice Call #2 (web search OFF, all data + sentiment) → recommendation
  5. Returns recommendation + sentiment + single attestation hash
  6. Agent passes recommendation to Olas for cross-checking
```

The Dockerfile is defined in Step 6 below. See that section for the
full `Dockerfile` with EigenCompute TEE requirements (`--platform=linux/amd64`,
`USER root`, `EXPOSE 3000`, `npm ci`, etc.).

Option B — Attestation wrapper (fallback if TEE setup is complex):

```
  1. eigencompute.ts calls venice-analyze locally (both modes)
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
| Decision intelligence | Simple heuristic (idle balance proxy) | Venice AI two-call pipeline (sentiment + analysis) with structured data + Olas cross-checks |
| Data sources | On-chain only (pool-reader) | On-chain + Uniswap API × 4 + DeFiLlama analytics + Venice web search sentiment + Olas cross-check |
| Market data quality | None | Exact prices, bid/ask spread, price impact, TVL/yield analytics, social sentiment — structured JSON |
| Sentiment | None | Venice web search (Call #1) gathers social signals, governance news, whale movements |
| On-chain analytics | None | DeFiLlama (TVL, yields, protocol flows) integrated into uniswap-data tool |
| Spending | None | Locus wallet pays for Olas Mech (USDC) |
| Verifiability | Trust the agent | EigenCompute TEE attestation on both Venice calls (sentiment + analysis) |
| SKILL.md | Simple guidelines | Full autonomous framework with budget-adaptive strategy |
| Tools | 3 (pool-reader, execute-rebalance, claim-fees) | 8 (add check-budget, uniswap-data, olas-analyze, venice-analyze, eigencompute) |
| Uniswap API calls/cycle | 0 | 4 (forward quote, reverse quote, large quote, check approval) + DeFiLlama |
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
  +----+----+
  |         |
  v         v
 check    uniswap-data              venice-analyze
 budget   (Uniswap API ×4           (two-call pipeline:
          + DeFiLlama)               sentiment + analysis)
                                          |
                                          | (olas needs Venice output shape)
                                          v
                                     olas-analyze
                                     (cross-checks Venice)
                                          |
                                          | (eigencompute wraps venice-analyze)
                                          v
                                     eigencompute
                                          |
                                          v
                                     Dockerfile + deploy

  Steps 2, 3, and 4 can all be built in parallel.
  Step 5 depends on Step 4 (needs Venice output shape to cross-check).
  Step 6 depends on Step 4 (wraps Venice pipeline in TEE).
  Steps 5 and 6 can be built in parallel (both depend on 4, not each other).

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
| 3 | uniswap-data (Trading API × 4 calls + DeFiLlama analytics) | Step 1 | Uniswap ($5,000) |
| 4 | venice-analyze (two-call pipeline: sentiment + analysis) | Step 1 | Venice ($11,500) |
| 5 | olas-analyze (Mech cross-check of Venice recommendation) | Steps 1, 4 | Olas ($1,000) |
| 6 | eigencompute (TEE wrapper for both Venice calls) | Steps 1, 4 | EigenCloud ($5,000) |
| 7 | Dockerfile + EigenCompute deploy | Step 6 | EigenCloud ($5,000) |
| 8 | Update SKILL.md | Steps 2-6 | — |
| 9 | End-to-end test | All | All |

Steps 2, 3, and 4 can all be built in parallel — they have no
dependencies on each other. Steps 5 and 6 both depend on Step 4
(Venice output shape) but NOT on each other, so they can also be
built in parallel once Step 4 is done. Step 7 is the Docker
packaging for the EigenCloud bounty.

**Dependency graph:**

```
  Step 1 (foundation)
    |
    +--→ Step 2 (check-budget)  ──────────────────────┐
    +--→ Step 3 (uniswap-data + DeFiLlama)  ─────────┤
    +--→ Step 4 (venice-analyze)                      |
              |                                       |
              +--→ Step 5 (olas-analyze)  ────────────┤
              +--→ Step 6 (eigencompute)              |
                       |                              |
                       +--→ Step 7 (Dockerfile) ─────┤
                                                      |
                                                      v
                                              Step 8 (SKILL.md)
                                                      |
                                                      v
                                              Step 9 (e2e test)
```

---

## Two-Person Parallel Work Division

### Shared Setup (Step 1)

Both people build Step 1 (foundation libs) together. Agree on the JSON
output contracts in types.ts before diverging — each tool's output
shape must match what the SKILL.md documents.

Key interfaces to agree on:
- `UniswapDataResult` (Person B produces, consumes in Venice Call #2)
- `SentimentResult` (Person B produces in Venice Call #1, consumes in Call #2)
- `RebalanceRecommendation` (Person B produces from Venice Call #2, Person A consumes in Olas cross-check)
- `OlasCrossCheckResult` (Person A produces from Olas)
- `EigenComputeResult` (Person B produces, extends RebalanceRecommendation)

### Person A — OBSERVE + Paid ANALYZE (Steps 2, 5)

| Tool | Notes |
|---|---|
| check-budget | OBSERVE phase. Small, quick. Unblocks budget-adaptive reasoning. Covers Locus wallet integration. |
| olas-analyze | CROSS-CHECK phase. Validates Venice's recommendation. Paid via Locus. Covers the entire Locus wallet + Olas data layer integration. Tests with hardcoded Venice recommendation JSON until Person B's venice-analyze is ready. |

### Person B — Free ANALYZE + Intelligence + Verifiability (Steps 3, 4, 6, 7)

| Tool | Notes |
|---|---|
| uniswap-data | ANALYZE phase. Free, 4 Uniswap API calls + DeFiLlama analytics. Independent of Person A. |
| venice-analyze | ANALYZE phase. Two-call pipeline: Call #1 sentiment (web search ON), Call #2 analysis (web search OFF). No cross-person dependency — consumes uniswap-data (own tool) + own sentiment output. |
| eigencompute | Wraps both Venice calls in TEE. Build after venice-analyze. |
| Dockerfile | EigenCloud bounty deliverable. Packages venice-analyze (both modes). Comes after eigencompute. |

### Why there's zero cross-person blocking

```
  Person A                          Person B
  +--------------------------+      +--------------------------+
  |                          |      |                          |
  | check-budget             |      | uniswap-data             |
  |   (Locus wallet)         |      |   (Uniswap API ×4       |
  | olas-analyze             |      |    + DeFiLlama)          |
  |   (cross-checks Venice,  |      | venice-analyze            |
  |    paid via Locus)        |      |   Call #1: sentiment      |
  |                          |      |   Call #2: analysis       |
  | 2 tools                  |      |                          |
  | (Locus + Olas layer)     |      | Then:                    |
  |                          |      |   eigencompute           |
  |                          |      |   Dockerfile + deploy    |
  |                          |      |                          |
  |                          |      | 4 deliverables           |
  +--------------------------+      +--------------------------+
           |                                 |
           +----------------+----------------+
                            |
                            v
               Update SKILL.md together
               Integration test together
```

Person A never waits on Person B. Person B never waits on Person A.
Person A tests olas-analyze with hardcoded Venice recommendation JSON
until Person B's venice-analyze is ready. Person B has no cross-person
dependency — venice-analyze consumes uniswap-data (Person B's own tool)
and its own sentiment output. Both work fine in isolation.

Person A owns the entire Locus wallet + Olas integration — budget
checking and paid cross-check calls. Person B owns the entire data
pipeline (Uniswap + DeFiLlama), intelligence layer (Venice two-call),
and verifiability layer (EigenCompute).

### How Each Person Tests Their Tools

**Person A testing (check-budget, olas-analyze):**

| Tool | Standalone test | OpenClaw test |
|---|---|---|
| check-budget | Run `bun run src/tools/check-budget.ts`. Confirm balance and canSpend fields returned. | Add to SKILL.md OBSERVE phase. Run heartbeat. Verify agent reads budget and references it in reasoning ("Budget is $4.20, can afford Olas"). |
| olas-analyze | Run `bun run src/tools/olas-analyze.ts --recommendation '<hardcoded venice output>'`. Confirm agrees/disagrees, own prediction, flags, 10+ tx hashes in payment-log.json. | Add to SKILL.md CROSS-CHECK phase. Run heartbeat. Verify agent sends Venice recommendation to Olas for cross-check. If Olas disagrees, verify agent adjusts (widens range, skips rebalance). If budget is low, verify agent skips Olas and explains why. |

Person A validates budget-adaptive behavior: run a heartbeat with full
budget (agent cross-checks via Olas), then drain the Locus wallet and
run another heartbeat (agent skips Olas, proceeds with Venice
recommendation unverified). Two different decisions from the same agent
proves autonomous reasoning.

**Person B testing (uniswap-data, venice-analyze, eigencompute):**

| Tool | Standalone test | OpenClaw test |
|---|---|---|
| uniswap-data | Run `bun run src/tools/uniswap-data.ts`. Confirm forwardPrice, spread, priceImpact, 4 requestIds, and DeFiLlama TVL/yield data. | Add to SKILL.md ANALYZE phase. Run heartbeat. Verify agent references specific numbers: "Spread is 8 bps, depth is moderate, Lido TVL down 1.3%." |
| venice-analyze (sentiment) | Run `bun run src/tools/venice-analyze.ts --mode sentiment`. Confirm sentiment, confidence, signals array returned. Web search must be ON. | Add to SKILL.md ANALYZE phase. Run heartbeat. Verify agent gathers sentiment before analysis call. |
| venice-analyze (analysis) | Run `bun run src/tools/venice-analyze.ts --mode analyze --pool '<json>' --uniswap '<json>' --sentiment '<json>'`. Confirm tick/fee/confidence recommendation. Web search must be OFF. | Run heartbeat. Verify agent passes sentiment + uniswap data + DeFiLlama to Venice. Verify Venice references sentiment in reasoning. |
| eigencompute | Build Docker image. Run `docker run --platform linux/amd64 curatedlp/venice-analyzer --pool '<json>' --uniswap '<json>'`. Deploy to EigenCompute, verify attestation hash covers both Venice calls. | Add to SKILL.md as wrapper for venice-analyze. Run heartbeat. Verify agent uses eigencompute, logs attestation hash in REFLECT. |

Person B validates the full intelligence pipeline: run a heartbeat where
Venice recommends a meaningful change (agent rebalances), then run
another where Venice has low confidence (agent skips). Verify Venice
references the exact spread and depth numbers from uniswap-data in
its reasoning, not generic language.

### What neither person can test alone

The full pipeline where Venice output (Person B) feeds into
olas-analyze (Person A) for cross-checking. This only works when
both merge:

```
  pool-reader (existing)
       +
  check-budget (Person A)         — Locus wallet balance
       +
  uniswap-data (Person B)         — price/spread/depth + DeFiLlama analytics
       |
       +--- feeds into --->
       |
  venice-sentiment (Person B)     — web search ON, social/governance signals
       +
  venice-analyze (Person B)       — all data + sentiment → recommendation
       |
  eigencompute (Person B)         — TEE attestation on both Venice calls
       |
       +--- feeds into --->
       |
  olas-analyze (Person A)         — cross-checks Venice recommendation
       |
  execute-rebalance (existing)    — on-chain action
```

Until that merge point, each person tests their tools with hardcoded
data standing in for the other person's output. After both merge,
they run the full incremental OpenClaw integration test together
(Phase 4a → 4b → 4c → 4d → 4e) and the end-to-end verification.

### Integration (Both — Steps 8, 9)

| Step | What | Blocked by |
|---|---|---|
| 8 | Update SKILL.md (final review) | All tools from both people pass isolation tests |
| 9 | End-to-end OpenClaw integration test | Step 8 |

Done together once both tracks are merged.

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
  sentiment: SentimentResult;   // from Venice Call #1 (web search ON)
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
  > $1.00 (comfortable)   FULL: uniswap + DeFiLlama + venice (sentiment + analysis) + olas cross-check
  $0.01 - $1.00 (low)     FREE-ONLY: uniswap + DeFiLlama + venice (sentiment + analysis), skip Olas
  $0.00 (empty)            FREE-ONLY + CACHE: same as above, use cached Olas cross-check if available
```

Venice API calls and Uniswap API calls are free (covered by API keys).
Only Olas Mech requests cost USDC. This means the Locus wallet needs
less funding — $5-10 USDC covers the entire hackathon instead of $10+.

---

### Step 3: uniswap-data Tool (expanded from uniswap-quote + DeFiLlama)

**Purpose:** Extract structured market signals from the Uniswap Trading
API via multiple quote calls, and on-chain analytics from DeFiLlama.
This is the agent's primary source of real-time, precise financial and
macro protocol data.

**Input:** None (reads UNISWAP_API_KEY from env vars). DeFiLlama
requires no API key.

**Output fields:** forwardPrice, reversePrice, spread, spreadBps,
priceImpact10x, priceImpactBps, gasEstimate, approvalActive,
requestIds (array of 4), defiLlama (object with TVL, tvlChange24h,
tvlChange7d, poolYield, protocolFlows), timestamp.

**Implementation:**

Five parallel API calls using Promise.allSettled — 4 Uniswap + 1
DeFiLlama batch:

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

// Call 5: DeFiLlama on-chain analytics (free, no API key)
const [lidoProtocol, poolYields] = await Promise.allSettled([
  fetch('https://api.llama.fi/protocol/lido').then(r => r.json()),
  fetch('https://yields.llama.fi/chart/<wsteth-usdc-pool-uuid>').then(r => r.json()),
]);
```

**DeFiLlama derived signals:**

```typescript
// From protocol endpoint
const currentTvl = lidoProtocol.tvl[lidoProtocol.tvl.length - 1].totalLiquidityUSD;
const prevTvl24h = lidoProtocol.tvl[lidoProtocol.tvl.length - 2].totalLiquidityUSD;
const prevTvl7d = lidoProtocol.tvl[lidoProtocol.tvl.length - 8].totalLiquidityUSD;
const tvlChange24h = ((currentTvl - prevTvl24h) / prevTvl24h) * 100;
const tvlChange7d = ((currentTvl - prevTvl7d) / prevTvl7d) * 100;

// From yields endpoint
const latestYield = poolYields.data[poolYields.data.length - 1];
const poolYield = latestYield.apy;
```

**Uniswap derived signals (computed from raw quotes):**

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

| Signal | Source | Meaning | Agent Action |
|---|---|---|---|
| `spread` | Uniswap | Bid/ask width, proxy for short-term volatility | Wide spread → widen tick range, raise fee |
| `spreadBps` | Uniswap | Spread in basis points, comparable across price levels | >50 bps = volatile, <10 bps = calm |
| `priceImpact10x` | Uniswap | How much price moves at 10x trade size | High impact → shallow depth → widen range |
| `priceImpactBps` | Uniswap | Impact in bps, directly informs fee setting | Impact > fee → fee is too low |
| `gasEstimate` | Uniswap | Current gas cost for a swap | Informs whether rebalance tx is worth it |
| `approvalActive` | Uniswap | Whether Permit2 approval is live | False → alert, may block execution |
| `tvl` | DeFiLlama | Lido protocol TVL | Macro health of the underlying protocol |
| `tvlChange24h` | DeFiLlama | TVL trend (24h) | Negative → capital flight, widen range defensively |
| `tvlChange7d` | DeFiLlama | TVL trend (7d) | Sustained decline → reduce confidence |
| `poolYield` | DeFiLlama | Current pool APY | Competitive context — is our pool attractive? |

**Rate limiting:** Uniswap Trading API has rate limits. All 4 calls
use the same API key. If any call returns 429, back off exponentially.
DeFiLlama has no rate limits for reasonable usage. Partial results are
fine — forward quote alone is sufficient minimum.

**Failure mode:** Returns whatever succeeded. If forward quote fails
(the most critical), returns null. Agent proceeds with pool-reader
data only and tells Venice "Uniswap data unavailable." DeFiLlama
failure is non-critical — agent proceeds without macro data.

**SKILL.md update:** Replace `uniswap-quote` with `uniswap-data` in
Available Tools. Document all output fields including DeFiLlama
analytics and what they mean. In the ANALYZE phase, uniswap-data is
always invoked first (free, highest value per call). Venice receives
the full output as structured input.

**Verification:**

Standalone: Run `bun run src/tools/uniswap-data.ts` with a real API
key. Confirm JSON output with all fields populated: forwardPrice,
reversePrice, spread, spreadBps, priceImpact10x, priceImpactBps,
gasEstimate, approvalActive, 4 requestIds, and defiLlama object with
tvl, tvlChange24h, tvlChange7d, poolYield. Log all requestIds to
payment-log.json (these are Uniswap bounty proof). Verify that
spread and priceImpact values are sensible (spread < 1% for a liquid
pair, price impact < 5%). Verify DeFiLlama TVL is a reasonable number
(Lido TVL should be in the billions).

OpenClaw: Run one heartbeat. Verify the agent invokes uniswap-data
and includes ALL derived signals (Uniswap + DeFiLlama) in the data it
passes to Venice. Verify the agent references specific numbers in its
reasoning: "Spread is 0.08% (healthy), price impact at 10x is 0.12%
(moderate depth), Lido TVL down 1.3% — conditions favor a slightly
wider range." Verify 4 requestIds logged per cycle.

---

### Step 4: venice-analyze Tool (Two-Call Pipeline)

**Significantly updated — now runs a two-call pipeline: sentiment
gathering (web search ON) followed by analysis (web search OFF).**

Venice serves two distinct roles in each heartbeat cycle. The sentiment
call provides the directional/qualitative input that structured APIs
cannot. The analysis call uses all data (structured + sentiment) to
produce the recommendation. Olas then cross-checks the output.

**Modes:** The tool accepts a `--mode` flag: `sentiment` or `analyze`.

---

**Call #1: Sentiment (`--mode sentiment`, `enable_web_search: "on"`)**

**Input:** None (Venice searches the web autonomously).

**Output fields:** sentiment (bullish/bearish/neutral), confidence
(0 to 1), signals (array of key observations), timestamp.

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

Venice-specific parameters:
- `include_venice_system_prompt: false`
- **`enable_web_search: "on"`** (this is the whole point of Call #1)
- `strip_thinking_response: false`

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

---

**Call #2: Analysis (`--mode analyze`, `enable_web_search: "off"`)**

**Input:** Pool state JSON (required), Uniswap data JSON with DeFiLlama
(required), Sentiment JSON from Call #1 (required). Any non-pool input
can be omitted if that data source was unavailable. Venice works with
whatever is provided.

**Output fields:** newTickLower, newTickUpper, newFee, confidence
(0 to 1), reasoning (text), dataSources (list), missingData (list),
model (which Venice model was used).

**Implementation:** Uses openai SDK pointing at Venice API. System
prompt defines the agent's role and output format. Function calling
forces structured output. Response validated (ticks divisible by 60,
fee in range, confidence 0-1). Fallback to secondary model on 429/500.

**System prompt:**

```
You are an AI agent managing concentrated liquidity for a wstETH/USDC
pool on Uniswap v4 on Base.

You will receive:
1. Structured market data from the Uniswap Trading API (price, spread, depth)
2. On-chain analytics from DeFiLlama (TVL, yields, protocol flows)
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

**User message per-cycle (structured, not prose):**

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

DeFiLlama on-chain analytics:
  Lido TVL: $14.2B (−1.3% 24h, −0.8% 7d)
  wstETH/USDC pool yield: 4.2% APY
  Protocol flows: net −$180M outflow (7d)

Sentiment (from Venice web search):
  Overall: moderately bullish (confidence 0.72)
  Signals:
    - Lido V3 governance vote passing with 94% approval
    - Large wstETH accumulation on Aave over past 48h
    - ETH gas fees at monthly low

Recommend optimal parameters.
```

Venice-specific parameters:
- `include_venice_system_prompt: false` (use only our prompt)
- **`enable_web_search: "off"`** (all data already provided)
- `strip_thinking_response: false` (preserve reasoning for audit)

**Both calls run inside EigenCompute TEE** (see Step 6). The
attestation covers the full pipeline: sentiment gathered → data
assembled → analysis produced → recommendation output.

**Failure mode:** If sentiment call fails, proceed with analysis
using structured data only (Venice notes "sentiment unavailable" in
reasoning). If analysis call fails, return null — agent skips the
cycle.

**SKILL.md update:** Add venice-analyze to Available Tools with both
modes documented. In the ANALYZE phase, venice-analyze sentiment is
invoked first, then venice-analyze analysis receives all structured
data + sentiment. Replace Phase 3 heuristic with Venice-driven
reasoning. Update error handling.

---

### Step 5: olas-analyze Tool (Cross-Check Layer)

**Updated from original — Olas now cross-checks Venice's recommendation
rather than providing upstream data to Venice.**

Olas Mech's role is to independently validate Venice's output. After
Venice produces a recommendation (tick range, fee, confidence), the
agent sends it to Olas for cross-checking. This provides a safety net
against Venice hallucinations or stale web search data.

**Input:** Venice recommendation JSON (required), pool state JSON
(required).

**Output fields:** agrees (boolean), olasPrediction (direction,
probability), confidence (0 to 1), flags (array of concerns),
txHashes (array of Mech tx hashes).

**Implementation:** Shells out to mechx CLI for 10+ parallel Mech
requests. 120-second timeout per request. Payment via Locus wallet
(USDC on Base).

The 10 required requests now focus on validating Venice's output:
- Price direction prediction (does it match Venice's directional bias?)
- Volatility estimate (does it justify Venice's tick range width?)
- Independent tick range suggestion (how far from Venice's range?)
- Independent fee suggestion (how far from Venice's fee?)
- Confidence cross-check (is Venice overconfident or underconfident?)

**Example output:**

```json
{
  "agrees": true,
  "olasPrediction": { "direction": "up", "probability": 0.62 },
  "confidence": 0.68,
  "flags": [],
  "txHashes": ["0x...", "0x...", "0x..."]
}
```

**What happens when Olas disagrees:**

| Scenario | Agent Action |
|---|---|
| Olas agrees with Venice | Proceed with Venice recommendation at full confidence |
| Olas partially disagrees (direction matches, magnitude differs) | Reduce confidence, proceed with caution |
| Olas strongly disagrees (opposite direction) | Widen tick range defensively, or skip rebalance entirely |
| Olas unavailable (budget too low or timeout) | Proceed with Venice recommendation, note "unverified" in logs |

**Budget-adaptive:** Olas is the only paid data source. If Locus
budget is low, agent skips Olas and proceeds with Venice recommendation
unverified. The agent logs this decision for transparency.

**Verification:**

Standalone: Run `bun run src/tools/olas-analyze.ts --recommendation
'<venice output>'`. Confirm agrees/disagrees, own prediction, flags,
10+ tx hashes in payment-log.json.

OpenClaw: Run heartbeat. Verify agent sends Venice recommendation to
Olas AFTER Venice analysis completes. If Olas disagrees, verify agent
adjusts behavior (widens range, reduces confidence, or skips). If
budget is low, verify agent skips Olas and explains why.

### Step 6: eigencompute Tool

**NEW tool — does not exist in the original plan.**

**Purpose:** Run the full Venice AI pipeline (sentiment + analysis)
inside an EigenCompute TEE, producing a verifiable attestation that
both the sentiment gathering and the recommendation were computed
honestly with no tampering.

**Input:** Pool state JSON (required), Uniswap data JSON with
DeFiLlama (required).

**Output:** Sentiment (from Call #1) + recommendation (from Call #2)
+ attestation fields: attestationHash, teeProvider, computeJobId,
verifiable (boolean).

**Implementation:**

```typescript
// eigencompute.ts — simplified flow

import { execSync } from 'child_process';

export async function runVerifiableInference(input: EigenComputeInput): Promise<EigenComputeResult> {
  // 1. Serialize input to JSON file (pool state + uniswap data + DeFiLlama)
  const inputPath = writeInputFile(input);

  // 2. Submit to EigenCompute
  //    This runs our Docker image inside the TEE
  //    The image runs BOTH Venice calls sequentially:
  //      Call #1: sentiment (web search ON)
  //      Call #2: analysis (web search OFF, uses sentiment + all data)
  const jobId = submitEigenComputeJob({
    image: 'curatedlp/venice-analyzer:latest',
    input: inputPath,
    env: {
      VENICE_API_KEY: process.env.VENICE_API_KEY,
    },
  });

  // 3. Wait for completion (poll or webhook)
  //    Timeout is longer than single-call — two Venice API round-trips
  const result = await waitForCompletion(jobId, { timeout: 90_000 });

  // 4. Return sentiment + recommendation + attestation
  return {
    sentiment: result.output.sentiment,    // from Call #1
    ...result.output.recommendation,       // newTickLower, newTickUpper, newFee, etc.
    attestationHash: result.attestation.hash,
    teeProvider: 'eigencompute',
    computeJobId: jobId,
    verifiable: true,
  };
}
```

**The Dockerfile** (Step 7):

```dockerfile
FROM --platform=linux/amd64 node:20-slim
USER root
WORKDIR /app

# Copy only what's needed for Venice inference pipeline
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --production

COPY src/tools/venice-analyze.ts ./src/tools/
COPY src/lib/ ./src/lib/

# Build
RUN npx tsc

# Expose port for HTTP trigger from agent
EXPOSE 3000

# Entry point: runs both Venice calls (sentiment + analysis)
# Takes pool state + uniswap data as input, returns sentiment +
# recommendation JSON on stdout
ENTRYPOINT ["node", "dist/tools/venice-analyze.js"]
```

Note: `--platform=linux/amd64` and `USER root` are required by
EigenCompute's TEE environment. Port 3000 is exposed so the agent
can trigger the compute job via HTTP. The app must bind to `0.0.0.0`.

This image contains only the Venice inference logic — no private keys,
no delegation code, no execution tools. It reads VENICE_API_KEY from
the environment (injected securely by EigenCompute KMS at runtime,
encrypted within the TEE) and produces sentiment + recommendation
JSON on stdout.

The TEE attestation covers the full pipeline: Venice web search for
sentiment (Call #1) → analysis with all structured data + sentiment
(Call #2) → recommendation output. Non-deterministic web search
results from Call #1 do not affect TEE consensus — EigenCompute's
mainnet alpha uses a single TEE instance proving code integrity,
not output reproducibility.

**EigenCompute deployment steps:**

1. Build and push Docker image: `docker build --platform linux/amd64 -t curatedlp/venice-analyzer .`
2. Install ecloud CLI: `npm install -g @layr-labs/ecloud-cli`
3. Auth: `ecloud auth login` (or `ecloud auth generate --store`)
4. Deploy: `ecloud compute app deploy` (select "Build and deploy from Dockerfile")
5. Test: submit a job with sample pool state + uniswap data, verify
   attestation returned and both sentiment + recommendation present
6. Integrate into eigencompute.ts tool

**SKILL.md update:** Add eigencompute to Available Tools. In the ANALYZE
phase, the agent uses eigencompute instead of venice-analyze directly
when verifiability is desired. The tool has the same output format
plus sentiment and attestation fields. If EigenCompute is down, fall
back to direct venice-analyze (unverified but functional).

---

### Step 7: Dockerfile + EigenCompute Deployment

This is the EigenCloud bounty deliverable. The required artifacts:

1. **Dockerfile** — packages venice-analyze (both modes) into a TEE-compatible image
2. **Docker image deployed on EigenCompute** — running and verifiable
3. **Architecture diagram** — showing how EigenCompute fits in the stack:

```
  OpenClaw Agent (reasoning)
       |
       | ANALYZE phase
       v
  eigencompute.ts (tool)
       |
       | submits job with pool state + uniswap data + DeFiLlama
       v
  +-----------------------------------------------+
  |  EigenCompute TEE (Intel TDX)                  |
  |                                                |
  |  Docker: curatedlp/venice-analyzer             |
  |    |                                           |
  |    | VENICE_API_KEY injected via TEE KMS       |
  |    |                                           |
  |    v                                           |
  |  Venice Call #1 (web search ON)                |
  |    → sentiment: bullish/bearish/neutral        |
  |    → signals: governance, whales, social       |
  |    |                                           |
  |    v                                           |
  |  Venice Call #2 (web search OFF)               |
  |    → input: pool + uniswap + DeFiLlama         |
  |             + sentiment from Call #1            |
  |    → output: tick range + fee + confidence      |
  |    |                                           |
  |    v                                           |
  |  sentiment + recommendation JSON               |
  |    + single TEE attestation hash               |
  +-----------------------------------------------+
       |
       | sentiment + recommendation + attestation
       v
  OpenClaw Agent
       |
       | passes recommendation to Olas for cross-check
       v
  olas-analyze (validates Venice output)
       |
       | DECIDE: use verified + cross-checked recommendation
       v
  execute-rebalance → on-chain
```

4. **GitHub repo with README** — includes EigenCompute setup instructions
5. **Live demo** — show the attestation hash in the agent's logs during
   the rebalance flow. "This recommendation was computed inside a TEE —
   here's the attestation proving both sentiment gathering and analysis."

---

### Step 8: Update SKILL.md

Each step above includes its own SKILL.md update. By the time all
tools are built, the SKILL.md should be the full Phase 4 version.

Final review checklist:
- All 8 tools listed in Available Tools with correct invocation + output
- Heartbeat protocol: OBSERVE (pool-reader + check-budget) → REASON →
  ANALYZE (uniswap-data + eigencompute/venice-analyze [sentiment → analysis]
  → olas-analyze [cross-check]) → DECIDE → ACT → REFLECT
- Data flow: uniswap-data (price/spread/depth + DeFiLlama TVL/yields) →
  Venice sentiment (web search ON) → Venice analysis (all data, web search OFF)
  → Olas cross-check → Agent decides
- Decision Guidelines: budget-adaptive strategy, Venice-driven reasoning,
  Olas cross-check as safety net
- No remnants of x402/AgentCash/market-data tool
- EigenCompute documented as TEE wrapper for both Venice calls (sentiment + analysis)
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
| uniswap-data | `bun run src/tools/uniswap-data.ts` | Returns forwardPrice, spread, priceImpact, 4 requestIds + DeFiLlama TVL/yields |
| venice-analyze (sentiment) | `bun run src/tools/venice-analyze.ts --mode sentiment` | Returns sentiment, confidence, signals array (web search ON) |
| venice-analyze (analysis) | `bun run src/tools/venice-analyze.ts --mode analyze --pool '...' --uniswap '...' --sentiment '...'` | Returns recommendation with valid ticks, confidence, reasoning (web search OFF) |
| olas-analyze | `bun run src/tools/olas-analyze.ts --recommendation '<venice output>'` | Returns agrees/disagrees, own prediction, flags, 10+ tx hashes |
| eigencompute | `bun run src/tools/eigencompute.ts --pool '...' --uniswap '...'` | Returns sentiment + recommendation + attestationHash + verifiable=true |

### Incremental OpenClaw integration

```
  Phase 3 base (already working)
       |
       | Add check-budget
       | Verify: agent reads budget, adapts data strategy
       v
  Phase 4a: budget awareness
       |
       | Add uniswap-data (4 Uniswap API calls + DeFiLlama)
       | Verify: agent fetches price + spread + depth + TVL, includes in reasoning
       | Verify: 4 requestIds logged per cycle
       v
  Phase 4b: + structured price data + on-chain analytics
       |
       | Add venice-analyze (two-call pipeline)
       | Verify: Call #1 gathers sentiment (web search ON)
       | Verify: Call #2 receives uniswap data + DeFiLlama + sentiment (web search OFF)
       | Verify: Venice references specific spread, depth, TVL, sentiment in reasoning
       | Verify: agent reasons about confidence, acts or skips
       v
  Phase 4c: + Venice intelligence (sentiment + analysis)
       |
       | Add olas-analyze (cross-checks Venice output)
       | Verify: agent sends Venice recommendation to Olas for validation
       | Verify: if Olas disagrees, agent adjusts (widens range, skips)
       | Verify: payment-log.json has Olas tx hashes
       v
  Phase 4d: + Olas cross-check
       |
       | Add eigencompute (wraps both Venice calls in TEE)
       | Verify: both Venice calls run inside TEE, single attestation returned
       | Verify: agent logs attestation hash in REFLECT
       v
  Phase 4e: + verifiable compute
       |
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
- [ ] uniswap-data returns forwardPrice, spread, priceImpact, 4 requestIds + DeFiLlama TVL/yields
- [ ] Agent derives spread, depth, and macro signals from quote comparison + DeFiLlama
- [ ] venice-analyze Call #1 returns sentiment with confidence + signals (web search ON)
- [ ] venice-analyze Call #2 returns recommendation with confidence + reasoning (web search OFF)
- [ ] Venice references specific Uniswap numbers + DeFiLlama + sentiment in reasoning (not generic)
- [ ] eigencompute returns attestation hash covering both Venice calls (verifiable=true)
- [ ] olas-analyze receives Venice recommendation and cross-checks it
- [ ] olas-analyze returns agrees/disagrees, own prediction, flags, 10+ tx hashes
- [ ] Agent adjusts when Olas disagrees (widens range, reduces confidence, or skips)

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
| Venice AI | $11,500 | venice-analyze runs a two-call pipeline: Call #1 gathers sentiment via web search, Call #2 analyzes all structured data (Uniswap + DeFiLlama + sentiment) with web search OFF. Function calling produces structured recommendations. Reasoning trail shows Venice analyzing exact spread, depth, TVL, and sentiment signals. Private inference (zero data retention). |
| EigenCloud | $5,000 | Both Venice calls packaged as Docker image, deployed on EigenCompute TEE. Single attestation covers full pipeline (sentiment → analysis → recommendation). Working demo shows attestation hash in agent logs. |
| Locus | $3,000 | check-budget queries Locus wallet. Olas Mech payments flow through Locus with per-tx and daily spending controls. Agent adapts behavior based on remaining budget. |
| Olas | $1,000 | olas-analyze sends 10+ distinct Mech requests per session to cross-check Venice's recommendation. Each generates on-chain tx hash. Results are load-bearing validation — agent adjusts or skips when Olas disagrees with Venice. |
| Uniswap | $5,000 | uniswap-data makes 4 real API calls per cycle with real key. Forward/reverse/large quotes + check_approval. 4 requestIds logged per cycle = 1,152+/day. DeFiLlama analytics (TVL, yields) integrated in same tool. Combined with pool-reader reading from Uniswap v4 hook + AI Skills. Deepest API integration of any bounty submission. |

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
| `src/tools/uniswap-data.ts` | Uniswap Trading API × 4 calls (price, spread, depth, approval) + DeFiLlama on-chain analytics (TVL, yields, flows) |
| `src/tools/venice-analyze.ts` | Venice AI two-call pipeline: Call #1 sentiment (web search ON), Call #2 analysis (web search OFF, all structured data + sentiment as input) |
| `src/tools/olas-analyze.ts` | Olas Mech 10+ requests — cross-checks Venice recommendation |
| `src/tools/eigencompute.ts` | EigenCompute TEE wrapper |
| `src/lib/config.ts` | Env var loading + validation |
| `src/lib/cache.ts` | File-persisted cache with TTL |
| `src/lib/logger.ts` | Structured logging + payment log |
| `src/lib/types.ts` | Shared TypeScript interfaces |
| `Dockerfile` | EigenCompute deployment image |

**Removed files (vs original plan):**

| File | Reason |
|---|---|
| `src/tools/market-data.ts` | Merit/x402 bounty dropped. Replaced by: Uniswap API + DeFiLlama for structured data, Venice web search for sentiment. |

**Modified files:**

| File | Change |
|---|---|
| `workspace/SKILL.md` | Full Phase 4 decision framework (replaces Phase 3 heuristic) |
| `package.json` | Add openai, pino |
| `.env.example` | Add Venice, Locus, Uniswap, EigenCompute vars. Remove x402 vars. |