# Filecoin Integration — Step-by-Step Implementation Plan

*Last updated: 2026-03-21*

*Depends on: Phase 4 (Venice, EigenCompute, uniswap-data all working)*

---

## Prerequisites

- Phase 4 complete (Venice, EigenCompute, uniswap-data all working)
- Agent heartbeat loop running with REFLECT phase producing logs
- Filecoin wallet funded with FIL + USDFC (see Token Requirements below)
- Base wallet funded with ETH (for ERC-8004 registration)
- Same private key works on both Filecoin and Base

### Token Requirements

| Network | Token | Purpose | Source |
|---|---|---|---|
| Filecoin Calibration | tFIL | Gas | [Chainsafe faucet](https://faucet.calibnet.chainsafe-fil.io) |
| Filecoin Calibration | USDFC (test) | Filecoin Pin storage | [USDFC faucet](https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc) |
| Filecoin Mainnet | FIL | Gas + LogRegistry deploy | Exchange or [USDFC Bridge](https://app.usdfc.net/#/bridge) |
| Filecoin Mainnet | USDFC | Filecoin Pin storage | [Sushi swap](https://www.sushi.com/filecoin/swap) or bridge |
| Base Sepolia | Sepolia ETH | ERC-8004 registration | [Alchemy faucet](https://www.alchemy.com/faucets/base-sepolia) |

---

## Step 1: Install Filecoin Pin CLI & Environment Setup

### 1a: Install filecoin-pin CLI

```bash
npm install -g filecoin-pin@latest
```

### 1b: Setup payment system

```bash
export PRIVATE_KEY=$FILECOIN_PRIVATE_KEY

# Testnet first
filecoin-pin payments setup --auto

# Mainnet (when ready for production)
filecoin-pin payments setup --auto --mainnet
```

This configures the wallet to pay for storage automatically with USDFC.
Only needs to run once per wallet.

### 1c: Update agent environment

**Add env vars to `agent/.env.example` and `agent/src/lib/config.ts`:**

- `FILECOIN_PRIVATE_KEY` — Private key (works on both Filecoin and Base)
- `LOG_REGISTRY_ADDRESS` — LogRegistry contract on Filecoin mainnet (after Step 5)
- `ERC8004_AGENT_ID` — Agent's ERC-8004 token ID (after Step 3)

**Files touched:**

- `agent/.env.example` — add vars under `# Phase 5: Filecoin` section
- `agent/src/lib/config.ts` — export new config values

---

## Step 2: Create Agent Card & Upload to Filecoin Pin

The agent's identity card is stored on Filecoin with PDP proofs, following
the official [Filecoin Pin for ERC-8004 tutorial](https://docs.filecoin.io/builder-cookbook/filecoin-pin/erc-8004).

### 2a: Create agent card JSON

Create `agent/data/agent-card.json`:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "CuratedLP Curator Agent",
  "description": "AI liquidity curator for Uniswap v4 wstETH/USDC vault. Uses Venice AI for market analysis, EigenCompute TEE for verifiable inference, and Filecoin for persistent execution logs.",
  "endpoints": [
    {
      "name": "agentWallet",
      "endpoint": "eip155:84532:<AGENT_SMART_ACCOUNT_ADDRESS>"
    }
  ],
  "registrations": [],
  "supportedTrust": ["reputation"]
}
```

### 2b: Upload to Filecoin Pin

```bash
# Testnet
filecoin-pin add --auto-fund agent/data/agent-card.json

# Mainnet
filecoin-pin add --auto-fund --mainnet agent/data/agent-card.json
```

**Save from output:** Root CID, Dataset ID.

### 2c: Verify IPFS retrieval

```bash
curl -s "https://ipfs.io/ipfs/<ROOT_CID>/agent-card.json" | jq .
```

### 2d: Verify PDP proof status

```bash
filecoin-pin data-set show <DATASET_ID>        # testnet
filecoin-pin data-set show <DATASET_ID> --mainnet  # mainnet
```

PDP proofs may take up to 24 hours to begin after upload.

**Files touched:**

- `agent/data/agent-card.json` (new)

---

## Step 3: Register on ERC-8004 Identity Registry (Base Sepolia)

### 3a: Register

```bash
export TOKEN_URI="ipfs://<ROOT_CID>/agent-card.json"
export IDENTITY_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"

cast send $IDENTITY_REGISTRY \
  "register(string)" \
  "$TOKEN_URI" \
  --rpc-url https://sepolia.base.org \
  --private-key $FILECOIN_PRIVATE_KEY
```

### 3b: Extract agent ID

```bash
export TX_HASH="0x..."  # from cast send output

AGENT_ID=$(cast receipt $TX_HASH --rpc-url https://sepolia.base.org --json \
  | jq -r '.logs[] | select(.topics[0] == "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") | .topics[3]' \
  | head -1 \
  | xargs cast --to-dec)
echo "Agent ID: $AGENT_ID"
```

### 3c: Verify registration

```bash
cast call $IDENTITY_REGISTRY \
  "tokenURI(uint256)" \
  $AGENT_ID \
  --rpc-url https://sepolia.base.org
```

Set `ERC8004_AGENT_ID` in `agent/.env` with the extracted token ID.

**Files touched:**

- `agent/.env` (record agent ID)

---

## Step 4: Define Types & Update Config

### 4a: Add ExecutionLog interface

**Add to `agent/src/lib/types.ts`:**

- `ExecutionLog` — agentId, timestamp, heartbeatNumber, poolState, uniswapData,
  sentiment, recommendation, eigencompute, decision, txHash, gasUsed
- `FilecoinStoreResult` — success, cid, datasetId, size, error

### 4b: Update config.ts

Add exports for `FILECOIN_PRIVATE_KEY`, `LOG_REGISTRY_ADDRESS`, `ERC8004_AGENT_ID`.

**Files touched:**

- `agent/src/lib/types.ts`
- `agent/src/lib/config.ts`

---

## Step 5: Build & Deploy LogRegistry.sol (FEVM)

### ⚠️ FEVM Requires a Separate Foundry Environment

Our root `foundry.toml` targets Base with `evm_version = "cancun"`.
FEVM does not support Cancun opcodes. The `fevm/` directory is cloned from
[fevm-foundry-kit](https://github.com/filecoin-project/fevm-foundry-kit)
with its own `foundry.toml` (solc 0.8.23, no evm_version set).

### 5a: Contract already written

`fevm/src/LogRegistry.sol` — records CIDs linked to ERC-8004 agent IDs.
Tests in `fevm/test/LogRegistry.t.sol` — 12 tests, all passing.

### 5b: Deploy to Calibration Testnet

```bash
cd fevm && forge create \
  --rpc-url https://api.calibration.node.glif.io/rpc/v1 \
  --private-key $FILECOIN_PRIVATE_KEY \
  --broadcast \
  src/LogRegistry.sol:LogRegistry
```

If tx receipt is empty but explorer shows success, check
https://calibration.filscan.io/ and retry with `--resume`.

### 5c: Test on Calibration

```bash
# Write a test log
cast send $LOG_REGISTRY_ADDRESS \
  "recordLog(uint256,string,uint256,string)" \
  $AGENT_ID "QmTestCid123" 42 "skip" \
  --rpc-url https://api.calibration.node.glif.io/rpc/v1 \
  --private-key $FILECOIN_PRIVATE_KEY

# Read it back
cast call $LOG_REGISTRY_ADDRESS \
  "getLog(uint256,uint256)" $AGENT_ID 0 \
  --rpc-url https://api.calibration.node.glif.io/rpc/v1
```

### 5d: Deploy to Mainnet

```bash
cd fevm && forge create \
  --rpc-url https://api.node.glif.io/rpc/v1 \
  --private-key $FILECOIN_PRIVATE_KEY \
  --broadcast \
  src/LogRegistry.sol:LogRegistry
```

Set `LOG_REGISTRY_ADDRESS` in `agent/.env`.

**FEVM deployment notes:**
- Block time is 30 seconds — deployments are slow
- `forge create` is more reliable than `forge script` on FEVM
- Some testnet deploys get empty receipts despite on-chain success

**Files touched:**

- `agent/.env` (record deployed address)

---

## Step 6: Build `filecoin-store.ts` — Filecoin Pin Upload

**Rewrite `agent/src/tools/filecoin-store.ts`:**

Replace Lighthouse SDK with Filecoin Pin CLI. The tool:

1. Writes the execution log JSON to a temp file
2. Shells out to `filecoin-pin add --auto-fund [--mainnet] <file>`
3. Parses the CLI output for Root CID and Dataset ID
4. Records the CID on-chain via `recordLogOnChain()` (viem → LogRegistry)
5. Returns `FilecoinStoreResult` with cid, datasetId, registryTxHash

### Key functions

- `storeExecutionLog(log)` — write file + call filecoin-pin CLI + parse output
- `recordLogOnChain(agentId, cid, heartbeat, decision)` — viem writeContract
- `retrieveExecutionLog(cid)` — fetch from IPFS gateway

### CLI mode

```
npx tsx src/tools/filecoin-store.ts --log '<ExecutionLog JSON>'
npx tsx src/tools/filecoin-store.ts --retrieve <CID>
```

**Files touched:**

- `agent/src/tools/filecoin-store.ts` (rewrite)
- `agent/package.json` (remove @lighthouse-web3/sdk, keep filecoin-store script)

---

## Step 7: Integrate into the REFLECT Phase

Wire `filecoin-store.ts` into the heartbeat loop.

### 7a: Build the ExecutionLog object

From data already in the heartbeat context:
- `poolState` from pool-reader
- `uniswapData` from uniswap-data
- `sentiment` + `recommendation` from eigencompute
- `eigencompute` attestation metadata
- `decision`, `txHash`, `gasUsed` from ACT phase

### 7b: Upload to Filecoin Pin

Call `storeExecutionLog(executionLog)` — writes JSON, shells to filecoin-pin, gets CID.

### 7c: Record CID on-chain

Call `recordLogOnChain(agentId, cid, heartbeat, decision)` on LogRegistry.

### 7d: Log results

Log CID + Dataset ID + Filecoin tx hash in cycle log.

### Error handling

Filecoin storage is **non-critical**. If filecoin-pin fails or the on-chain tx
fails, log the error but do NOT abort the heartbeat.

**Files touched:**

- `agent/workspace/SKILL.md` — add Filecoin storage to REFLECT phase
- `agent/workspace/HEARTBEAT.md` — add Filecoin step between REFLECT and DONE

---

## Step 8: Add Read/Query Functions for Frontend

**Create `agent/src/tools/filecoin-reader.ts`:**

- `getAgentLogs(agentId, count)` — viem readContract on LogRegistry
- `getFullLog(cid)` — fetch JSON from IPFS gateway
- `verifyPdpProof(datasetId)` — shell to `filecoin-pin data-set show`

**Files touched:**

- `agent/src/tools/filecoin-reader.ts` (new)

---

## Step 9: End-to-End Validation

Run 3+ full heartbeat cycles and verify:

| Check | How to Verify |
|---|---|
| Filecoin Pin upload succeeds | CID + Dataset ID returned, logged in `cycle.log` |
| IPFS retrieval works | `curl https://ipfs.io/ipfs/<CID>` returns valid JSON |
| JSON content correct | Pool state, sentiment, recommendation, decision match |
| LogRegistry records CID | `cast call getLog(agentId, 0)` — CID matches |
| LogRecorded event emitted | Check Filecoin explorer for event logs |
| `getLatestLogs` returns history | After 3 cycles, returns 3 entries in order |
| PDP proof active | `filecoin-pin data-set show <ID> --mainnet` → status: live |
| ERC-8004 identity linked | `cast call tokenURI(agentId)` → ipfs://CID/agent-card.json |
| Error resilience | Break filecoin-pin — heartbeat still completes |

---

## Step 10: Frontend Log Viewer (Phase 5 frontend)

Query LogRegistry from the frontend:

1. viem public client for Filecoin mainnet
2. `getLatestLogs(agentId, 20n)` for last 20 entries
3. For each entry, fetch JSON from `https://ipfs.io/ipfs/${entry.cid}`
4. Display: timestamp, decision, Venice reasoning, attestation hash, tx link
5. Link to ERC-8004 profile on Base via agent ID

---

## File Summary

| File | Action | Step |
|---|---|---|
| `agent/.env.example` | Edit — add Filecoin + ERC-8004 vars | 1 |
| `agent/src/lib/config.ts` | Edit — export new config values | 1, 4 |
| `agent/data/agent-card.json` | **New** — ERC-8004 agent card | 2 |
| `agent/src/lib/types.ts` | Edit — add ExecutionLog + FilecoinStoreResult | 4 |
| `fevm/src/LogRegistry.sol` | Already written | 5 |
| `fevm/test/LogRegistry.t.sol` | Already written (12 tests passing) | 5 |
| `agent/src/tools/filecoin-store.ts` | **Rewrite** — Filecoin Pin CLI + viem | 6 |
| `agent/package.json` | Edit — remove lighthouse dep | 6 |
| `agent/src/tools/filecoin-reader.ts` | **New** — query + verify functions | 8 |
| `agent/workspace/SKILL.md` | Edit — add Filecoin to REFLECT | 7 |
| `agent/workspace/HEARTBEAT.md` | Edit — add Filecoin step | 7 |

---

## Build Order

```
Step 1 (filecoin-pin setup)
     |
Step 2 (agent card upload) ──→ Step 3 (ERC-8004 registration)
     |
Step 4 (types + config)   ──→ Step 6 (filecoin-store.ts rewrite)
     |                              |
Step 5 (LogRegistry deploy) ──→ Step 7 (wire into REFLECT)
                                    |
                               Step 9 (e2e validation)
```

Steps 2-3 (agent registration) and 5 (LogRegistry deploy) can be done
**in parallel** with 4+6 (TypeScript tooling).

---

## Cost Estimates

| Item | Cost | Notes |
|---|---|---|
| Filecoin Pin upload (1-5 KB JSON) | ~0.07 USDFC | Per upload |
| Filecoin Pin payment deposit | 1 USDFC | One-time (covers ~372 GiB/month) |
| LogRegistry deployment | ~0.1-0.5 FIL gas | One-time |
| recordLog tx (per heartbeat) | ~0.001-0.01 FIL | Small calldata |
| ERC-8004 registration | ~0.001 Sepolia ETH | One-time (free testnet) |

---

## FEVM Technical Notes

- FEVM supports Solidity — most EVM contracts deploy with minimal adjustments
- **Do NOT use `evm_version = "cancun"`** — FEVM does not support Cancun opcodes
- Use the `fevm/` directory (cloned from fevm-foundry-kit) with solc 0.8.23
- Block time is 30 seconds — deployments are slow
- `forge create` is more reliable than `forge script` on FEVM
- Filecoin uses tipsets, not blocks — "block hash" maps to tipset hash
- Same private key works on Filecoin, Base, and any EVM chain

---

## Key Links

| Resource | URL |
|---|---|
| Filecoin Pin CLI docs | https://docs.filecoin.io/builder-cookbook/filecoin-pin/filecoin-pin-cli |
| Filecoin Pin + ERC-8004 tutorial | https://docs.filecoin.io/builder-cookbook/filecoin-pin/erc-8004 |
| ERC-8004 spec | https://eips.ethereum.org/EIPS/eip-8004 |
| ERC-8004 Registry (Base Sepolia) | https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e |
| Base Sepolia faucet | https://www.alchemy.com/faucets/base-sepolia |
| fevm-foundry-kit | https://github.com/filecoin-project/fevm-foundry-kit |
| FilecoinPin-for-ERC8004 repo | https://github.com/FilOzone/FilecoinPin-for-ERC8004 |
| Calibration faucet (tFIL) | https://faucet.calibnet.chainsafe-fil.io |
| Calibration faucet (USDFC) | https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc |
| USDFC Bridge (mainnet) | https://app.usdfc.net/#/bridge |
| Calibration explorer | https://calibration.filscan.io/ |
| Mainnet explorer | https://filscan.io/ |
