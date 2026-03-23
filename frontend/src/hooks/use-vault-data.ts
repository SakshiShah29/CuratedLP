"use client";

import { useMemo } from "react";
import { useReadContracts, useReadContract } from "wagmi";
import { keccak256, concat, pad, toHex } from "viem";
import { curatedVaultHookAbi } from "@/lib/abi/curated-vault-hook";
import { vaultSharesAbi } from "@/lib/abi/vault-shares";
import { HOOK_ADDRESS, VAULT_SHARES_ADDRESS } from "@/lib/constants";

const hookContract = {
  address: HOOK_ADDRESS,
  abi: curatedVaultHookAbi,
} as const;

const sharesContract = {
  address: VAULT_SHARES_ADDRESS,
  abi: vaultSharesAbi,
} as const;

/** PoolManager.extsload(bytes32) — reads raw storage slot */
const extsloadAbi = [
  {
    type: "function",
    name: "extsload",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
] as const;

/** POOLS_SLOT = bytes32(uint256(6)) per Uniswap v4 StateLibrary */
const POOLS_SLOT = pad(toHex(6n), { size: 32 });

/**
 * Decode Uniswap v4 Pool.Slot0 from a raw bytes32.
 * Layout: sqrtPriceX96 (160 bits) | tick (24 bits) | protocolFee (24 bits) | lpFee (24 bits)
 */
function decodeSlot0(data: `0x${string}`): { sqrtPriceX96: bigint; tick: number } {
  const value = BigInt(data);
  const sqrtPriceX96 = value & ((1n << 160n) - 1n);
  const tickRaw = Number((value >> 160n) & 0xFFFFFFn);
  // Sign-extend 24-bit integer for negative ticks
  const tick = tickRaw >= 0x800000 ? tickRaw - 0x1000000 : tickRaw;
  return { sqrtPriceX96, tick };
}

export function useVaultData() {
  const result = useReadContracts({
    contracts: [
      { ...hookContract, functionName: "totalAssets" },
      { ...hookContract, functionName: "getCurrentFee" },
      { ...hookContract, functionName: "getPerformanceMetrics" },
      { ...hookContract, functionName: "activeCuratorId" },
      { ...sharesContract, functionName: "totalSupply" },
      { ...hookContract, functionName: "currentTickLower" },
      { ...hookContract, functionName: "currentTickUpper" },
      { ...hookContract, functionName: "totalSwaps" },
      { ...hookContract, functionName: "cumulativeVolume" },
      { ...hookContract, functionName: "cumulativeFeeRevenue" },
      { ...hookContract, functionName: "accruedPerformanceFee0" },
      { ...hookContract, functionName: "accruedPerformanceFee1" },
      { ...hookContract, functionName: "poolInitialized" },
      { ...hookContract, functionName: "getTokens" },
      { ...hookContract, functionName: "poolId" },
      { ...hookContract, functionName: "poolManager" },
    ],
    query: { refetchInterval: 12_000 },
  });

  const [
    totalAssets,
    currentFee,
    perfMetrics,
    activeCuratorId,
    totalSupply,
    tickLower,
    tickUpper,
    totalSwaps,
    cumulativeVolume,
    cumulativeFeeRevenue,
    accruedFee0,
    accruedFee1,
    poolInitialized,
    tokens,
    poolIdResult,
    poolManagerResult,
  ] = result.data ?? [];

  const poolIdValue = poolIdResult?.result as `0x${string}` | undefined;
  const poolManagerAddress = poolManagerResult?.result as `0x${string}` | undefined;

  // Compute the storage slot for Pool.Slot0 in the PoolManager
  const slot0StorageKey = useMemo(() => {
    if (!poolIdValue) return undefined;
    return keccak256(concat([poolIdValue, POOLS_SLOT]));
  }, [poolIdValue]);

  // Read Slot0 from the PoolManager via extsload
  const slot0Read = useReadContract({
    address: poolManagerAddress,
    abi: extsloadAbi,
    functionName: "extsload",
    args: slot0StorageKey ? [slot0StorageKey] : undefined,
    query: {
      enabled: !!slot0StorageKey && !!poolManagerAddress,
      refetchInterval: 12_000,
    },
  });

  const slot0Data = slot0Read.data as `0x${string}` | undefined;
  const decoded = useMemo(() => {
    if (!slot0Data) return undefined;
    return decodeSlot0(slot0Data);
  }, [slot0Data]);

  return {
    isLoading: result.isLoading,
    error: result.error,
    totalAssets: totalAssets?.result as [bigint, bigint] | undefined,
    currentFee: currentFee?.result as number | undefined,
    performanceMetrics: perfMetrics?.result as
      | [bigint, bigint, bigint, bigint, number, number, number]
      | undefined,
    activeCuratorId: activeCuratorId?.result as bigint | undefined,
    totalSupply: totalSupply?.result as bigint | undefined,
    tickLower: tickLower?.result as number | undefined,
    tickUpper: tickUpper?.result as number | undefined,
    totalSwaps: totalSwaps?.result as bigint | undefined,
    cumulativeVolume: cumulativeVolume?.result as bigint | undefined,
    cumulativeFeeRevenue: cumulativeFeeRevenue?.result as bigint | undefined,
    accruedPerformanceFee0: accruedFee0?.result as bigint | undefined,
    accruedPerformanceFee1: accruedFee1?.result as bigint | undefined,
    poolInitialized: poolInitialized?.result as boolean | undefined,
    tokens: tokens?.result as [string, string] | undefined,
    /** The pool's current tick from PoolManager slot0 */
    currentTick: decoded?.tick,
    refetch: result.refetch,
  };
}
