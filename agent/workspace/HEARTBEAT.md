# Heartbeat Checklist — Phase 4

**CRITICAL: You MUST execute ALL 6 steps in order every heartbeat. NEVER skip Steps 1 or 2.
Even if you think nothing needs to change, you MUST run pool-reader, uniswap-data,
and eigencompute BEFORE making any decision. The ANALYZE step provides market intelligence
that may reveal conditions invisible from pool state alone.**

**TIMEOUTS: eigencompute calls the EigenCompute TEE which runs two Venice API calls (sentiment
+ analysis) — this needs 90-120 seconds total. Use timeout: 120 for eigencompute. Use timeout: 60
for uniswap-data. Use timeout: 30 for all others. eigencompute prints keepalive pings every 15s —
if you see keepalive output, the process IS working. Do NOT kill it while pings are appearing.
Wait the full 120s timeout. Only kill if 120s has truly elapsed with no output at all.**

## Available tools (use EXACT commands below, no others exist)

### OBSERVE
- pool-reader:    npx tsx ../src/tools/pool-reader.ts

### ANALYZE
- uniswap-data:   npx tsx ../src/tools/uniswap-data.ts
- eigencompute:   npx tsx ../src/tools/eigencompute.ts --pool '<pool-reader JSON>' --uniswap '<uniswap-data JSON>'
- venice-analyze: npx tsx ../src/tools/venice-analyze.ts --mode <sentiment|analyze> [--pool '<json>'] [--uniswap '<json>'] [--sentiment '<json>']  (FALLBACK ONLY — eigencompute handles this via TEE)

### ACT
- rebalance:      npx tsx ../src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>
- claim fees:     npx tsx ../src/tools/claim-fees.ts

### STORE (Filecoin)
- filecoin-store:  npx tsx ../src/tools/filecoin-store.ts --log '<ExecutionLog JSON>'

---

## Step 1 — OBSERVE

Run pool-reader. Read its output.

```
npx tsx ../src/tools/pool-reader.ts
```

If pool-reader fails → abort the heartbeat entirely. No pool state = no decisions.

---

## Step 2 — ANALYZE

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

b) Run eigencompute — this calls the EigenCompute TEE which runs BOTH Venice calls
(sentiment with web search ON, then analysis with web search OFF) inside Intel TDX:
```
npx tsx ../src/tools/eigencompute.ts \
  --pool '<pool-reader JSON>' \
  --uniswap '<uniswap-data JSON>'
```
Pass whatever data you have — omit --uniswap if uniswap-data failed.

Returns: newTickLower, newTickUpper, newFee, confidence, reasoning, sentiment,
attestationHash, computeJobId, verifiable.

If the TEE is down, eigencompute automatically falls back to calling Venice directly.
The output will have verifiable=false — note this in your REFLECT step.

If eigencompute fails entirely, fall back to the simple heuristic in RULE 2 (Step 3).

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

**Primary: eigencompute recommendation (Venice AI via EigenCompute TEE)**

If eigencompute returned a recommendation with confidence >= 0.6 AND the recommended
parameters differ meaningfully from current state:
→ Use eigencompute's newTickLower, newTickUpper, newFee.
→ Log attestationHash and verifiable status in REFLECT.

**Fallback: Phase 3 simple heuristic (only if eigencompute unavailable or confidence < 0.6)**

Rebalance if ANY of:
- Range is full range [-887220, 887220] — tighten to ~[-6000, 6000]
- idleToken0 and idleToken1 are clearly imbalanced (position may be out-of-range)

For tick choice:
- Keep current range or shift by one tick spacing (60) toward the imbalance

For fee choice:
- Keep currentFee or adjust by 500 bps max, within delegation bounds [100, 50000]

Constraint: Cannot rebalance more than once per 30 blocks. If "RebalanceTooFrequent" → skip silently.

### RULE 3 — DO NOTHING
Only if:
- accruedPerformanceFee == 0
- eigencompute confidence is below 0.6 (or unavailable and Phase 3 heuristic shows no issue)
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
- What uniswap-data showed (spread, depth, TVL — if available)
- What eigencompute recommended (tick range, fee, confidence, sentiment — if available)
- Whether inference was verifiable (attestationHash present, verifiable=true/false)
- What you decided and why

End with HEARTBEAT_OK if no alert needed, or HEARTBEAT_ALERT: <reason> if something is wrong
(e.g. pool-reader failed, transaction reverted unexpectedly, TEE down).

---

## Step 7 — STORE (Filecoin)

After REFLECT, store the execution log on Filecoin for the immutable audit trail.
Build a JSON object with all heartbeat data, then call filecoin-store:

```
npx tsx ../src/tools/filecoin-store.ts --log '{
  "agentId": "2200",
  "timestamp": "<ISO 8601 now>",
  "heartbeatNumber": <cycle number>,
  "poolState": <pool-reader output>,
  "uniswapData": <uniswap-data output or null>,
  "sentiment": <eigencompute sentiment or null>,
  "recommendation": <eigencompute recommendation or null>,
  "eigencompute": {
    "attestationHash": "<from eigencompute>",
    "computeJobId": "<from eigencompute>",
    "verifiable": <true/false>
  },
  "decision": "<rebalance|claim_fees|rebalance+claim|skip>",
  "rebalanceTxHash": "<rebalance tx hash or null>",
  "claimTxHash": "<claim tx hash or null>",
  "gasUsed": <total gas used or null>
}'
```

This uploads the log to Filecoin via Filecoin Pin (with PDP proofs) and records
the CID in LogRegistry on Filecoin. Returns JSON with `cid`, `datasetId`, and
`registryTxHash`.

**This step is non-critical.** If filecoin-store fails, log the error but do NOT
abort the heartbeat or retry. The agent's primary job (rebalancing) is already done.

Include the Filecoin CID in your REFLECT summary if the upload succeeded.

---

## Step 8 — DONE

Stop. Wait for next heartbeat.
