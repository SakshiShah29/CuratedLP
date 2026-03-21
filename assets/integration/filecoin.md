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

This addresses Filecoin RFS-2:
> "Deploy AI agents as first-class onchain citizens via ERC-8004,
> with persistent state and execution logs on Filecoin."

---

## Architecture

```
  Agent heartbeat (REFLECT phase)
       |
       | Serialize execution log to JSON
       v
  Two storage paths (both required for strong submission):
       |
       +--→ Path A: Lighthouse SDK → IPFS + Filecoin storage deal
       |     Returns: CID (content identifier)
       |     Fast retrieval via IPFS gateway
       |     Filecoin deal ensures persistence
       |
       +--→ Path B: FEVM smart contract on Filecoin mainnet
             LogRegistry.sol records:
               - ERC-8004 agent ID
               - CID from Path A
               - Block timestamp
             Creates on-chain index of all execution logs
       |
       v
  Anyone can: query LogRegistry → get CIDs → fetch logs from IPFS/Filecoin
```

---

## Path A: Lighthouse SDK — Data Upload

Lighthouse abstracts Filecoin deal-making into simple API calls. Data
is stored on IPFS (hot, fast retrieval) with Filecoin backing (persistent
storage deals).

### Setup

```bash
npm install @lighthouse-web3/sdk
```

Get an API key from https://files.lighthouse.storage/

### Environment Variables

```bash
LIGHTHOUSE_API_KEY=your_api_key_here
```

### Implementation: filecoin-store.ts

