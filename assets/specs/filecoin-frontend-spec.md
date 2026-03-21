# Filecoin Log Viewer — Frontend Spec

*Last updated: 2026-03-21*

*For: Frontend teammate*

---

## What This Is

A UI component that displays the CuratedLP agent's full decision history
by reading from LogRegistry on Filecoin and fetching execution log JSONs
from IPFS. This is the "Curator Profile" — LPs can see every decision the
agent made, what data it saw, and verify it independently.

---

## Data Flow

```
LogRegistry (Filecoin Calibration)          IPFS
┌────────────────────────────┐              ┌──────────────────────┐
│ getLatestLogs(2200, 20)    │              │ Execution log JSON   │
│ → [ { cid, timestamp,     │  fetch CID   │ poolState, sentiment,│
│       heartbeat, decision }├─────────────→│ recommendation,      │
│     , ... ]                │              │ eigencompute, etc.   │
└────────────────────────────┘              └──────────────────────┘
```

1. Call `getLatestLogs(agentId, count)` on LogRegistry → array of `LogEntry`
2. For each entry, fetch full JSON from `https://ipfs.io/ipfs/{cid}`
3. Display the data

---

## Contract Details

| Field | Value |
|---|---|
| Contract | LogRegistry |
| Network | Filecoin Calibration (chain ID 314159) |
| Address | `0x7570588628Cb304D8ba3CB6156F466E44fB91636` |
| RPC | `https://api.calibration.node.glif.io/rpc/v1` |
| Agent ID | `2200` |

Will move to Filecoin mainnet (chain ID 314, RPC `https://api.node.glif.io/rpc/v1`)
for bounty submission. Address will change — make it configurable.

---

## ABI (only the read functions needed)

```typescript
const logRegistryAbi = [
  {
    name: "getLatestLogs",
    type: "function",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "count", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "cid", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
          { name: "decision", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "getLog",
    type: "function",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "cid", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "heartbeat", type: "uint256" },
          { name: "decision", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    name: "logCount",
    type: "function",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;
```

---

## Reading Logs (viem example)

```typescript
import { createPublicClient, http } from "viem";

const filecoinClient = createPublicClient({
  chain: {
    id: 314159, // Calibration. Use 314 for mainnet.
    name: "Filecoin Calibration",
    nativeCurrency: { name: "tFIL", symbol: "tFIL", decimals: 18 },
    rpcUrls: { default: { http: ["https://api.calibration.node.glif.io/rpc/v1"] } },
  },
  transport: http(),
});

// Get last 20 logs
const entries = await filecoinClient.readContract({
  address: "0x7570588628Cb304D8ba3CB6156F466E44fB91636",
  abi: logRegistryAbi,
  functionName: "getLatestLogs",
  args: [2200n, 20n],
});

// Fetch full JSON for each entry
for (const entry of entries) {
  const res = await fetch(`https://ipfs.io/ipfs/${entry.cid}`);
  const log = await res.json();
  // log contains: poolState, sentiment, recommendation, eigencompute, decision, etc.
}
```

---

## Execution Log JSON Shape

Each CID resolves to a JSON with this structure:

```typescript
interface ExecutionLog {
  agentId: string;              // "2200"
  timestamp: string;            // ISO 8601
  heartbeatNumber: number;
  poolState: {
    tickLower: number;
    tickUpper: number;
    totalLiquidity: string;
    currentFee: number;
    cumulativeVolume: string;
    cumulativeFeeRevenue: string;
    totalSwaps: number;
    idleToken0: string;
    idleToken1: string;
    accruedPerformanceFee: string;
    activeCuratorId: number;
    currentBlock: number;
  };
  uniswapData?: {               // null if uniswap-data failed
    forwardPrice: number;
    spread: number;
    spreadBps: number;
    priceImpact10x: number;
    priceImpactBps: number;
    // ... other fields
  };
  sentiment?: {                 // null if eigencompute failed
    sentiment: string;          // "bullish", "bearish", "moderately_bullish", etc.
    confidence: number;         // 0-1
    signals: string[];          // 3-5 market observations
    timestamp: string;
  };
  recommendation?: {            // null if eigencompute failed
    newTickLower: number;
    newTickUpper: number;
    newFee: number;
    confidence: number;         // 0-1
    reasoning: string;          // Venice AI's explanation
    dataSources: string[];
    missingData: string[];
    model: string;              // e.g. "zai-org-glm-4.7"
  };
  eigencompute?: {
    attestationHash: string;    // TEE content integrity hash
    computeJobId: string;
    verifiable: boolean;        // true = ran in TEE, false = fallback
  };
  decision: "rebalance" | "claim_fees" | "rebalance+claim" | "skip";
  rebalanceTxHash?: string;
  claimTxHash?: string;
  gasUsed?: number;
}
```

---

## UI Components

### 1. Log Timeline / Activity Feed

A chronological list of heartbeat entries. Each row shows:

| Field | Source | Display |
|---|---|---|
| Heartbeat # | `entry.heartbeat` | `#42` |
| Timestamp | `entry.timestamp` (on-chain, unix) | Relative time ("3 min ago") |
| Decision | `entry.decision` | Badge: green=rebalance, blue=claim, gray=skip |
| Confidence | `log.recommendation?.confidence` | Progress bar or percentage |
| Sentiment | `log.sentiment?.sentiment` | Color-coded label |
| Verifiable | `log.eigencompute?.verifiable` | Checkmark or warning icon |

