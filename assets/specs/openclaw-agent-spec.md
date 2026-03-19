# OpenClaw Agent Specification — CuratedLP Curator

*Last updated: 2026-03-20*

*Depends on: curator-agent-identity-spec.md for the identity model.*

---

## 1. What This Document Covers

This spec defines how the CuratedLP curator agent runs on the OpenClaw
framework. It covers the agent's architecture, decision-making model,
tool design, SKILL.md structure, and how it integrates with every
partner in the project.

For the identity model (who is the curator, who is the agent, which
addresses exist and why), see curator-agent-identity-spec.md.

---

## 2. Architecture Overview

The agent is split into two layers:

- **Reasoning layer** (OpenClaw) — an LLM-based runtime that wakes up
  on a heartbeat, reads the SKILL.md, and autonomously decides what to
  do each cycle. This is where judgment lives.

- **Execution layer** (TypeScript CLI tools) — stateless, deterministic
  commands that the reasoning layer invokes. Each tool does one thing:
  read data, call an API, trigger a transaction. Tools don't decide;
  they execute.

```
  OpenClaw Runtime (LLM-based reasoning)
       |
       | reads SKILL.md → understands goal, constraints, tools
       | heartbeat fires every 5 minutes
       |
       | REASONS about current situation:
       |   "What is the pool state?"
       |   "Should I gather market data or use cache?"
       |   "Does the recommendation justify action?"
       |   "Is gas cost worth it right now?"
       |   "Should I claim fees before rebalancing?"
       |
       | INVOKES tools via exec:
       |
       +---> pool-reader        (reads on-chain state)
       +---> check-budget       (Locus wallet balance + daily spend)
       +---> market-data        (AgentCash x402 paid data)
       +---> olas-analyze       (10+ Olas Mech requests)
       +---> uniswap-quote      (Trading API price quote)
       +---> venice-analyze     (Venice AI recommendation)
       +---> execute-rebalance  (triggers delegation → hook.rebalance)
       +---> claim-fees         (triggers delegation → hook.claimPerformanceFee)
       |
       v
  On-chain execution:
    Locus Wallet triggers DelegationManager
    → Enforcer validates
    → Agent Smart Account executes on hook
    → Smart Account pays gas (ETH)
```

### On-chain address model (from identity spec)

The agent has two on-chain addresses:

```
  Agent Smart Account                   Locus Wallet
  (identity + execution)                (trigger + data spending)

  +-----------------------------------+ +-----------------------------------+
  |                                   | |                                   |
  |  Holds ERC-8004 identity NFT      | |  Triggers delegation redemption   |
  |  Registered as curator in hook    | |  (calls DelegationManager)        |
  |  Holds ETH for gas                | |                                   |
  |  Executes rebalance/claim on hook | |  Pays for x402 data (USDC)       |
  |  Reputation accrues here          | |  Pays for Olas Mech (USDC)       |
  |  ENS/Basename resolves here       | |  Per-tx + daily budget controls   |
  |                                   | |  Gasless via paymaster            |
  |  Permanent                        | |  Replaceable                      |
  +-----------------------------------+ +-----------------------------------+
                |                                       ^
                |  Delegation (signed by human operator) |
                +---------------------------------------+
```

The delegation bounds (fee range, rate limit) are set by the human
operator during setup. The agent operates autonomously within them.
See curator-agent-identity-spec.md sections 4 and 8 for full details.

---

## 3. Why This Split

### What OpenClaw is good at (reasoning)

- Weighing tradeoffs: "Venice says rebalance but confidence is 0.55
  and gas is elevated — should I wait?"
- Adapting to context: "Budget is low today, skip Olas and use
  cached results instead"
- Making judgment calls: "Accrued fees are 0.04 ETH, gas is 0.001 —
  that's 40x ROI, worth claiming"
- Handling novel situations: "Volatility spiked 3x in the last hour,
  I should widen the range more aggressively than Venice suggests"

### What TypeScript tools are good at (execution)

- ABI encoding and calldata construction
- Triggering delegation redemption via Locus wallet
- Parallel HTTP requests with timeout management
- Structured JSON parsing and validation
- On-chain multicall reads
- Cache management with TTL

### What goes wrong if we mix them

- LLM doing ABI encoding → hallucinated calldata → lost funds
- LLM managing parallel HTTP → timeouts, race conditions
- LLM handling private keys → exposure in context
- Hardcoded TypeScript deciding when to rebalance → no adaptability,
  glorified cron job

### Responsibility boundary

