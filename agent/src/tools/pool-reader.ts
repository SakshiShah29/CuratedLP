/**
 * pool-reader.ts — CLI tool for OpenClaw
 *
 * Reads all on-chain state from the CuratedVaultHook contract.
 * Outputs JSON to stdout. Exits 0 on success, 1 on failure.
 *
 * Usage: npx tsx src/tools/pool-reader.ts
 */

import "dotenv/config";
import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.BASE_SEPOLIA_RPC;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;

if (!RPC_URL || !HOOK_ADDRESS) {
  console.error(
    JSON.stringify({ error: "BASE_SEPOLIA_RPC and HOOK_ADDRESS must be set in .env" })
  );
  process.exit(1);
}

const HOOK_ABI = [
  {
    type: "function",
    name: "getPerformanceMetrics",
    inputs: [],
    outputs: [
      { name: "volume", type: "uint256" },
      { name: "feeRevenue", type: "uint256" },
      { name: "swapCount", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "currentFee", type: "uint24" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeCuratorId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accruedPerformanceFee0",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "accruedPerformanceFee1",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentTickLower",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentTickUpper",
    inputs: [],
    outputs: [{ name: "", type: "int24" }],
    stateMutability: "view",
  },
] as const;

async function main() {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(RPC_URL),
  });

  const [metrics, assets, curatorId, accruedFee0, accruedFee1, tickLower, tickUpper, blockNumber] =
    await Promise.all([
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "getPerformanceMetrics",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "totalAssets",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "activeCuratorId",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "accruedPerformanceFee0",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "accruedPerformanceFee1",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "currentTickLower",
      }),
      client.readContract({
        address: HOOK_ADDRESS,
        abi: HOOK_ABI,
        functionName: "currentTickUpper",
      }),
      client.getBlockNumber(),
    ]);

  const [volume, feeRevenue, swapCount, liquidity, , , currentFee] = metrics;
  const [idleToken0, idleToken1] = assets;

  const result = {
    tickLower: Number(tickLower),
    tickUpper: Number(tickUpper),
    totalLiquidity: liquidity.toString(),
    currentFee: Number(currentFee),
    cumulativeVolume: volume.toString(),
    cumulativeFeeRevenue: feeRevenue.toString(),
    totalSwaps: Number(swapCount),
    idleToken0: idleToken0.toString(),
    idleToken1: idleToken1.toString(),
    accruedPerformanceFee0: accruedFee0.toString(),
    accruedPerformanceFee1: accruedFee1.toString(),
    activeCuratorId: Number(curatorId),
    currentBlock: Number(blockNumber),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message ?? String(err) }));
  process.exit(1);
});
