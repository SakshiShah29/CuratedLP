# Filecoin Integration — CuratedLP Execution Log Storage

*Last updated: 2026-03-21*

*Bounty: Best Use Case with Agentic Storage ($1,000 / $700 / $300)*
*RFS-2: Onchain Agent Registry with Filecoin-Backed State*

---

## Why Filecoin?

Every heartbeat, the CuratedLP agent generates execution data — Venice
reasoning, EigenCompute attestations, rebalance decisions, pool state
snapshots. Storing this on Filecoin creates an **immutable, decentralized
audit trail** linked to the agent's ERC-8004 identity.

LPs can independently verify: what data the agent saw, what Venice
recommended, whether the TEE attestation is valid, and what action
was taken — all without trusting the agent's local logs.

Unlike generic IPFS pinning (Lighthouse, Pinata), **Filecoin Pin** provides
**cryptographic PDP (Provable Data Possession) proofs** — daily on-chain
verification that the data is actually stored. This is the difference
between "trust a service provider" and "verify on-chain."

This addresses Filecoin RFS-2:
> "Deploy AI agents as first-class onchain citizens via ERC-8004,
> with persistent state and execution logs on Filecoin."

---

## Architecture

```
  ONE-TIME SETUP:
  ───────────────
  1. Create agent card JSON (ERC-8004 spec)
  2. filecoin-pin add --mainnet agent-card.json → CID + Dataset ID
  3. cast send IdentityRegistry.register("ipfs://<CID>/agent-card.json")
     on Base Sepolia → ERC-8004 NFT minted (agent ID)
     Registry: 0x8004A818BFB912233c491871b3d84c89A494BD9e

  EVERY HEARTBEAT (REFLECT phase):
  ─────────────────────────────────
  1. Serialize execution log to JSON
  2. filecoin-pin add --mainnet execution-log.json → CID + Dataset ID
     (PDP proofs begin within 24h — cryptographic proof of storage)
  3. LogRegistry.recordLog(agentId, cid, heartbeat, decision)
     on Filecoin mainnet (FEVM, chain 314) — on-chain CID index

  VERIFICATION (anyone):
  ──────────────────────
  1. Query LogRegistry on Filecoin → get CIDs for agent
  2. Fetch execution log from IPFS gateway → verify contents
  3. filecoin-pin data-set show <ID> --mainnet → verify PDP proofs
  4. Cross-reference agent ID → ERC-8004 IdentityRegistry on Base
```

---

## Storage Layer: Filecoin Pin

Filecoin Pin is the official Filecoin storage tool with cryptographic proof
guarantees. It replaces Lighthouse in our architecture.

| Feature | Lighthouse | Filecoin Pin |
|---|---|---|
| Storage proof | None (trust provider) | **Cryptographic PDP proofs** (daily) |
| Payment | Free tier / API key | **USDFC on-chain payments** |
| Mainnet | Yes but opaque | **Yes, `--mainnet` flag** |
| IPFS compatible | Yes | Yes |
| Bounty alignment | Weak | **Strong** (real Filecoin deals + proofs) |

### Setup

```bash
npm install -g filecoin-pin@latest
```

### Environment Variables

```bash
# Same private key works on both Filecoin and Base (EVM-compatible)
FILECOIN_PRIVATE_KEY=0x...
```

### One-Time Payment Setup

```bash
export PRIVATE_KEY=$FILECOIN_PRIVATE_KEY

# Testnet (Calibration)
filecoin-pin payments setup --auto

# Mainnet
filecoin-pin payments setup --auto --mainnet
```

Requires tFIL + USDFC (testnet) or FIL + USDFC (mainnet).

### Upload Execution Log

```bash
# Write execution log to temp file, upload to Filecoin
filecoin-pin add --auto-fund --mainnet execution-log.json
```

Returns: Root CID, Dataset ID, Piece CID, Provider info.

### Verify PDP Proofs

```bash
filecoin-pin data-set show <DATASET_ID> --mainnet
```

Shows: status (live), provider, PDP rail, piece CIDs, proof schedule.

### Retrieval

Stored logs are accessible via any IPFS gateway:
- `https://ipfs.io/ipfs/<CID>/execution-log.json`
- `https://gateway.pinata.cloud/ipfs/<CID>/execution-log.json`
- `https://cloudflare-ipfs.com/ipfs/<CID>/execution-log.json`
- Direct from storage provider URL (returned by filecoin-pin)

