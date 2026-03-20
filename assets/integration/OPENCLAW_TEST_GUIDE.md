# OpenClaw Agent Test Guide

End-to-end guide for testing all 4 autonomous decision paths of the CuratedLP agent (Clio) via OpenClaw heartbeats.

---

## Overview

Clio runs on a 1-minute heartbeat via OpenClaw. Each heartbeat it:
1. Reads on-chain pool state via `pool-reader`
2. Applies decision rules from `workspace/HEARTBEAT.md`
3. Acts: claim fees, rebalance, both, or nothing

There are 4 test cases to verify.

---

## Prerequisites

**Contracts deployed** (Base Sepolia):
```
HOOK_ADDRESS=0xb1BD49Ea7b4F6CFB00cB66B9cBF3963F66935aC0
ENFORCER_ADDRESS=0x13229c622566Fa496E891D9EB0D11FE25A9EA006
```

**`agent/.env` must have:**
```
CURATOR_PRIVATE_KEY=...
MOLTBOT_PRIVATE_KEY=...
BASE_SEPOLIA_RPC=...
PIMLICO_API_KEY=...
HOOK_ADDRESS=...
ENFORCER_ADDRESS=...
```

**Curator registered** — the curator Smart Account must have called `registerCurator()` on the hook before delegation-based actions work. Run once:
```bash
cd agent
npx tsx src/delegation.ts
```
This registers the curator and does an initial rebalance. If it times out, top up the Smart Account's EntryPoint deposit first:
```bash
# Check SA address (printed by delegation.ts)
cast send <ENTRYPOINT_ADDRESS> "depositTo(address)" <SMART_ACCOUNT> \
  --value 0.005ether \
  --private-key $CURATOR_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC
```
Entrypoint on Base Sepolia: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

---

## Setup: Start the Gateway

```bash
openclaw gateway
```

Check it's running:
```bash
ps aux | grep openclaw-gateway
```

Add the heartbeat cron (fires every 1 minute):
```bash
openclaw cron add \
  --agent curatedlp \
  --every 1m \
  --name "curatedlp-heartbeat" \
  --system-event "heartbeat" \
  --session main \
  --timeout-seconds 300 \
  --thinking low
```

Verify:
```bash
openclaw cron list
```

---

## Tools (all run from `agent/` directory)

| Tool | Command | Purpose |
|------|---------|---------|
| pool-reader | `npx tsx src/tools/pool-reader.ts` | Read on-chain pool state |
| claim-fees | `npx tsx src/tools/claim-fees.ts` | Claim accrued performance fees |
| execute-rebalance | `npx tsx src/tools/execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee <N>` | Rebalance LP position |
| do-swap | `npx tsx src/tools/do-swap.ts` | Execute a test swap (generates fee revenue) |

---

## Test Cases

### Test Case A — Do Nothing

**Condition:** `accruedPerformanceFee == 0`, position healthy (not full range)

**Setup:** Just start the gateway with 0 fees accrued (fresh deployment or right after a claim).

**Expected agent output:**
```
No changes. All clear.
HEARTBEAT_OK
```

---

### Test Case B — Claim Fees (direct)

**Condition:** `accruedPerformanceFee > 0` AND `idleToken0 >= accruedPerformanceFee`

**Setup:**
```bash
# Generate fees with a few swaps
npx tsx src/tools/do-swap.ts
npx tsx src/tools/do-swap.ts
npx tsx src/tools/do-swap.ts
```

Wait for next heartbeat (~1 min). Agent sees fees, claims directly.

**Expected agent output:**
```
New swaps detected. accruedPerformanceFee = Xe18, idleToken0 sufficient to claim directly.
[calls claim-fees.ts]
Claimed accrued performance fee successfully (tx 0x...).
HEARTBEAT_OK
```

**Verify:** `idleToken0` drops by exactly `accruedPerformanceFee` in next pool-reader read.

---

### Test Case C — Rebalance

**Condition:** Range is full range `[-887220, 887220]` OR idle tokens clearly imbalanced

**Setup:**
```bash
# Rebalance to full range manually
npx tsx src/tools/execute-rebalance.ts --tickLower -887220 --tickUpper 887220 --fee 3000
```

Wait for next heartbeat. Agent detects full range, rebalances to tighter range around current tick.