Clicking a row expands to show the full detail view.

### 2. Log Detail View (expanded)

When a user clicks a log entry, show:

**Pool State**
- Tick range: `[tickLower, tickUpper]`
- Fee: `currentFee` (formatted as %)
- Liquidity: `totalLiquidity`
- Idle tokens: `idleToken0` / `idleToken1`

**Market Signals** (if uniswapData present)
- Forward price
- Spread (bps)
- Price impact (bps)

**AI Analysis** (if sentiment + recommendation present)
- Sentiment: label + confidence
- Signals: bullet list of `sentiment.signals`
- Recommendation: new tick range, new fee, confidence
- Reasoning: `recommendation.reasoning` (collapsible text block)

**Verification**
- Verifiable: yes/no badge
- Attestation hash: `eigencompute.attestationHash` (copyable)
- Compute job: `eigencompute.computeJobId`
- TEE provider: "EigenCompute"

**Action Taken**
- Decision: rebalance / claim / skip
- Rebalance tx: link to Base Sepolia explorer (`rebalanceTxHash`)
- Claim tx: link to Base Sepolia explorer (`claimTxHash`)
- Gas used

**Storage Proof**
- CID: `entry.cid` (copyable, link to IPFS gateway)
- Filecoin tx: link to Filecoin explorer (from LogRegistry event)

### 3. Summary Stats (top of page)

| Stat | Source |
|---|---|
| Total heartbeats | `logCount(2200)` |
| Rebalances | Count entries where `decision` contains "rebalance" |
| Claims | Count entries where `decision` contains "claim" |
| Verifiable % | Count where `eigencompute.verifiable === true` / total |
| Avg confidence | Mean of `recommendation.confidence` across entries |

---

## IPFS Gateway Fallbacks

IPFS retrieval can be slow. Try multiple gateways with a timeout:

```typescript
const GATEWAYS = [
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://gateway.pinata.cloud/ipfs/",
];

async function fetchLog(cid: string): Promise<ExecutionLog | null> {
  for (const gateway of GATEWAYS) {
    try {
      const res = await fetch(`${gateway}${cid}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return await res.json();
    } catch {
      continue;
    }
  }
  return null;
}
```

---

## Config (make these configurable, not hardcoded)

```typescript
const FILECOIN_CONFIG = {
  chainId: 314159,              // 314 for mainnet
  rpc: "https://api.calibration.node.glif.io/rpc/v1",  // glif.io/rpc/v1 for mainnet
  logRegistryAddress: "0x7570588628Cb304D8ba3CB6156F466E44fB91636",  // will change on mainnet
  agentId: 2200n,
};
```

---

## Edge Cases

- **No logs yet**: Show empty state with "No heartbeat logs recorded yet"
- **IPFS fetch fails**: Show the on-chain data (heartbeat, timestamp, decision, CID) with a "Full log unavailable" note and a retry button
- **eigencompute fields missing**: Some logs may have `eigencompute: null` if the TEE was down. Show "Unverified" badge
- **Old logs without new fields**: Early test logs may lack `rebalanceTxHash`/`claimTxHash` and have `txHash` instead. Handle both
- **Large log count**: Paginate — fetch 20 at a time using `getLatestLogs(agentId, 20)`. For older logs, use `getLog(agentId, index)` with offset math
