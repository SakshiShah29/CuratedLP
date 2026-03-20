# Heartbeat Checklist — Phase 4

## Available tools (use EXACT commands below, no others exist)

### OBSERVE
- pool-reader:    npx tsx ../src/tools/pool-reader.ts
- check-budget:   npx tsx ../src/tools/check-budget.ts

### ANALYZE
- uniswap-data:   npx tsx ../src/tools/uniswap-data.ts
- venice-analyze: npx tsx ../src/tools/venice-analyze.ts --mode <sentiment|analyze> [--pool '<json>'] [--uniswap '<json>'] [--sentiment '<json>']
- olas-analyze:   npx tsx ../src/tools/olas-analyze.ts --pool '<pool-reader JSON>'

### ACT
- rebalance:      npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>
- claim fees:     npx tsx ../src/tools/claim-fees.ts

---

## Step 1 — OBSERVE

Run both tools. Read their output.

```
npx tsx ../src/tools/pool-reader.ts
npx tsx ../src/tools/check-budget.ts
```

If pool-reader fails → abort the heartbeat entirely. No pool state = no decisions.
If check-budget fails → continue with MINIMAL strategy (strategy: "MINIMAL", canSpend: false).

From check-budget, read `strategy`:
- FULL ($1+ remaining)    → run all ANALYZE tools including olas-analyze
- PARTIAL ($0.10–$1)      → run uniswap-data + venice-analyze, skip olas-analyze (use cached if available)
- MINIMAL (< $0.10)       → run uniswap-data + venice-analyze, skip olas-analyze
- CACHE_ONLY ($0 / error) → run uniswap-data + venice-analyze, skip olas-analyze

---

## Step 2 — ANALYZE

Run the free data tools first, then paid tools if budget allows.

a) Run uniswap-data for structured market signals:
```
npx tsx ../src/tools/uniswap-data.ts
```

Returns Uniswap quote data (price, spread, depth, approval) plus on-chain analytics
from DeFiLlama (Lido TVL) and DexScreener (pool liquidity, volume, estimated APY).
All free, no paid keys. If it fails, proceed without it — note missing data.

Key signals:
- spreadBps > 50 = volatile → widen range, raise fee
- spreadBps < 10 = calm → tighter range, lower fee
- priceImpactBps > current fee → fee is too low
- lidoTvlChange24h negative → capital flight → widen range defensively
- poolLiquidity low → shallow depth → widen range, raise fee
- poolVolume24h declining → demand falling → wider range

b) Run venice-analyze in sentiment mode (web search ON):
```
npx tsx ../src/tools/venice-analyze.ts --mode sentiment
```
Returns qualitative signals: social sentiment, governance news, whale movements.
If it fails, proceed without sentiment data.

c) Run venice-analyze in analyze mode (web search OFF):
```
npx tsx ../src/tools/venice-analyze.ts --mode analyze \
  --pool '<pool-reader JSON>' \
  --uniswap '<uniswap-data JSON>' \
  --sentiment '<sentiment JSON from step b>'
```
Pass whatever data you have — omit --uniswap or --sentiment if those steps failed.
Venice works with whatever is provided.

Returns: newTickLower, newTickUpper, newFee, confidence, reasoning.
If this fails, fall back to the simple heuristic in RULE 2 mentioned in Step 3 below.

d) If strategy is FULL, run olas-analyze for cross-check:
```
npx tsx ../src/tools/olas-analyze.ts --pool '<paste full pool-reader JSON here>'
```
Provides independent market predictions to cross-check Venice's recommendation.

If olas-analyze succeeds, compare its signals with Venice's recommendation:
- If priceDirectionBull aligns with Venice's directional bias → supports Venice
- If Olas strongly disagrees (bull > 0.65 but Venice is bearish, or vice versa) → reduce confidence
- Use suggestedTickLower/Upper/Fee as a sanity check on Venice's values

If olas-analyze fails, times out, or is skipped due to budget → continue with Venice recommendation alone.

---

## Step 3 — DECIDE

Apply these rules IN ORDER using all available data:

### RULE 1 — CLAIM RULE
If `accruedPerformanceFee > 0`, you MUST claim. Any non-zero value = claim.

IMPORTANT: idleToken0 must be >= accruedPerformanceFee for claim to succeed.
- If idleToken0 >= accruedPerformanceFee → run claim-fees directly
- If idleToken0 < accruedPerformanceFee (e.g. idleToken0 == 0) → REBALANCE FIRST
  (same or tighter range) to collect LP fees, THEN claim-fees.
  If rebalance fails with "RebalanceTooFrequent", skip this heartbeat — try next time.

### RULE 2 — REBALANCE RULE

**Primary: Venice AI recommendation**

If Venice returned a recommendation with confidence >= 0.6 AND the recommended
parameters differ meaningfully from current state:
→ Use Venice's newTickLower, newTickUpper, newFee.

If Olas data is available, cross-check:
- If Olas agrees directionally with Venice → proceed at full confidence
- If Olas partially disagrees (direction matches, magnitude differs) → proceed with caution
- If Olas strongly disagrees (opposite direction) → widen range defensively or skip

**Fallback: Phase 3 simple heuristic (only if Venice unavailable or confidence < 0.6)**

Rebalance if ANY of:
- Range is full range [-887220, 887220] — tighten to ~[-6000, 6000]
- idleToken0 and idleToken1 are clearly imbalanced (position may be out-of-range)
- Olas suggestedTickLower/Upper differ significantly from current range
  AND priceDirectionBull confidence is high (>0.65 or <0.35)
- Olas suggestedFee differs from currentFee by more than 500 bps

For tick choice (in priority order):
1. Use Olas suggestedTickLower/Upper if available and confidence > 0.6
2. Otherwise: keep current range or shift by one tick spacing (60) toward the imbalance

For fee choice (in priority order):
1. Use Olas suggestedFee if available and within delegation bounds [100, 50000]
2. Otherwise: keep currentFee or adjust by 500 bps max

Constraint: Cannot rebalance more than once per 30 blocks. If "RebalanceTooFrequent" → skip silently.

### RULE 3 — DO NOTHING
Only if:
- accruedPerformanceFee == 0
- Venice confidence is below 0.6 (or Venice unavailable and Phase 3 heuristic shows no issue)
- Position appears healthy (in-range, not full-range)
- No strong signal to change range or fee

Doing nothing is valid and often the right call.

---

## Step 4 — DECIDE (final choice)

Choose ONE outcome:
- A) Do nothing — fees zero AND position healthy AND no strong signal
- B) Claim fees only — accruedPerformanceFee > 0 AND idleToken0 sufficient
- C) Rebalance only — range/fee adjustment needed, no fees to claim
- D) Rebalance then claim — accruedPerformanceFee > 0 AND idleToken0 < accruedFee
- E) Claim then rebalance — fees claimable AND range needs fixing (idleToken0 sufficient)

---

## Step 5 — ACT

If acting, use the EXACT commands above.
If a transaction fails → log the error, do NOT retry in the same heartbeat.

---

## Step 6 — REFLECT

Reply with a 3-4 line summary:
- What pool-reader showed (fee, range, accruedFee, idle tokens)
- What check-budget showed (strategy, balance)
- What uniswap-data showed (spread, depth, TVL — if available)
- What Venice recommended (tick range, fee, confidence — if available)
- What Olas said (direction, suggested ticks/fee — if ran)
- What you decided and why

End with HEARTBEAT_OK if no alert needed, or HEARTBEAT_ALERT: <reason> if something is wrong
(e.g. pool-reader failed, budget critically low, transaction reverted unexpectedly).