**Expected agent output:**
```
Position is full range [-887220, 887220] — rebalancing to tighter range.
[calls execute-rebalance.ts --tickLower <N> --tickUpper <N> --fee 3000]
Rebalanced to [-600, 600]. Position healthy.
HEARTBEAT_OK
```

**Note:** If `RebalanceTooFrequent` (enforcer 30-block rate limit), agent skips and retries next heartbeat.

---

### Test Case D — Rebalance then Claim

**Condition:** `accruedPerformanceFee > 0` AND `idleToken0 < accruedPerformanceFee` (no idle token0 to pay fee from)

**Why this happens:** After a rebalance, all token0 is deployed as liquidity. The hook has 0 idle token0 even though fees are tracked. To claim, the hook must first remove liquidity (collecting LP fees), reserve the performance fee, then re-deploy.

**Setup:**
```bash
# 1. Run swaps to accrue fees
npx tsx src/tools/do-swap.ts
npx tsx src/tools/do-swap.ts

# 2. Rebalance (this deploys all liquidity, leaving idleToken0 ~= reserved fee)
npx tsx src/tools/execute-rebalance.ts --tickLower -1200 --tickUpper 1200 --fee 3000

# 3. Run more swaps — pushes accruedFee above idleToken0
npx tsx src/tools/do-swap.ts
npx tsx src/tools/do-swap.ts
npx tsx src/tools/do-swap.ts
# ... (need enough swaps that new accruedFee > current idleToken0)
```

Wait for next heartbeat. Agent detects `accruedFee > idleToken0` → rebalances first to collect LP fees → then claims.

**Expected agent output:**
```
accruedPerformanceFee > idleToken0 — rebalancing first to collect LP fees.
[calls execute-rebalance.ts]
Rebalance complete. idleToken0 now sufficient.
[calls claim-fees.ts]
Claimed performance fee successfully (tx 0x...).
HEARTBEAT_OK
```

---

## Reading the Session Logs

```bash
# Find current session file
ls ~/.openclaw/agents/curatedlp/sessions/

# Watch live logs
openclaw logs | tail -50

# Parse session messages
python3 -c "
import json
lines = open('~/.openclaw/agents/curatedlp/sessions/<SESSION_ID>.jsonl').readlines()
for line in lines:
    d = json.loads(line)
    if d.get('type') == 'message':
        msg = d.get('message', {})
        role = msg.get('role', '?')
        content = msg.get('content', '')
        if isinstance(content, list):
            for c in content:
                if c.get('type') == 'text':
                    print(f'{role}: {c[\"text\"][:300]}')
                elif c.get('type') == 'tool_result':
                    cnt = c.get('content','')
                    if isinstance(cnt, list):
                        for x in cnt:
                            print(f'RESULT: {x.get(\"text\",\"\")[:300]}')
"
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `RebalanceTooFrequent` (0x4011a0ba) | Enforcer 30-block rate limit | Wait ~1 min, try again |
| `InsufficientHookBalance` | idleToken0 < accruedFee | Rebalance first to collect LP fees |
| `Arithmetic overflow` (claim-fees) | Old hook bug — hook has 0 token0 | Fixed in current deployment: rebalance() reserves fee before redeploying |
| UserOp rejected by Pimlico | SA EntryPoint deposit too low | Top up via `cast send entryPoint.depositTo(SA) --value 0.005ether` |
| `ERR_MODULE_NOT_FOUND` | Wrong filename in agent command | Use EXACT filenames: `execute-rebalance.ts`, not `rebalance.ts` |
| Session corrupted / empty lines | OpenClaw session repair failed | Delete session file + sessions.json ref, gateway will create a new one |
| No heartbeats firing | Cron job lost on gateway restart | Re-add cron with `openclaw cron add ...` |

---

## Resetting State

**Clear the agent session** (forces a fresh start next heartbeat):
```bash
rm ~/.openclaw/agents/curatedlp/sessions/<SESSION_ID>.jsonl
python3 -c "
import json
data = json.load(open('~/.openclaw/agents/curatedlp/sessions/sessions.json'))
del data['agent:curatedlp:main']
json.dump(data, open('~/.openclaw/agents/curatedlp/sessions/sessions.json', 'w'))
"
```

**Restart the gateway:**
```bash
kill <PID>           # kill old gateway
openclaw gateway     # start fresh
openclaw cron add ... # re-add heartbeat cron
```