```
  +-----------------------------------------------------------------------+
  |                         REASONING LAYER                               |
  |                         (OpenClaw LLM)                                |
  |                                                                       |
  |  "Should I act?"            "What data do I need?"                    |
  |  "Is this worth the gas?"   "Can I afford this data source?"          |
  |  "Claim fees first?"        "Is Venice's confidence high enough?"     |
  |  "Skip this cycle?"         "Are conditions extreme?"                 |
  |                                                                       |
  |  JUDGMENT --- TRADEOFFS --- ADAPTATION --- CONTEXT                    |
  +-----------------------------------------------------------------------+
                              |
                    invokes via exec
                              |
  +-----------------------------------------------------------------------+
  |                         EXECUTION LAYER                               |
  |                         (TypeScript CLI tools)                        |
  |                                                                       |
  |  Read on-chain state       Encode ABI calldata                        |
  |  Fetch HTTP APIs           Trigger delegation via Locus wallet        |
  |  Parse JSON responses      Manage cache TTLs                          |
  |  Handle parallel requests  Validate data formats                      |
  |                                                                       |
  |  DETERMINISTIC --- RELIABLE --- STATELESS --- FAST                    |
  +-----------------------------------------------------------------------+
```

---

## 4. The Heartbeat Cycle

OpenClaw invokes the agent on a 5-minute interval. Each heartbeat,
the agent follows a flexible decision framework — not a rigid tree.

```
  Heartbeat fires
       |
       v
  OBSERVE
       |  Invoke: pool-reader
       |  Invoke: check-budget
       |  Read results. Now the agent knows:
       |    - Current tick, range, fee, liquidity
       |    - Idle balances, accrued performance fees
       |    - Locus wallet balance, daily spend remaining
       |
       | If pool-reader fails → log error, DONE (wait for next heartbeat)
       |
       v
  REASON ABOUT DATA NEEDS
       |  Agent decides which data sources to fetch based on:
       |    - Budget remaining (skip paid sources if budget is tight)
       |    - Cache freshness (skip if recent data is still valid)
       |    - Market conditions (high vol → fetch everything, calm → minimal)
       |
       |  Possible paths:
       |    A) Full fetch: uniswap-quote + market-data + olas-analyze
       |    B) Partial: uniswap-quote + market-data (skip Olas, use cache)
       |    C) Minimal: uniswap-quote only (budget exhausted, cache rest)
       |    D) Cache-only: use last known data (all sources down or broke)
       |
       v
  ANALYZE
       |  Invoke: venice-analyze with whatever data was gathered
       |  Venice AI returns: tick range, fee, confidence, reasoning
       |
       | If Venice fails → log, DONE
       | If confidence < agent's judgment threshold → log reasoning, DONE
       |
       v
  DECIDE
       |  Agent REASONS holistically:
       |
       |  Consider:
       |    - Is the recommended change meaningful?
       |      (not just noise — tick or fee significantly different)
       |    - Is confidence high enough given current market conditions?
       |    - Is gas cost justified by the expected improvement?
       |    - Has enough time passed since last rebalance?
       |    - Should I claim accrued fees first?
       |      (if accruedFee >> gas cost, claim before rebalance
       |       to avoid fees sitting idle in the hook)
       |    - Are conditions extreme enough to consider sub-delegation?
       |
       |  Possible outcomes:
       |    A) Rebalance (most common when conditions change)
       |    B) Claim fees only (fees justify gas, no rebalance needed)
       |    C) Claim fees then rebalance (both worthwhile)
       |    D) Do nothing (conditions haven't changed enough)
       |    E) Sub-delegate (extreme volatility, specialized agent needed)
       |
       v
  ACT
       |  Invoke the appropriate tool(s):
       |    - execute-rebalance with Venice's recommended params
       |    - claim-fees if fees are worth claiming
       |    - Both in sequence if both are warranted
       |
       |  On-chain execution path for each tool:
       |    Locus Wallet triggers DelegationManager.redeemDelegations()
       |    → Enforcer validates bounds
       |    → Agent Smart Account executes on hook (pays gas in ETH)
       |
       | If tx reverts → log error reason, do NOT retry this heartbeat
       |
       v
  REFLECT
       |  Log what happened and why:
       |    - What data was gathered (and what was skipped + why)
       |    - Venice's recommendation and reasoning
       |    - What action was taken (or why no action)
       |    - Tx hash if executed
       |    - Budget spent this cycle
       |    - Running totals (cumulative rebalances, fees claimed, budget spent)
       |
       v
  DONE — wait for next heartbeat
```

---

## 5. Tool Specifications

Each tool is a standalone Node.js CLI script. Outputs JSON to stdout.
Exits with code 0 on success, non-zero on failure. Tools are stateless —
they read env vars for configuration and accept arguments for per-call input.

### Tool dependency map

