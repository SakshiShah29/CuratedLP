/**
 * filecoin-store.ts — CLI tool for storing execution logs on Filecoin.
 *
 * Two-path storage:
 *   Path A: Filecoin Pin CLI → IPFS + Filecoin deal with PDP proofs → CID
 *   Path B: LogRegistry.sol on Filecoin mainnet → on-chain CID index
 *
 * Requires: npm install -g filecoin-pin@latest
 * One-time: filecoin-pin payments setup --auto [--mainnet]
 *
 * Outputs FilecoinStoreResult JSON to stdout. Exits 0 on success, 1 on failure.
 *
 * Usage:
 *   npx tsx src/tools/filecoin-store.ts --log '<ExecutionLog JSON>'
 *   npx tsx src/tools/filecoin-store.ts --retrieve <CID>
 */

import { execSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createWalletClient, http } from "viem";
import { filecoin } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  MOLTBOT_PRIVATE_KEY,
  LOG_REGISTRY_ADDRESS,
  FILECOIN_MAINNET,
} from "../lib/config.js";
import { log } from "../lib/logger.js";
import type { ExecutionLog, FilecoinStoreResult } from "../lib/types.js";

// ── LogRegistry ABI (only the functions we call) ────────────────────────────

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

// ── Path A: Filecoin Pin upload ─────────────────────────────────────────────

/**
 * Store execution log on Filecoin via filecoin-pin CLI.
 * Provides cryptographic PDP proofs of storage.
 * Returns the CID for IPFS retrieval and on-chain indexing.
 */
export async function storeExecutionLog(
  executionLog: ExecutionLog
): Promise<FilecoinStoreResult> {
  const tmpDir = mkdtempSync(join(tmpdir(), "curatedlp-"));
  const fileName = `curatedlp-log-${executionLog.heartbeatNumber}-${Date.now()}.json`;
  const filePath = join(tmpDir, fileName);

  try {
    // Write execution log to temp file
    const jsonString = JSON.stringify(executionLog, null, 2);
    writeFileSync(filePath, jsonString);

    // Build filecoin-pin command
    const mainnetFlag = FILECOIN_MAINNET ? " --mainnet" : "";
    const cmd = `filecoin-pin add --auto-fund${mainnetFlag} ${filePath} 2>&1 || true`;

    // Execute filecoin-pin CLI — PRIVATE_KEY passed via env (not in command string)
    // `|| true` prevents execSync from throwing on exit code 1 (secondary provider warnings)
    // Timeout set to 5 min — filecoin-pin is slow (on-chain confirmation)
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: 300_000, // 5 min timeout for upload + on-chain confirmation
      env: { ...process.env, PRIVATE_KEY: MOLTBOT_PRIVATE_KEY },
    });

    // Parse CID and Dataset ID from CLI output
    const cid = parseCidFromOutput(output);
    const datasetId = parseDatasetIdFromOutput(output);

    if (!cid) {
      log("error", "filecoin-store: could not parse CID from filecoin-pin output", { output });
      return { success: false, error: "Failed to parse CID from filecoin-pin output" };
    }

    log("info", `filecoin-store: uploaded log #${executionLog.heartbeatNumber}`, {
      cid,
      datasetId,
      fileName,
    });

    return {
      success: true,
      cid,
      datasetId: datasetId ?? undefined,
      size: jsonString.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "filecoin-store: filecoin-pin upload failed", { error: msg });
    return { success: false, error: msg };
  } finally {
    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      // non-fatal
    }
  }
}

/**
 * Parse Root CID from filecoin-pin CLI output.
 * Looks for "Root CID: bafy..." pattern.
 */
function parseCidFromOutput(output: string): string | null {
  const match = output.match(/Root CID:\s*(bafy\S+)/);
  return match ? match[1] : null;
}

/**
 * Parse Dataset ID from filecoin-pin CLI output.
 * Looks for "Data Set ID: 12345" pattern.
 */