---

## ERC-8004 Agent Registration with Filecoin Pin

The agent's identity card is stored on Filecoin with PDP proofs, then
registered on-chain as an ERC-8004 NFT. This follows the official
[Filecoin Pin for ERC-8004 tutorial](https://docs.filecoin.io/builder-cookbook/filecoin-pin/erc-8004).

### ERC-8004 Identity Registry Address

| Network | Address |
|---|---|
| Base Sepolia | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |

### Agent Card JSON

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "CuratedLP Curator Agent",
  "description": "AI liquidity curator for Uniswap v4 wstETH/USDC vault. Uses Venice AI for market analysis, EigenCompute TEE for verifiable inference, and Filecoin for persistent execution logs.",
  "image": "https://example.com/curatedlp-agent.png",
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

### Registration Flow

```bash
# 1. Upload agent card to Filecoin (mainnet for persistent storage)
filecoin-pin add --auto-fund --mainnet agent-card.json
# → Root CID: bafybeiabc123...

# 2. Register on ERC-8004 Identity Registry (Base Sepolia)
export TOKEN_URI="ipfs://<ROOT_CID>/agent-card.json"
export IDENTITY_REGISTRY="0x8004A818BFB912233c491871b3d84c89A494BD9e"

cast send $IDENTITY_REGISTRY \
  "register(string)" \
  "$TOKEN_URI" \
  --rpc-url https://sepolia.base.org \
  --private-key $FILECOIN_PRIVATE_KEY

# 3. Extract agent ID from tx receipt
AGENT_ID=$(cast receipt $TX_HASH --rpc-url https://sepolia.base.org --json \
  | jq -r '.logs[] | select(.topics[0] == "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef") | .topics[3]' \
  | head -1 \
  | xargs cast --to-dec)
echo "Agent ID: $AGENT_ID"
```

---

## On-Chain Log Index: LogRegistry.sol (FEVM)

A Solidity contract deployed on **Filecoin mainnet** (chain ID 314) that
records CIDs linked to the agent's ERC-8004 identity. Provides an on-chain
index so anyone can discover all execution logs for a given agent.

Deployed using the [fevm-foundry-kit](https://github.com/filecoin-project/fevm-foundry-kit)
in the `fevm/` directory (separate Foundry environment — FEVM does not
support Cancun opcodes).

### LogRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract LogRegistry {
    struct LogEntry {
        string cid;
        uint256 timestamp;
        uint256 heartbeat;
        string decision;
    }

    mapping(uint256 => LogEntry[]) public logs;
    mapping(uint256 => uint256) public logCount;

    event LogRecorded(
        uint256 indexed agentId,
        uint256 indexed heartbeat,
        string cid,
        string decision,
        uint256 timestamp
    );

    function recordLog(
        uint256 agentId,
        string calldata cid,
        uint256 heartbeat,
        string calldata decision
    ) external {
        logs[agentId].push(LogEntry({
            cid: cid,
            timestamp: block.timestamp,
            heartbeat: heartbeat,
            decision: decision
        }));
        logCount[agentId]++;
        emit LogRecorded(agentId, heartbeat, cid, decision, block.timestamp);
    }

    function getLog(uint256 agentId, uint256 index)
        external view returns (LogEntry memory)
    {
        require(index < logs[agentId].length, "Index out of bounds");
        return logs[agentId][index];
    }

    function getLatestLogs(uint256 agentId, uint256 count)
        external view returns (LogEntry[] memory)
    {
        uint256 total = logs[agentId].length;
        if (count > total) count = total;
        LogEntry[] memory result = new LogEntry[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = logs[agentId][total - count + i];
        }
        return result;
    }
}
```

### Deployment

Uses the `fevm/` Foundry project (cloned from fevm-foundry-kit):

```bash
# Calibration testnet
cd fevm && forge create \
  --rpc-url https://api.calibration.node.glif.io/rpc/v1 \
  --private-key $FILECOIN_PRIVATE_KEY \
  --broadcast \
  src/LogRegistry.sol:LogRegistry

# Mainnet
cd fevm && forge create \
  --rpc-url https://api.node.glif.io/rpc/v1 \
  --private-key $FILECOIN_PRIVATE_KEY \
  --broadcast \
  src/LogRegistry.sol:LogRegistry
```

### Recording Logs On-Chain (TypeScript)

```typescript
import { createWalletClient, http } from "viem";
import { filecoin } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const logRegistryAbi = [
  {
    name: "recordLog",
    type: "function",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "cid", type: "string" },
      { name: "heartbeat", type: "uint256" },
      { name: "decision", type: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export async function recordLogOnChain(
  agentId: bigint,
  cid: string,
  heartbeat: number,
  decision: string
): Promise<string> {
  const account = privateKeyToAccount(FILECOIN_PRIVATE_KEY as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: filecoin,
    transport: http("https://api.node.glif.io/rpc/v1"),
  });

  const txHash = await client.writeContract({
    address: LOG_REGISTRY_ADDRESS as `0x${string}`,
    abi: logRegistryAbi,
    functionName: "recordLog",
    args: [agentId, cid, BigInt(heartbeat), decision],
  });

  return txHash;
}
```

---

## Combined Flow — REFLECT Phase

After the agent completes a heartbeat:

```typescript
// In the REFLECT phase of each heartbeat:

// 1. Build execution log
const executionLog: ExecutionLog = {
  agentId: AGENT_ERC8004_ID,
  timestamp: new Date().toISOString(),
  heartbeatNumber: currentHeartbeat,
  poolState: poolReaderOutput,
  uniswapData: uniswapDataOutput,
  sentiment: veniceSentimentOutput,
  recommendation: veniceAnalysisOutput,
  eigencompute: eigencomputeOutput,
  decision: agentDecision,
  txHash: rebalanceTxHash,
  gasUsed: gasUsed,
};

// 2. Write to temp file and upload via Filecoin Pin CLI
const { cid, datasetId } = await storeExecutionLog(executionLog);
// Internally: writes JSON → shells out to `filecoin-pin add --mainnet`
// PDP proofs begin within 24h — cryptographic proof of storage

// 3. Record CID on-chain in LogRegistry (Filecoin mainnet)
if (cid) {
  const txHash = await recordLogOnChain(
    BigInt(AGENT_ERC8004_ID),
    cid,
    currentHeartbeat,
    agentDecision
  );
  log("info", `filecoin: log recorded on-chain`, { cid, datasetId, txHash });
}
```

---

## Frontend Integration

The frontend can query the LogRegistry to show the agent's full
decision history:

```typescript
// Read all logs for the curator agent
const logs = await publicClient.readContract({
  address: LOG_REGISTRY_ADDRESS,
  abi: logRegistryAbi,
  functionName: "getLatestLogs",
  args: [agentId, 20n], // last 20 entries
});

// For each log entry, fetch the full JSON from IPFS
for (const entry of logs) {
  const response = await fetch(
    `https://ipfs.io/ipfs/${entry.cid}`
  );
  const fullLog = await response.json();
  // Display: timestamp, decision, Venice reasoning, attestation hash
}
```

---

## Cost Estimates

| Item | Cost | Notes |
|---|---|---|
| Filecoin Pin upload (1-5 KB JSON) | ~0.07 USDFC per upload | ~372 GiB per 1 USDFC/month |
| Filecoin Pin payment setup | 1 USDFC deposit | One-time |
| LogRegistry deployment (Filecoin mainnet) | ~0.1-0.5 FIL gas | One-time |
| recordLog tx (per heartbeat) | ~0.001-0.01 FIL | Small calldata |
| ERC-8004 registration (Base Sepolia) | ~0.001 Sepolia ETH | One-time (free testnet) |

---

## Tokens Required

### Filecoin (Calibration testnet)

| Token | Purpose | Source |
|---|---|---|
| tFIL | Gas fees + LogRegistry deployment | [Chainsafe faucet](https://faucet.calibnet.chainsafe-fil.io) |
| USDFC (test) | Filecoin Pin storage payments | [USDFC faucet](https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc) |

### Filecoin (Mainnet)

| Token | Purpose | Source |
|---|---|---|
| FIL | Gas fees + LogRegistry deployment | Exchange or [USDFC Bridge](https://app.usdfc.net/#/bridge) |
| USDFC | Filecoin Pin storage payments | [Sushi swap](https://www.sushi.com/filecoin/swap) or [USDFC Bridge](https://app.usdfc.net/#/bridge) |

### Base Sepolia

| Token | Purpose | Source |
|---|---|---|
| Sepolia ETH | ERC-8004 registration gas | [Alchemy faucet](https://www.alchemy.com/faucets/base-sepolia) |

**Note:** The same Ethereum wallet (private key) works on both Filecoin
and Base Sepolia — you only need one key.

---

## Faucets & Explorers

| Resource | URL |
|---|---|
| Calibration faucet — tFIL (Chainsafe) | https://faucet.calibnet.chainsafe-fil.io |
| Calibration faucet — USDFC | https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc |
| USDFC mainnet (mint/bridge) | https://app.usdfc.net/#/bridge |
| Calibration explorer | https://calibration.filscan.io/ |
| Mainnet explorer | https://filscan.io/ |
| Base Sepolia explorer | https://sepolia.basescan.org/ |
| ERC-8004 registry (Base Sepolia) | https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e |
| Base Sepolia faucet | https://www.alchemy.com/faucets/base-sepolia |

---

## Environment Variables

```bash
# Filecoin + Base (same key works on both chains)
FILECOIN_PRIVATE_KEY=0x...    # For Filecoin Pin, LogRegistry, and ERC-8004 registration
LOG_REGISTRY_ADDRESS=0x...    # After deploying LogRegistry on Filecoin mainnet
ERC8004_AGENT_ID=             # After registering on ERC-8004 Identity Registry

# Existing (unchanged)
VENICE_API_KEY=
UNISWAP_API_KEY=
EIGENCOMPUTE_ENDPOINT=
```

---

## Verification Checklist

- [ ] `filecoin-pin` CLI installed and payment setup complete
- [ ] Agent card JSON created and uploaded to Filecoin Pin
- [ ] Agent registered on ERC-8004 Identity Registry (Base)
- [ ] LogRegistry.sol deployed to Filecoin Calibration testnet
- [ ] LogRegistry.sol deployed to Filecoin mainnet
- [ ] Run 3+ heartbeat cycles
- [ ] Each heartbeat produces a Filecoin Pin CID with Dataset ID
- [ ] Each CID is recorded in LogRegistry on-chain
- [ ] Retrieve stored logs via IPFS gateway — verify JSON matches
- [ ] `filecoin-pin data-set show` confirms PDP proof status
- [ ] Query LogRegistry from frontend — display decision history
- [ ] Demo: ERC-8004 agent → Filecoin Pin upload → PDP proof → LogRegistry → IPFS retrieval

---

## Bounty Alignment

| Requirement | How We Satisfy |
|---|---|
| Working code with real storage | Filecoin Pin uploads real JSON with PDP proofs, LogRegistry on Filecoin mainnet |
| Real payments and usage | USDFC for Filecoin Pin storage, FIL for LogRegistry gas, ETH for ERC-8004 registration |
| FOC mainnet deployment | LogRegistry.sol on Filecoin mainnet (chain 314) + Filecoin Pin `--mainnet` |
| RFS-2 compliance | ERC-8004 agent identity (Base Sepolia) + agent card on Filecoin Pin (mainnet) + execution logs on Filecoin with PDP proofs |
| 2-minute demo | Register agent → heartbeat → Filecoin Pin upload → LogRegistry record → verify PDP proof → IPFS retrieval |
| Why Filecoin is essential | PDP proofs = cryptographic guarantee agent decisions are permanently stored. LPs verify without trusting anyone — not the agent, not a service provider. |

---

## References

- [Filecoin Pin CLI tutorial](https://docs.filecoin.io/builder-cookbook/filecoin-pin/filecoin-pin-cli)
- [Filecoin Pin for ERC-8004 tutorial](https://docs.filecoin.io/builder-cookbook/filecoin-pin/erc-8004)
- [FilOzone/FilecoinPin-for-ERC8004 repo](https://github.com/FilOzone/FilecoinPin-for-ERC8004)
- [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004)
- [fevm-foundry-kit](https://github.com/filecoin-project/fevm-foundry-kit)
- [FEVM Foundry docs](https://docs.filecoin.io/smart-contracts/developing-contracts/foundry)
