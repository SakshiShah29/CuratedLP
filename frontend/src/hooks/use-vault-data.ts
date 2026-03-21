"use client";

import { useReadContracts } from "wagmi";
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
  ] = result.data ?? [];

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
    refetch: result.refetch,
  };
}
