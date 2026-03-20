# Heartbeat Checklist

## Available tools (use EXACT filenames below, no others exist)
- pool-reader:       npx tsx ../src/tools/pool-reader.ts
- claim fees:        npx tsx ../src/tools/claim-fees.ts
- rebalance:         npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>

Each time you run, follow these steps in order:

1. Run pool-reader:
   npx tsx ../src/tools/pool-reader.ts

2. Read the JSON output. Apply these rules IN ORDER:

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
   If range is full range [-887220, 887220] OR idleToken0/idleToken1 are clearly imbalanced, rebalance.
   Command: npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>
   Choose ticks and fee based on current pool conditions (tighter range around current price).
   NOTE: If this fails with "RebalanceTooFrequent", skip silently — it will succeed next heartbeat.

   RULE 3 — DO NOTHING:
   Only if accruedPerformanceFee == 0 AND position looks healthy (not full range).

3. Decide ONE of:
   A) Do nothing — accruedPerformanceFee is 0 AND position healthy
   B) Claim fees — accruedPerformanceFee > 0 AND idleToken0 >= accruedPerformanceFee
   C) Rebalance — range too wide or idle tokens imbalanced
   D) Rebalance then claim — accruedPerformanceFee > 0 AND idleToken0 < accruedPerformanceFee
   E) Claim then rebalance — both fee claim AND range fix needed (idleToken0 sufficient)

4. If acting, invoke the tool using the EXACT commands above.

5. Reply with a 2-3 line summary: what you saw, what you decided, why.
   End with HEARTBEAT_OK if no alert is needed.