```typescript
import lighthouse from "@lighthouse-web3/sdk";
import { LIGHTHOUSE_API_KEY } from "../lib/config.js";
import { log } from "../lib/logger.js";

export interface ExecutionLog {
  agentId: string;           // ERC-8004 token ID
  timestamp: string;         // ISO 8601
  heartbeatNumber: number;
  poolState: object;         // from pool-reader
  uniswapData: object;       // from uniswap-data (includes DeFiLlama)
  sentiment: object;         // from Venice Call #1
  recommendation: object;    // from Venice Call #2
  eigencompute: {
    attestationHash: string;
    computeJobId: string;
    verifiable: boolean;
  };
  decision: "rebalance" | "claim_fees" | "skip";
  txHash?: string;           // if acted
  gasUsed?: number;
}

export interface FilecoinStoreResult {
  success: boolean;
  cid?: string;              // IPFS CID for retrieval
  size?: number;             // bytes stored
  error?: string;
}

/**
 * Store execution log on Filecoin via Lighthouse.
 * Returns the CID for retrieval and on-chain indexing.
 */
export async function storeExecutionLog(
  executionLog: ExecutionLog
): Promise<FilecoinStoreResult> {
  try {
    const jsonString = JSON.stringify(executionLog, null, 2);
    const fileName = `curatedlp-log-${executionLog.heartbeatNumber}-${Date.now()}.json`;

    // Upload text/JSON to Lighthouse → IPFS + Filecoin
    const response = await lighthouse.uploadText(
      jsonString,
      LIGHTHOUSE_API_KEY,
      fileName
    );

    const cid = response.data.Hash;
    const size = response.data.Size;

    log("info", `filecoin-store: uploaded log #${executionLog.heartbeatNumber}`, {
      cid,
      size,
      fileName,
    });

    return { success: true, cid, size: parseInt(size) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "filecoin-store: upload failed", { error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Retrieve an execution log from Filecoin/IPFS by CID.
 */
export async function retrieveExecutionLog(cid: string): Promise<ExecutionLog | null> {
  try {
    const response = await fetch(`https://gateway.lighthouse.storage/ipfs/${cid}`);
    if (!response.ok) return null;
    return (await response.json()) as ExecutionLog;
  } catch {
    return null;
  }
}
```

### Retrieval

Stored logs are accessible via:
- **Lighthouse gateway:** `https://gateway.lighthouse.storage/ipfs/<CID>`
- **IPFS gateway:** `https://ipfs.io/ipfs/<CID>`
- **Direct IPFS:** `ipfs cat <CID>`

---

## Path B: FEVM Smart Contract — On-Chain Log Index

A simple Solidity contract deployed on **Filecoin mainnet** (chain ID 314)
that records CIDs linked to the agent's ERC-8004 identity.

### LogRegistry.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LogRegistry
 * @notice On-chain index of CuratedLP agent execution logs stored on Filecoin/IPFS.
 *         Each entry links an ERC-8004 agent ID to a Filecoin CID.
 */
contract LogRegistry {
    struct LogEntry {
        string cid;           // IPFS/Filecoin CID
        uint256 timestamp;    // block.timestamp when recorded
        uint256 heartbeat;    // heartbeat number
        string decision;      // "rebalance", "claim_fees", "skip"
    }

    /// @notice agentId => array of log entries
    mapping(uint256 => LogEntry[]) public logs;

    /// @notice agentId => total log count
    mapping(uint256 => uint256) public logCount;

    /// @notice Emitted when a new execution log is recorded
    event LogRecorded(
        uint256 indexed agentId,
        uint256 indexed heartbeat,
        string cid,
        string decision,
        uint256 timestamp
    );

    /**
     * @notice Record an execution log CID for an agent.
     * @param agentId   ERC-8004 agent token ID
     * @param cid       IPFS/Filecoin CID of the execution log JSON
     * @param heartbeat Heartbeat cycle number
     * @param decision  Decision taken: "rebalance", "claim_fees", or "skip"
     */
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

    /**
     * @notice Get a specific log entry for an agent.
     * @param agentId ERC-8004 agent token ID
     * @param index   Log index (0-based)
     */
    function getLog(uint256 agentId, uint256 index)
        external view returns (LogEntry memory)
    {
        require(index < logs[agentId].length, "Index out of bounds");
        return logs[agentId][index];
    }

    /**
     * @notice Get the latest N log entries for an agent.
     * @param agentId ERC-8004 agent token ID
     * @param count   Number of entries to return
     */
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

### Deployment — Filecoin Mainnet

**Hardhat config:**

```typescript
// hardhat.config.ts
const config: HardhatUserConfig = {
  solidity: "0.8.20",
  networks: {
    filecoinMainnet: {
      url: "https://api.node.glif.io/rpc/v1",
      chainId: 314,
      accounts: [process.env.FILECOIN_PRIVATE_KEY!],
    },
    filecoinCalibration: {
      url: "https://api.calibration.node.glif.io/rpc/v1",
      chainId: 314159,
      accounts: [process.env.FILECOIN_PRIVATE_KEY!],
    },
  },
};
```

**Deploy script:**

```typescript
import { ethers } from "hardhat";

async function main() {
  const LogRegistry = await ethers.getContractFactory("LogRegistry");
  const registry = await LogRegistry.deploy();
  await registry.waitForDeployment();
  console.log("LogRegistry deployed to:", await registry.getAddress());
}

main().catch(console.error);
```

**Deploy to calibration testnet first, then mainnet:**

```bash
# Get tFIL from faucet
# https://faucet.calibnet.chainsafe-fil.io

# Deploy to calibration
npx hardhat run scripts/deploy-log-registry.ts --network filecoinCalibration

# Deploy to mainnet (requires real FIL for gas)
npx hardhat run scripts/deploy-log-registry.ts --network filecoinMainnet
```

### Recording Logs On-Chain (TypeScript)

```typescript
import { createPublicClient, createWalletClient, http } from "viem";
import { filecoin } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { LOG_REGISTRY_ADDRESS, FILECOIN_PRIVATE_KEY } from "../lib/config.js";

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

// 2. Store on Filecoin via Lighthouse
const { cid } = await storeExecutionLog(executionLog);

// 3. Record CID on-chain in LogRegistry (Filecoin mainnet)
if (cid) {
  const txHash = await recordLogOnChain(
    BigInt(AGENT_ERC8004_ID),
    cid,
    currentHeartbeat,
    agentDecision
  );
  log("info", `filecoin: log recorded on-chain`, { cid, txHash });
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
    `https://gateway.lighthouse.storage/ipfs/${entry.cid}`
  );
  const fullLog = await response.json();
  // Display: timestamp, decision, Venice reasoning, attestation hash
}
```

---

## Cost Estimates

| Item | Cost | Notes |
|---|---|---|
| Lighthouse upload (1-5 KB JSON) | Free tier: 1GB | More than enough for hackathon |
| LogRegistry deployment (Filecoin mainnet) | ~0.1-0.5 FIL gas | One-time |
| recordLog tx (per heartbeat) | ~0.001-0.01 FIL | Small calldata |
| Calibration testnet | Free (tFIL from faucet) | For testing |

---

## Faucets & Explorers

| Resource | URL |
|---|---|
| Calibration faucet (Chainsafe) | https://faucet.calibnet.chainsafe-fil.io |
| Calibration faucet (Zondax) | https://beryx.zondax.ch/faucet/ |
| Calibration faucet (Forest) | https://forest-explorer.chainsafe.dev/faucet/calibnet |
| Calibration explorer | https://calibration.filscan.io/ |
| Mainnet explorer | https://filscan.io/ |

---

## Environment Variables

```bash
# Filecoin
LIGHTHOUSE_API_KEY=           # From https://files.lighthouse.storage/
FILECOIN_PRIVATE_KEY=0x...    # For deploying LogRegistry + recording logs
LOG_REGISTRY_ADDRESS=0x...    # After deployment

# Existing (unchanged)
VENICE_API_KEY=
UNISWAP_API_KEY=
EIGENCOMPUTE_APP_ID=
```

---

## Verification Checklist

- [ ] Lighthouse SDK installed and API key configured
- [ ] LogRegistry.sol deployed to Filecoin Calibration testnet
- [ ] LogRegistry.sol deployed to Filecoin mainnet
- [ ] Run 3+ heartbeat cycles
- [ ] Each heartbeat produces a Lighthouse CID
- [ ] Each CID is recorded in LogRegistry on-chain
- [ ] Retrieve stored logs via IPFS gateway — verify JSON matches
- [ ] Query LogRegistry from frontend — display decision history
- [ ] Demo: show ERC-8004 agent ID → LogRegistry → CIDs → full execution logs

---

## Bounty Alignment

| Requirement | How We Satisfy |
|---|---|
| Working code with real storage | Lighthouse uploads real JSON, LogRegistry deployed on Filecoin mainnet |
| Real payments and usage | FIL gas for on-chain log recording, Lighthouse storage deals |
| FOC mainnet deployment | LogRegistry.sol deployed on Filecoin mainnet (chain ID 314) |
| RFS-2 compliance | ERC-8004 agent identity + execution logs on Filecoin |
| 2-minute demo | Show heartbeat → Lighthouse upload → on-chain CID recording → IPFS retrieval |
| Why Filecoin is essential | Immutable audit trail for AI agent decisions — LPs verify without trusting the agent |
