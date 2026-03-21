# Phase 5 Implementation Plan — Filecoin + ENS + Frontend

## Filecoin Agentic Storage + ENS Identity + Frontend

*Last updated: 2026-03-21*

*Depends on: Phase 4 (Venice, EigenCompute, uniswap-data all working)*

---

## What This Phase Adds

Phase 4 gives the agent intelligence (Venice), data (Uniswap + DeFiLlama),
and verifiability (EigenCompute). Phase 5 adds **persistence** (Filecoin),
**human-readable identity** (ENS), and the **user-facing frontend**.

| Component | Bounty | Purpose |
|---|---|---|
| Filecoin execution logs | $1,000 / $700 / $300 | Immutable audit trail of every agent decision |
| ENS identity | $400 / $200 | Human-readable name for the curator agent |
| Frontend | — | LP deposit/withdraw UI, curator dashboard |

**Bounty targets from Phase 5:** Filecoin ($1,000) + ENS ($400) = $1,400.
Combined with Phase 4 bounties = **$22,150+ total** (excluding Open Track).

---

## 1. Filecoin Onchain Cloud — Agentic Storage (RFS-2)

### Why Filecoin?

Every heartbeat, the agent generates:
- Venice sentiment analysis (Call #1 output)
- Venice recommendation (Call #2 output)
- EigenCompute attestation hash
- Rebalance tx hash (if acted)
- Pool state snapshot

Currently these are logged locally. With Filecoin, they become an
**immutable, decentralized audit trail** that anyone can query using
the agent's ERC-8004 identity. This directly addresses RFS-2:

> "Deploy AI agents as first-class onchain citizens via ERC-8004,
> with persistent state and execution logs on Filecoin."

### What Gets Stored

Each heartbeat produces a JSON execution log:

```json
{
  "agentId": "<ERC-8004 token ID>",
  "timestamp": "2026-03-21T14:30:00Z",
  "heartbeatNumber": 42,
  "phase": "REFLECT",
  "poolState": {
    "currentTick": -201840,
    "tickLower": -202200,
    "tickUpper": -201400,
    "totalLiquidity": "50000000",
    "currentFee": 3000
  },
  "uniswapData": {
    "forwardPrice": 3412.50,
    "spread": 0.0008,
    "priceImpact10x": 0.0012,
    "requestIds": ["req_1", "req_2", "req_3", "req_4"]
  },
  "defiLlama": {
    "lidoTvl": 14200000000,
    "tvlChange24h": -1.3,
    "poolYield": 4.2
  },
  "sentiment": {
    "sentiment": "moderately_bullish",
    "confidence": 0.72,
    "signals": ["Lido V3 governance vote passing", "whale accumulation"]
  },
  "recommendation": {
    "tickLower": -202080,
    "tickUpper": -201480,
    "fee": 3500,
    "confidence": 0.82,
    "reasoning": "Spread tight, depth good, bullish sentiment..."
  },
  "eigencompute": {
    "attestationHash": "0xabc123...",
    "computeJobId": "job_xyz",
    "verifiable": true
  },
  "decision": "rebalance",
  "txHash": "0xdef456...",
  "gasUsed": 245000
}
```

### Architecture & Implementation

Two-path storage for a strong bounty submission:

1. **Lighthouse SDK** — uploads JSON to IPFS + Filecoin storage deal
2. **LogRegistry.sol** — FEVM smart contract on Filecoin mainnet
   recording CIDs linked to the agent's ERC-8004 identity

```
  Agent heartbeat completes (REFLECT phase)
       |
       | Serialize execution log to JSON
       v
  filecoin-store.ts (NEW tool)
       |
       +--→ Lighthouse SDK → IPFS + Filecoin deal → CID
       |
       +--→ LogRegistry.sol (Filecoin mainnet, chain 314)
       |     recordLog(agentId, cid, heartbeat, decision)
       v
  Anyone can: query LogRegistry → get CIDs → fetch logs from IPFS
```

**Full implementation details in `assets/integration/filecoin.md`**, including:
- `filecoin-store.ts` — Lighthouse upload + on-chain recording
- `LogRegistry.sol` — Solidity contract with deployment scripts
- Hardhat config for Filecoin mainnet (chain 314) and Calibration testnet (chain 314159)
- Frontend integration for querying and displaying decision history
- Cost estimates and faucet links

### Key Deliverables

| Deliverable | Purpose |
|---|---|
| `filecoin-store.ts` | CLI tool: uploads execution log JSON via Lighthouse, records CID in LogRegistry |
| `LogRegistry.sol` | FEVM contract on Filecoin mainnet: indexes CIDs by ERC-8004 agent ID |
| Hardhat deploy script | Deploys LogRegistry to Calibration then mainnet |
| Frontend log viewer | Queries LogRegistry, fetches JSONs from IPFS gateway |

### SKILL.md Update

Add to the REFLECT phase:

```
REFLECT:
  After logging cycle results locally, store the execution log
  on Filecoin via Lighthouse SDK. Then record the CID in the
  LogRegistry contract on Filecoin mainnet, linked to your
  ERC-8004 agent ID. This creates an immutable, decentralized
  audit trail that LPs can independently verify.
```

### Verification

- [ ] Lighthouse SDK installed, API key configured
- [ ] LogRegistry deployed to Filecoin Calibration (test)
- [ ] LogRegistry deployed to Filecoin mainnet (chain 314)
- [ ] Run 3+ heartbeat cycles
- [ ] Each heartbeat produces a Lighthouse CID
- [ ] Each CID recorded in LogRegistry on-chain
- [ ] Retrieve logs via `https://gateway.lighthouse.storage/ipfs/<CID>`
- [ ] Frontend queries LogRegistry and displays decision history
- [ ] Demo: ERC-8004 agent → LogRegistry → CIDs → full execution logs

---

## 2. ENS Identity

### Agent ENS Name

Register an ENS name for the curator agent (e.g., `curatedlp-curator.eth`
or a subname under a domain you own). Set the agent's Smart Account
address as the ENS resolver target.

**Integration points:**

1. **ERC-8004 registration metadata** — include ENS name in the agent's
   registration JSON, so the identity registry links to a human-readable name
2. **Frontend** — resolve the curator's ENS name instead of showing
   a hex address. LPs see "curatedlp-curator.eth" as the vault manager.
3. **Filecoin logs** — include ENS name in execution logs for easy lookup

### Implementation

```typescript
// Agent setup (one-time)
// 1. Register ENS name (or use existing)
// 2. Set Smart Account address as resolver
// 3. Include in ERC-8004 registration metadata:
{
  "name": "CuratedLP Curator",
  "ens": "curatedlp-curator.eth",
  "services": [...]
}
```

### Frontend ENS Integration

```typescript
// Resolve curator identity
import { normalize } from 'viem/ens'

const curatorAddress = await publicClient.getEnsAddress({
  name: normalize('curatedlp-curator.eth'),
})

const curatorAvatar = await publicClient.getEnsAvatar({
  name: normalize('curatedlp-curator.eth'),
})

// Display in UI: curator name, avatar, linked address
```

### Verification

- ENS name resolves to the curator's Smart Account address
- Frontend shows ENS name instead of hex address
- ERC-8004 metadata includes ENS reference

---

## 3. Frontend

### Overview

The frontend serves two audiences:
- **LPs (depositors):** deposit/withdraw tokens, view share balance, track performance
- **Observers:** view curator identity, performance history, decision logs

### Pages

1. **Vault Dashboard** — pool stats, TVL, current tick range, fee, curator identity (ENS)
2. **Deposit/Withdraw** — token input, share calculation, slippage settings
3. **Curator Profile** — ERC-8004 identity, ENS name, performance history,
   Filecoin decision log viewer, EigenCompute attestation verification
4. **Activity Feed** — recent rebalances, fee claims, with tx links

### Tech Stack

Based on frontend-spec.md (existing). ENS integration via viem's built-in
ENS resolution. Filecoin log viewer fetches JSONs by CID.

---

## Build Order

```
  Phase 4 complete (all tools working)
       |
       +--→ filecoin-store.ts (Filecoin integration)
       +--→ ENS registration (one-time setup)
       +--→ Frontend development
       |
       | All can be done in parallel
       |
       v
  Update SKILL.md (add filecoin-store to REFLECT phase)
       |
       v
  End-to-end test (full heartbeat with Filecoin storage)
       |
       v
  Phase 5 complete
```

### Recommended Sequence

| Step | What | Depends on | Bounty |
|---|---|---|---|
| 1 | ENS name registration | Nothing | ENS ($400) |
| 2 | filecoin-store.ts | Phase 4 REFLECT logs | Filecoin ($1,000) |
| 3 | Frontend (vault dashboard + deposit/withdraw) | Phase 1-3 contracts | — |
| 4 | Frontend ENS integration | Step 1 | ENS ($400) |
| 5 | Frontend Filecoin log viewer | Step 2 | Filecoin ($1,000) |
| 6 | Frontend curator profile (ERC-8004 + ENS + attestations) | Steps 1, 2 | ERC-8004 ($2,000) |
| 7 | Update SKILL.md + e2e test | Steps 1-2 | — |

Steps 1, 2, and 3 can all be built in parallel.

---

## Bounty Alignment — Final Track List

| Track | Sponsor | Prize (1st) | Phase |
|---|---|---|---|
| Private Agents, Trusted Actions | Venice | $5,750 | Phase 4 |
| Best Use of Delegations | MetaMask | $3,000 | Phase 1-3 |
| Best Use of EigenCompute | EigenCloud | $3,000 | Phase 4 |
| Agentic Finance (Best Uniswap API Integration) | Uniswap | $2,500 | Phase 4 |
| Agents With Receipts — ERC-8004 | Protocol Labs | $2,000 | Phase 4 + 5 |
| Let the Agent Cook | Protocol Labs | $2,000 | Phase 4 |
| Best Use Case with Agentic Storage | Filecoin | $1,000 | Phase 5 |
| ENS Identity | ENS | $400 | Phase 5 |
| Synthesis Open Track | Community | $28,309 | All |

**Total addressable (1st place): $51,959**

---

## Dropped Tracks (with reasons)

| Track | Sponsor | Prize | Reason Dropped |
|---|---|---|---|
| Best Use of Locus | Locus | $3,000 | No paid services to route through Locus after Olas dropped |
| Hire Agent on Olas Marketplace | Olas | $500 | No USDC-paying mech with analysis tools on Base |
| Monetize Agent on Olas Marketplace | Olas | $500 | Dropped with Olas |
| Autonomous Trading Agent | Base | $1,667 | CuratedLP manages liquidity, not a trading agent |
| Agent Services on Base | Base | $1,667 | Exposing x402 service is additional scope, not core |
| Best Self Agent ID Integration | Self | $1,000 | Would need Self Protocol ZK integration — not enough time |
| Ship Something Real with OpenServ | OpenServ | $2,500 | Core agent runs on OpenClaw, not OpenServ SDK |
| Best Bankr LLM Gateway Use | Bankr | $3,000 | No self-sustaining economics — agent revenue is from hook, not Bankr |
| Merit Systems / AgentCash | Merit | — | Pulled from hackathon entirely |
