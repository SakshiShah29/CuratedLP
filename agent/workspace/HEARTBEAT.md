# Heartbeat Checklist — Phase 4

## Available tools (use EXACT commands below, no others exist)

### OBSERVE
- pool-reader:    npx tsx ../src/tools/pool-reader.ts
- check-budget:   npx tsx ../src/tools/check-budget.ts

### ANALYZE
- olas-analyze:   npx tsx ../src/tools/olas-analyze.ts --pool '<pool-reader JSON>'
- uniswap-data:   [Person B — not yet available]
- venice-analyze: [Person B — not yet available]

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
- FULL ($1+ remaining)    → run olas-analyze
- PARTIAL ($0.10–$1)      → skip olas-analyze, use cached Olas results if available
- MINIMAL (< $0.10)       → skip olas-analyze
- CACHE_ONLY ($0 / error) → skip olas-analyze

---

## Step 2 — ANALYZE (if budget allows)

If strategy is FULL, run olas-analyze with the pool-reader output:
```
npx tsx ../src/tools/olas-analyze.ts --pool '<paste full pool-reader JSON here>'
```

If olas-analyze succeeds:
- Note the suggestedTickLower, suggestedTickUpper, suggestedFee from summary
- Note priceDirectionBull (>0.6 = bullish, <0.4 = bearish)
- Note estimatedVolatility
- Note txHashes (proof of Olas on-chain requests)

If olas-analyze fails or is skipped:
- Continue without Olas data — act on pool state alone (Phase 3 heuristic)

---

## Step 3 — DECIDE

Apply these rules IN ORDER using pool-reader + olas-analyze data:

### RULE 1 — CLAIM RULE
If `accruedPerformanceFee > 0`, you MUST claim. Any non-zero value = claim.

IMPORTANT: idleToken0 must be >= accruedPerformanceFee for claim to succeed.
- If idleToken0 >= accruedPerformanceFee → run claim-fees directly
- If idleToken0 < accruedPerformanceFee (e.g. idleToken0 == 0) → REBALANCE FIRST
  (same or tighter range) to collect LP fees, THEN claim-fees.
  If rebalance fails with "RebalanceTooFrequent", skip this heartbeat — try next time.

### RULE 2 — REBALANCE RULE
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
- Position appears healthy (in-range, not full-range)
- No strong Olas signal to change range or fee

Doing nothing is valid and often the right call.

---

## Step 4 — DECIDE (final choice)

Choose ONE outcome:
- A) Do nothing — fees zero AND position healthy AND no Olas signal
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
- What Olas said (if ran — direction, suggested ticks/fee)
- What you decided and why

End with HEARTBEAT_OK if no alert needed, or HEARTBEAT_ALERT: <reason> if something is wrong
(e.g. pool-reader failed, budget critically low, transaction reverted unexpectedly).