```
  +--------------------------------------------------------------+
  |                   OpenClaw reasoning                          |
  |                   (invokes any tool at any time)              |
  +------+------+------+------+------+------+------+------+------+
         |      |      |      |      |      |      |      |
         v      v      v      v      v      v      v      v
       pool   check  uniswap market  olas  venice  exec   claim
       reader budget quote   data   analyze analyze rebal  fees
         |      |      |      |      |      |      |      |
         |      |      |      |      |      |      +------+------+
         |      |      |      |      |      |             |
         |      |      |      +------+------+             |
         |      |      |             |                    |
         v      v      v             v                    v
       Base   Locus  Uniswap    AgentCash +         Locus Wallet
       RPC    API    Trading    Olas Mech            triggers
                     API        Marketplace         DelegationMgr
                                                         |
                                                         v
                                                   Agent Smart Acct
                                                   executes on Hook
                                                   (pays gas in ETH)
```

**Key point:** No tool depends on another tool. The OpenClaw reasoning
layer decides which tools to call, in what order, and how to combine
their outputs. This means the agent can skip tools, reorder them, or
call only a subset based on context.

### 5.1 pool-reader

**Purpose:** Read all on-chain state from the CuratedVaultHook contract.

**Input:** None (reads HOOK_ADDRESS and RPC from env vars).

**Output fields:** currentTick, tickLower, tickUpper, totalLiquidity,
currentFee, cumulativeVolume, cumulativeFeeRevenue, totalSwaps,
idleToken0, idleToken1, accruedPerformanceFee, activeCuratorId,
lastRebalanceBlock, currentBlock.

**Implementation:** viem multicall batching getPerformanceMetrics(),
totalAssets(), activeCuratorId(), accruedPerformanceFee() into a
single RPC round-trip.

**Failure mode:** Exits non-zero. Agent sees the failure and skips
the cycle.

---

### 5.2 check-budget

**Purpose:** Check Locus wallet balance and daily spending status.

**Input:** None (reads LOCUS_API_KEY and LOCUS_WALLET_ID from env vars).

**Output fields:** balanceUSDC, dailySpent, dailyCap, dailyRemaining,
perTxMax, canSpend (boolean).

**Implementation:** Authenticates with Locus API (JWT), queries balance,
computes remaining budget from internal daily spend tracker.

**Failure mode:** Returns canSpend as false with stale balance. Agent
proceeds using cache for paid data sources.

---

### 5.3 market-data

**Purpose:** Fetch real-time market data via AgentCash x402 micropayments.
Paid from Locus wallet (USDC, gasless).

**Input:** None (discovers endpoints on first run, caches catalog).

**Output fields:** price, volume24h, volatility, sentiment, timestamp,
sources (list of origins used), totalCost, paymentTxHashes, fromCache
(boolean indicating whether live data or cached fallback).

**Implementation:** Calls AgentCash CLI for 3-4 data endpoints in
parallel. Each request checks Locus budget first. Failed sources
fall back to cached data.

