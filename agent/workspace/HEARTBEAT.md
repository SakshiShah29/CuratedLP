# Heartbeat Checklist

## Available tools (use EXACT filenames below, no others exist)
- pool-reader:           npx tsx ../src/tools/pool-reader.ts
- uniswap-data:          npx tsx ../src/tools/uniswap-data.ts
- venice-analyze:        npx tsx ../src/tools/venice-analyze.ts --mode <sentiment|analyze> [--pool '<json>'] [--uniswap '<json>'] [--sentiment '<json>']
- claim fees:            npx tsx ../src/tools/claim-fees.ts
- rebalance:             npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>

Each time you run, follow these steps in order:

1. OBSERVE — Run pool-reader:
   npx tsx ../src/tools/pool-reader.ts

   If it fails, log the error and stop. Wait for next heartbeat.

2. REASON — Read the JSON output. Check: accrued fees to claim,
   activeCuratorId, liquidity, idle token imbalance.
   If activeCuratorId is 0 or totalLiquidity is 0, skip to step 6.

3. ANALYZE — Gather external data and get Venice AI recommendation:

   a) Run uniswap-data for structured market signals:
      npx tsx ../src/tools/uniswap-data.ts

      Returns Uniswap quote data (price, spread, depth, approval)
      plus on-chain analytics from DeFiLlama (Lido TVL) and DexScreener
      (pool liquidity, volume, estimated APY). All free, no paid keys.
      If it fails, proceed without it — note missing data.

   b) Run venice-analyze in sentiment mode (web search ON):
      npx tsx ../src/tools/venice-analyze.ts --mode sentiment

      Returns qualitative signals: social sentiment, governance news,
      whale movements. If it fails, proceed without sentiment data.

   c) Run venice-analyze in analyze mode (web search OFF):
      npx tsx ../src/tools/venice-analyze.ts --mode analyze \
        --pool '<pool-reader JSON>' \
        --uniswap '<uniswap-data JSON>' \
        --sentiment '<sentiment JSON from step b>'

      Pass whatever data you have — omit --uniswap or --sentiment if
      those steps failed. Venice works with whatever is provided.

      Returns: newTickLower, newTickUpper, newFee, confidence, reasoning.

      If this fails, fall back to the simple heuristic in RULE 2 below.

   Key signals from uniswap-data (used by Venice and your own reasoning):
   - spreadBps > 50 = volatile → widen range, raise fee
   - spreadBps < 10 = calm → tighter range, lower fee
   - priceImpactBps > current fee → fee is too low
   - lidoTvlChange24h negative → capital flight → widen range defensively
   - lidoTvlChange7d sustained decline → reduce confidence
   - poolLiquidity low → shallow depth → widen range, raise fee
   - poolVolume24h declining → demand falling → wider range
   - poolFeeApyEstimate → is our pool competitive?

4. DECIDE — Apply these rules IN ORDER:

   RULE 1 — CLAIM RULE:
   If accruedPerformanceFee > 0, you MUST claim. Always. Any non-zero value = claim.

   IMPORTANT: idleToken0 must be >= accruedPerformanceFee for claim to succeed.
   - If idleToken0 >= accruedPerformanceFee: run claim-fees directly.
     Command: npx tsx ../src/tools/claim-fees.ts
   - If idleToken0 < accruedPerformanceFee (e.g. idleToken0 == 0): REBALANCE FIRST
     (same or tighter range) to collect LP fees, then run claim-fees.
     Rebalance: npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>
     Then claim: npx tsx ../src/tools/claim-fees.ts
     If rebalance fails with "RebalanceTooFrequent", skip this heartbeat — try next time.

   RULE 2 — REBALANCE RULE:
   If Venice returned a recommendation with confidence >= 0.6 AND the
   recommended parameters differ meaningfully from current state:
   → Use Venice's newTickLower, newTickUpper, newFee.

   If Venice was unavailable or confidence < 0.6, fall back to simple heuristic:
   → If range is full range [-887220, 887220] OR idle tokens are clearly
     imbalanced, rebalance conservatively using uniswap-data signals:
     - Wide spread → wider range, higher fee
     - Calm spread → tighter range, lower fee
     - High price impact → raise fee to compensate

   Command: npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>
   NOTE: If this fails with "RebalanceTooFrequent", skip silently.

   RULE 3 — DO NOTHING:
   Only if accruedPerformanceFee == 0 AND position looks healthy (not
   full range, balanced idle tokens, Venice confidence < 0.6 or
   recommended change is trivially small).

   Decide ONE of:
   A) Do nothing — position healthy, no fees to claim, Venice agrees or unavailable
   B) Claim fees — accruedPerformanceFee > 0, idleToken0 sufficient
   C) Rebalance — Venice recommends with confidence >= 0.6, or heuristic triggers
   D) Rebalance then claim — accruedPerformanceFee > 0, idleToken0 insufficient
   E) Claim then rebalance — both fee claim AND range fix needed

5. ACT — If you decided to act, invoke the tool using the EXACT commands above.
   If a transaction fails, log the error and stop. Do not retry.

6. REFLECT — Reply with a 2-3 line summary:
   - What data you gathered (pool state, uniswap signals, sentiment, Venice recommendation)
   - What Venice recommended (tick range, fee, confidence, key reasoning)
   - What you decided and why (reference specific numbers: spread, depth, TVL, sentiment)
   - If you acted, note the tx hash
   - If Venice was unavailable, note fallback to heuristic
   End with HEARTBEAT_OK if no alert is needed.