function parseDatasetIdFromOutput(output: string): string | null {
  const match = output.match(/Data Set ID:\s*(\d+)/);
  return match ? match[1] : null;
}

// ── Retrieval ───────────────────────────────────────────────────────────────

/**
 * Retrieve an execution log from IPFS by CID.
 */
export async function retrieveExecutionLog(
  cid: string
): Promise<ExecutionLog | null> {
  // Try multiple gateways
  const gateways = [
    `https://ipfs.io/ipfs/${cid}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://gateway.pinata.cloud/ipfs/${cid}`,
  ];

  for (const url of gateways) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.ok) {
        return (await response.json()) as ExecutionLog;
      }
    } catch {
      continue;
    }
  }

  return null;
}

// ── Path B: On-chain CID recording ─────────────────────────────────────────

/**
 * Record a CID in the LogRegistry contract on Filecoin.
 * Links the CID to the agent's ERC-8004 identity on-chain.
 * Uses mainnet or Calibration testnet based on FILECOIN_MAINNET config.
 */
export async function recordLogOnChain(
  agentId: bigint,
  cid: string,
  heartbeat: number,
  decision: string
): Promise<string> {
  if (!MOLTBOT_PRIVATE_KEY) {
    throw new Error("MOLTBOT_PRIVATE_KEY not configured");
  }
  if (!LOG_REGISTRY_ADDRESS) {
    throw new Error("LOG_REGISTRY_ADDRESS not configured");
  }

  const rpcUrl = FILECOIN_MAINNET
    ? "https://api.node.glif.io/rpc/v1"
    : "https://api.calibration.node.glif.io/rpc/v1";
  const chainId = FILECOIN_MAINNET ? 314 : 314159;

  const account = privateKeyToAccount(
    MOLTBOT_PRIVATE_KEY as `0x${string}`
  );
  const client = createWalletClient({
    account,
    chain: { ...filecoin, id: chainId },
    transport: http(rpcUrl),
  });

  const txHash = await client.writeContract({
    address: LOG_REGISTRY_ADDRESS as `0x${string}`,
    abi: logRegistryAbi,
    functionName: "recordLog",
    args: [agentId, cid, BigInt(heartbeat), decision],
  });

  log("info", "filecoin-store: CID recorded on-chain", {
    txHash,
    agentId: agentId.toString(),
    cid,
    heartbeat,
  });

  return txHash;
}

// ── CLI entrypoint ──────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < process.argv.length
    ? process.argv[idx + 1]
    : undefined;
}

async function main() {
  // Mode 1: Retrieve by CID
  const retrieveCid = getArg("retrieve");
  if (retrieveCid) {
    const result = await retrieveExecutionLog(retrieveCid);
    if (result) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error(`Failed to retrieve CID: ${retrieveCid}`);
      process.exit(1);
    }
    return;
  }

  // Mode 2: Store execution log
  const logJson = getArg("log");
  if (!logJson) {
    console.error("Usage:");
    console.error("  npx tsx src/tools/filecoin-store.ts --log '<ExecutionLog JSON>'");
    console.error("  npx tsx src/tools/filecoin-store.ts --retrieve <CID>");
    process.exit(1);
  }

  const executionLog: ExecutionLog = JSON.parse(logJson);

  // Path A: Upload to Filecoin Pin
  const result = await storeExecutionLog(executionLog);

  // Path B: Record CID on-chain (if upload succeeded and registry is configured)
  if (result.success && result.cid && LOG_REGISTRY_ADDRESS && MOLTBOT_PRIVATE_KEY) {
    try {
      const txHash = await recordLogOnChain(
        BigInt(executionLog.agentId),
        result.cid,
        executionLog.heartbeatNumber,
        executionLog.decision
      );
      console.log(JSON.stringify({ ...result, registryTxHash: txHash }, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", "filecoin-store: on-chain recording failed (non-fatal)", { error: msg });
      console.log(JSON.stringify({ ...result, registryError: msg }, null, 2));
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