**Failure mode:** Returns whatever succeeded plus cached data for
failures. fromCache is true if all live sources failed. Agent sees
this and factors it into reasoning ("data is stale, lower confidence
in decisions").

---

### 5.4 olas-analyze

**Purpose:** Send 10+ requests to Olas Mech Marketplace for cross-check
analysis. Paid from Locus wallet (USDC).

**Input:** Pool state JSON passed as argument.

**Output fields:** priceDirection (p_up, p_down, confidence),
dropProbability, riseProbability, volatilityEstimate, tickRange-
Recommendation, feeRecommendation, sentiment, requestCount,
successCount, txHashes (array), fromCache (boolean).

**Implementation:** Shells out to mechx request CLI for 10 parallel
requests (predictions, price oracle, GPT-4o analysis). 120-second
timeout per request. Partial failures are OK — agent sees successCount
and adjusts confidence accordingly.

**Failure mode:** Returns whatever succeeded. If fewer than 10 requests
succeed, agent is aware (bounty requirement tracking). If all fail,
returns cached results with fromCache as true.

---

### 5.5 uniswap-quote

**Purpose:** Get current wstETH/USDC price quote from Uniswap Trading API.

**Input:** None (reads UNISWAP_API_KEY from env vars).

**Output fields:** price, gasEstimate, route, requestId.

**Implementation:** Single POST /v1/quote call with Uniswap API key.
Free tier, no payment needed.

**Failure mode:** Returns null. Agent proceeds without Uniswap price
(Venice can still work with other data).

---

### 5.6 venice-analyze

**Purpose:** Send all gathered data to Venice AI and receive a structured
rebalance recommendation.

**Input:** Pool state JSON (required), market data JSON (optional),
Olas results JSON (optional), Uniswap price (optional). Any input can
be omitted if that data source was unavailable. Venice works with
whatever is provided.

**Output fields:** newTickLower, newTickUpper, newFee, confidence
(0 to 1), reasoning (text), dataSources (list of what was available),
missingData (list of what was unavailable), model (which Venice model
was used).

**Implementation:** Uses openai SDK pointing at Venice API. System
prompt defines the agent's role and output format. Function calling
forces structured output. Response validated (ticks divisible by 60,
fee in range, confidence 0-1). Fallback to secondary model on 429/500.

**Failure mode:** Returns null. Agent skips this cycle.

---

### 5.7 execute-rebalance

**Purpose:** Execute a rebalance via MetaMask delegation redemption.

**Input:** tickLower, tickUpper, fee as arguments.

**Output fields:** txHash, success (boolean), gasUsed, blockNumber.

**Implementation:** Encodes rebalance calldata via viem. Locus wallet
triggers DelegationManager.redeemDelegations() using the stored signed
delegation. DelegationManager validates, enforcer checks bounds, Agent
Smart Account executes rebalance() on hook. Smart Account pays gas
from its ETH balance.

**Failure mode:** Returns success as false with revert reason. Agent
logs and does NOT retry.

---

### 5.8 claim-fees

**Purpose:** Claim accrued performance fees via delegation.

**Input:** None.

**Output fields:** txHash, success (boolean), amountClaimed, gasUsed.

**Implementation:** Encodes claimPerformanceFee() calldata. Same
delegation redemption path as execute-rebalance. The enforcer allows
this selector with target-check only (no fee bounds, no rate limit).
Smart Account pays gas.

**Failure mode:** Returns success as false if no fees accrued or tx
reverts.

---

## 6. Decision Framework (SKILL.md Body)

The SKILL.md body gives the agent guidelines, not rigid rules. The agent
reasons about each decision using context from the tools.

### 6.1 Goal

Maximize LP returns for the vault by keeping the concentrated liquidity
position optimally positioned around the current price, with the swap
fee calibrated to market volatility. Operate within the delegation
bounds set by the human operator.

### 6.2 Constraints (hard rules — never violate)

- Fee must be within delegation bounds: minFee to maxFee from terms
- Cannot rebalance more than once per 30 blocks (~1 minute on Base)
- Cannot exceed daily data budget ($5.00 USDC via Locus)
- Cannot exceed per-transaction data cost ($0.50 USDC)
- Never expose private keys in output or reasoning
- Never modify tools or invoke commands not listed in SKILL.md

### 6.3 Guidelines (soft rules — use judgment)

**When to rebalance:**
- Current tick has moved significantly outside the center of the range
- Venice AI recommends a meaningfully different range or fee
- Confidence is above 0.6 (lower confidence → wait for more data)
- Gas cost is reasonable relative to expected benefit
- At least 30 blocks have passed since last rebalance

**When to claim fees:**
- Accrued performance fee is at least 10x the estimated gas cost
- Claiming before a rebalance prevents fees from sitting idle
- If fees are tiny, skip — not worth the gas

**When to skip a cycle:**
- Venice confidence is low and market is calm
- Data sources failed and cached data is stale
- Recent rebalance was within the last few blocks
- Pool state hasn't changed meaningfully since last check

**When to gather full data vs. minimal:**
- Budget remaining above $3.00 → full fetch (all sources)
- Budget remaining $1.00 to $3.00 → skip Olas, use cache for sentiment
- Budget remaining below $1.00 → Uniswap quote only (free), cache rest
- All paid sources failed → proceed with cache + Uniswap quote

**How to handle partial data:**
- Venice AI is designed to work with incomplete data
- If market-data failed, tell Venice what's missing
- If Olas failed, Venice still has pool state + market data
- Lower confidence threshold when working with incomplete data
- Note missing data in the REFLECT log

### 6.4 Budget-adaptive data strategy

The agent adapts its data gathering to remaining budget. This is one of
the key demonstrations of autonomous reasoning — a static FSM cannot do this.

```
  Budget remaining        Data strategy
  +-----------------+     +---------------------------------------------+
  |                 |     |                                             |
  |  > $3.00       | --> |  FULL: uniswap + market-data + olas         |
  |  (comfortable)  |     |  All sources, maximum data for Venice       |
  |                 |     |                                             |
  +-----------------+     +---------------------------------------------+
  |                 |     |                                             |
  |  $1.00 - $3.00 | --> |  PARTIAL: uniswap + market-data             |
  |  (conserving)   |     |  Skip Olas (most expensive), use cache      |
  |                 |     |                                             |
  +-----------------+     +---------------------------------------------+
  |                 |     |                                             |
  |  < $1.00       | --> |  MINIMAL: uniswap only (free)               |
  |  (near broke)   |     |  All paid sources use cache                 |
  |                 |     |                                             |
  +-----------------+     +---------------------------------------------+
  |                 |     |                                             |
  |  $0.00         | --> |  CACHE-ONLY: no external calls              |
  |  (exhausted)    |     |  Rely entirely on last known good data      |
  |                 |     |  Lower confidence in all decisions          |
  +-----------------+     +---------------------------------------------+
```

### 6.5 Fee claiming decision matrix

The agent reasons about when claiming performance fees is worthwhile,
factoring in gas cost, accrued amount, and upcoming actions.

```
  Accrued fees vs gas cost         Upcoming rebalance?

  +---------------------------+    +-----------------------------+
  |                           |    |                             |
  |  accruedFee > 10x gas    |    |  YES: rebalance planned     |
  |  (clearly profitable)     |    |  Claim FIRST, then rebalance|
  |                           | -->|  (prevents fees sitting idle |
  |                           |    |   during the liquidity       |
  |                           |    |   removal/re-add cycle)      |
  |                           |    |                             |
  +---------------------------+    +-----------------------------+
  |                           |    |                             |
  |  accruedFee > 10x gas    |    |  NO: no rebalance needed    |
  |  (clearly profitable)     | -->|  Claim ALONE                |
  |                           |    |  (standalone fee harvest)    |
  +---------------------------+    +-----------------------------+
  |                           |
  |  accruedFee < 10x gas    |
  |  (not worth it yet)       | -->  SKIP claiming, let fees accrue
  |                           |
  +---------------------------+
```

### 6.6 Sub-delegation (advanced, optional)

If the agent detects extreme conditions (volatility above 3x normal,
major price dislocation, rapid tick movement), it may sub-delegate
to a specialized volatility agent with tighter bounds.

```
  Normal conditions                     Extreme conditions
  +-----------------------------+       +-----------------------------+
  |                             |       |                             |
  |  OpenClaw Curator Agent     |       |  OpenClaw Curator Agent     |
  |  (primary, wide bounds)     |       |  (primary, wide bounds)     |
  |                             |       |                             |
  |  Fee range: [100, 50000]    |       |  Detects: vol > 3x normal  |
  |  Interval: 10 blocks        |       |                             |
  |                             |       |  Signs sub-delegation:      |
  |  Handles all rebalances     |       |  Locus Wallet → Vol Agent   |
  |  via Locus Wallet trigger   |       |  Fee range: [2000, 15000]   |
  |                             |       |  Interval: 5 blocks         |
  +-----------------------------+       +-----------------------------+
                                                     |
                                                     v
                                        +-----------------------------+
                                        |  Volatility Agent           |
                                        |  (specialist, tight bounds) |
                                        |                             |
                                        |  Higher frequency           |
                                        |  Narrower fee range         |
                                        |  Returns control when       |
                                        |  conditions normalize       |
                                        +-----------------------------+
```

This requires a sub-delegation TypeScript tool and is a stretch goal.

---

## 7. What the Agent Sees Each Heartbeat

When OpenClaw wakes the agent, it loads the SKILL.md and sees:

1. **Who am I**: The CuratedLP curator agent, managing a wstETH/USDC
   vault on Uniswap v4 on Base.

2. **What tools do I have**: 8 CLI tools, each with defined input/output.

3. **What is my goal**: Maximize LP returns within delegation bounds.

4. **What are my constraints**: Fee bounds, rate limits, budget caps.

5. **What are my guidelines**: When to act, when to wait, how to adapt.

The agent then invokes tools, reads their output, and reasons about
what to do — using the guidelines as a decision framework, not a script.

---

## 8. Logging and Observability

### 8.1 Payment log

Every tool that spends money appends to a payment log file. Each entry
records: timestamp, source (which integration), amount in USDC, tx hash,
network, and the endpoint called.

This file is the bounty submission proof for Merit/x402, Locus, and Olas.

### 8.2 Cycle log

Each heartbeat produces a structured log entry recording: cycle number,
timestamp, pool state snapshot, which data sources were gathered (and
which were skipped), Venice's recommendation, what decision was made
and why, tx hash if executed, budget spent this cycle, and budget
remaining.

### 8.3 Agent reasoning trail

OpenClaw's LLM reasoning is logged automatically. This shows WHY the
agent made each decision — critical for the demo and debugging.

### 8.4 Data flow through a single heartbeat

```
  +----------+     +----------+     +-----------+
  | pool     |     | check    |     | uniswap   |
  | reader   |     | budget   |     | quote     |
  +----+-----+     +----+-----+     +-----+-----+
       |                |                  |
       v                v                  v
  +---------+     +---------+        +---------+
  | Pool    |     | Budget  |        | Price   |
  | State   |     | Status  |        | Quote   |
  +---------+     +---------+        +---------+
       |                |                  |
       |    +-----------+                  |
       |    |                              |
       |    |  Agent REASONS:              |
       |    |  "Budget is $3.50,           |
       |    |   I can afford full fetch"   |
       |    |                              |
       |    +-------+-------+             |
       |            |       |             |
       |            v       v             |
       |     +----------+  +----------+   |
       |     | market   |  | olas     |   |
       |     | data     |  | analyze  |   |
       |     +----+-----+  +----+-----+   |
       |          |             |          |
       |          v             v          |
       |     +---------+  +---------+     |
       |     | Market  |  | Mech    |     |
       |     | Data    |  | Results |     |
       |     +---------+  +---------+     |
       |          |             |          |
       +----------+------+------+----------+
                         |
                         v
                  +--------------+
                  | venice       |
                  | analyze      |
                  | (all data    |
                  |  combined)   |
                  +------+-------+
                         |
                         v
                  +--------------+
                  | Recommend-   |
                  | ation        |
                  | tick, fee,   |
                  | confidence   |
                  +--------------+
                         |
                         v
                  Agent REASONS:
                  "Confidence 0.82,
                   tick change is
                   meaningful, fees
                   accrued 0.03 ETH"
                         |
              +----------+----------+
              |                     |
              v                     v
       +-----------+         +-----------+
       | claim     |         | execute   |
       | fees      |         | rebalance |
       +-----+-----+         +-----+-----+
             |                      |
             v                      v
       Locus Wallet           Locus Wallet
       triggers deleg         triggers deleg
       → Smart Acct           → Smart Acct
       → hook.claimFee        → hook.rebalance
             |                      |
             v                      v
       +-----------+         +-----------+
       | Fee tx    |         | Rebalance |
       | hash      |         | tx hash   |
       +-----------+         +-----------+
              |                     |
              +----------+----------+
                         |
                         v
                    REFLECT
                    (log everything)
```

---

## 9. File Structure

```
agent/
  workspace/
    SKILL.md                 Essential — defines agent for OpenClaw
  src/
    tools/
      pool-reader.ts         Read on-chain hook state
      check-budget.ts        Locus wallet balance check
      market-data.ts         AgentCash x402 data fetch
      olas-analyze.ts        Olas Mech 10+ requests
      uniswap-quote.ts       Uniswap Trading API price
      venice-analyze.ts      Venice AI recommendation
      execute-rebalance.ts   Triggers delegation → rebalance
      claim-fees.ts          Triggers delegation → claim fee
    lib/
      config.ts              Env var loading + validation
      cache.ts               File-persisted data cache with TTL
      logger.ts              Structured logging + payment log
      delegation.ts          Delegation loading + redemption helpers
      types.ts               Shared TypeScript interfaces
  dist/                      Compiled output (gitignored)
  package.json
  tsconfig.json
  .env.example
```

---

## 10. SKILL.md Structure (Outline)

### Frontmatter

The YAML frontmatter declares:
- **name**: curatedlp-curator
- **description**: AI curator for CuratedLP vault — manages Uniswap v4
  concentrated liquidity on Base, analyzes markets via Venice AI, pays
  for data via x402/AgentCash, triggers rebalances via MetaMask delegation.
- **version**: 1.0.0
- **required env vars**: VENICE_API_KEY, BASE_SEPOLIA_RPC, HOOK_ADDRESS,
  LOCUS_API_KEY, LOCUS_WALLET_ID, DELEGATION_SIGNED_BYTES,
  CURATOR_SMART_ACCOUNT
- **required binaries**: node, npx
- **primaryEnv**: VENICE_API_KEY
- **user-invocable**: true

### Body sections

1. Agent identity and purpose
2. Available tools (invocation pattern, expected input, expected output for each)
3. Goal statement
4. Hard constraints (never violate)
5. Decision guidelines (use judgment)
6. Heartbeat protocol (OBSERVE → REASON → ANALYZE → DECIDE → ACT → REFLECT)
7. Error handling rules
8. Sub-delegation guidelines (stretch goal)

---

## 11. Partner Integration via Tools

Every hackathon bounty is satisfied through specific tools:

```
  +--------------------------------------------------------------+
  |                    OpenClaw Agent                             |
  |                    (SKILL.md + reasoning)                     |
  |                                                              |
  |  Invokes tools:                                              |
  |                                                              |
  |  pool-reader ---------> Uniswap v4 hook (on-chain read)      |
  |                         Bounty: Uniswap ($5,000)             |
  |                                                              |
  |  uniswap-quote -------> Uniswap Trading API                  |
  |                         Bounty: Uniswap ($5,000)             |
  |                                                              |
  |  market-data ----------> AgentCash / x402 endpoints           |
  |        |                Bounty: Merit ($5,250)                |
  |        +--- pays via -> Locus wallet (USDC)                   |
  |                         Bounty: Locus ($3,000)                |
  |                                                              |
  |  olas-analyze ---------> Olas Mech Marketplace                |
  |        |                Bounty: Olas ($1,000)                |
  |        +--- pays via -> Locus wallet (USDC)                   |
  |                                                              |
  |  venice-analyze -------> Venice AI API                        |
  |                         Bounty: Venice ($11,500)              |
  |                                                              |
  |  execute-rebalance ----> Locus Wallet triggers                |
  |  claim-fees              DelegationManager                    |
  |                          → CuratedVaultCaveatEnforcer         |
  |                          → Agent Smart Account                |
  |                          → CuratedVaultHook                   |
  |                         Bounty: MetaMask ($5,000)             |
  |                                                              |
  |  (REFLECT phase) ------> ERC-8004 ReputationRegistry          |
  |                          (via Agent Smart Account)            |
  |                         Bounty: ERC-8004                      |
  +--------------------------------------------------------------+
```

---

## 12. Error Handling and Graceful Degradation

Each failure mode leads to a specific agent behavior. The agent never
crashes — it degrades gracefully and tries again next heartbeat.

```
  Failure scenario                Agent behavior
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  RPC down                   |  pool-reader fails → ABORT entire cycle      |
  |  (cannot read pool state)   |  No data = no decisions. Wait for next       |
  |                             |  heartbeat. If 3 consecutive failures,       |
  |                             |  exponential backoff (5→10→20→30 min cap)    |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Locus API unreachable      |  check-budget returns canSpend=false with    |
  |                             |  stale balance. Agent uses cache for all     |
  |                             |  paid data. Proceeds with reduced data.      |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  x402 endpoints down        |  market-data returns fromCache=true.         |
  |  (or budget exhausted)      |  Agent tells Venice "market data is stale,   |
  |                             |  N minutes old" → Venice lowers confidence.  |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Olas Mech timeout          |  olas-analyze returns partial results.       |
  |  (some of 10 requests fail) |  successCount < 10 logged as warning.       |
  |                             |  Agent proceeds with available results.      |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Venice AI rate limited     |  venice-analyze retries with fallback model. |
  |  (429 / 500)                |  If fallback also fails → returns null →     |
  |                             |  agent skips cycle entirely.                 |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Venice low confidence      |  Agent sees confidence < threshold.          |
  |                             |  REASONS: "Not confident enough to act."     |
  |                             |  Skips to REFLECT, logs reasoning.           |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Rebalance tx reverts       |  execute-rebalance returns success=false     |
  |                             |  with revert reason. Agent logs reason.      |
  |                             |  Does NOT retry (enforcer rate limit risk).  |
  |                             |  Waits for next heartbeat.                   |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
  |                             |                                              |
  |  Delegation revoked or      |  execute-rebalance fails permanently.        |
  |  expired                    |  Agent logs CRITICAL error.                  |
  |                             |  Continues observing but cannot act.         |
  |                             |  Human intervention required.                |
  |                             |                                              |
  +-----------------------------+----------------------------------------------+
```

```
  Degradation cascade:

  FULL CAPABILITY                REDUCED DATA              OBSERVE-ONLY
  +------------------+          +------------------+       +------------------+
  |                  |          |                  |       |                  |
  | All data sources |  x402 → | Pool state +     | Venice| Pool state only  |
  | + Venice AI      |  fails  | Uniswap quote +  | fails | Agent monitors   |
  | + rebalancing    |         | cached market    |       | but cannot act   |
  |                  |         | + Venice (lower  |       |                  |
  |                  |         |   confidence)    |       | Logs: "degraded, |
  |                  |         |                  |       |  awaiting next   |
  |                  |         | May still act if |       |  cycle"          |
  |                  |         | confidence > 0.6 |       |                  |
  +------------------+         +------------------+       +------------------+
```

---

## 13. How to Verify the Agent Works

### 13.1 Tool-level testing (before OpenClaw integration)

Test each tool in isolation:

- pool-reader: returns valid data with non-zero liquidity from Sepolia
- check-budget: returns Locus balance, canSpend is true
- market-data: returns price data, payment tx hashes in output
- olas-analyze: returns results from 10+ requests, tx hashes logged
- uniswap-quote: returns valid wstETH/USDC price
- venice-analyze: returns recommendation with valid ticks and confidence
- execute-rebalance: rebalance tx confirmed on Sepolia (Locus triggers,
  Smart Account executes, gas paid from Smart Account ETH)
- claim-fees: claim tx confirmed (or correct error if no fees accrued)

### 13.2 OpenClaw integration testing

- Install OpenClaw globally
- Place SKILL.md in workspace
- Configure env vars (including Locus wallet + Smart Account addresses)
- Start agent — OpenClaw loads SKILL.md, begins heartbeat cycle
- Watch 3+ cycles:
  - Agent invokes pool-reader, sees pool state
  - Agent reasons about data needs, invokes appropriate sources
  - Agent calls Venice, receives recommendation
  - Agent decides to rebalance (or explains why not)
  - Agent triggers execution via Locus wallet (or logs skip reason)
  - Agent reflects on what happened
- Verify on Sepolia:
  - Hook state changed (tick range, fee) after rebalance
  - Locus wallet debited for x402 calls
  - Agent Smart Account debited ETH for gas
  - Olas tx hashes visible on marketplace.olas.network
  - Payment log has all tx hashes

**End-to-end heartbeat sequence showing autonomous adaptation:**

```
  Cycle 1 (fresh start)          Cycle 2 (steady state)         Cycle 3 (budget pressure)
  +-------------------------+    +-------------------------+    +-------------------------+
  |                         |    |                         |    |                         |
  | OBSERVE                 |    | OBSERVE                 |    | OBSERVE                 |
  |  pool-reader: OK        |    |  pool-reader: OK        |    |  pool-reader: OK        |
  |  check-budget: $8.42    |    |  check-budget: $8.39    |    |  check-budget: $0.80    |
  |                         |    |                         |    |                         |
  | REASON: full budget,    |    | REASON: budget fine,    |    | REASON: budget low,     |
  |  fetch everything       |    |  fetch everything       |    |  skip Olas + market,    |
  |                         |    |                         |    |  use cache + free quote |
  |                         |    |                         |    |                         |
  | ANALYZE                 |    | ANALYZE                 |    | ANALYZE                 |
  |  uniswap: $3412         |    |  uniswap: $3380         |    |  uniswap: $3350         |
  |  market: vol=12%        |    |  market: vol=8%         |    |  (cache: vol=8%)        |
  |  olas: 10/10 OK         |    |  olas: 9/10 OK          |    |  (cache: olas stale)    |
  |  venice: conf=0.82      |    |  venice: conf=0.45      |    |  venice: conf=0.61      |
  |                         |    |                         |    |                         |
  | DECIDE: rebalance       |    | DECIDE: skip            |    | DECIDE: rebalance       |
  |  (meaningful change,    |    |  (low confidence,       |    |  (marginal confidence   |
  |   high confidence)      |    |   market is calm)       |    |   but change is large)  |
  |                         |    |                         |    |                         |
  | ACT: execute-rebalance  |    | ACT: nothing            |    | ACT: execute-rebalance  |
  |  Locus triggers deleg   |    |                         |    |  Locus triggers deleg   |
  |  Smart Acct executes    |    |                         |    |  Smart Acct executes    |
  |  tx: 0xabc...           |    |                         |    |  tx: 0xdef...           |
  |                         |    |                         |    |                         |
  | REFLECT: logged         |    | REFLECT: logged         |    | REFLECT: logged         |
  +-------------------------+    +-------------------------+    +-------------------------+
```

### 13.3 Autonomous decision testing

Verify the agent makes DIFFERENT decisions in different situations:

- **High confidence, meaningful change**: agent rebalances
- **Low confidence**: agent skips, logs "confidence too low"
- **Budget exhausted**: agent skips paid data, uses cache, notes degraded data
- **Fees accrued**: agent claims before rebalancing
- **No change needed**: agent skips, logs "position is optimal"
- **Venice unavailable**: agent skips cycle, logs error
- **RPC down**: agent aborts immediately, waits for next heartbeat

---

## 14. Relationship to Phase 4 Implementation Plan

The existing Phase 4 plan (phase4-implementation-plan.md) describes
the TypeScript modules in detail. This spec reframes them:

| Phase 4 Module | OpenClaw Role |
|---|---|
| pool-reader.ts | Tool: pool-reader |
| locus.ts | Tool: check-budget + internal lib for payment gating |
| uniswap-api.ts | Tool: uniswap-quote |
| x402-client.ts | Tool: market-data |
| mech-client.ts | Tool: olas-analyze |
| venice.ts | Tool: venice-analyze |
| rebalancer.ts | Tools: execute-rebalance + claim-fees (trigger via Locus wallet) |
| fsm.ts | Replaced by OpenClaw's reasoning + SKILL.md |
| index.ts | Replaced by OpenClaw's heartbeat scheduler |

The key change: fsm.ts and index.ts are no longer needed as standalone
files. OpenClaw's LLM runtime IS the FSM — it reads the SKILL.md
decision framework and reasons about what to do each cycle. The
TypeScript modules become CLI tools rather than parts of an internal
state machine.

---

## 15. What We Don't Need

| File | Reason |
|---|---|
| IDENTITY.md | No persona needed — this is a utility DeFi agent |
| SOUL.md | No personality, no conversion mechanics |
| HEARTBEAT.md | OpenClaw handles heartbeat scheduling natively |
| AGENTS.md | No multi-agent directory needed (sub-delegation handled via tools) |
| fsm.ts | OpenClaw's reasoning replaces the hardcoded state machine |
| index.ts | OpenClaw's heartbeat replaces the main loop |
