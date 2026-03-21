"use client";

import { useReadContract } from "wagmi";
import { curatedVaultHookAbi } from "@/lib/abi/curated-vault-hook";
import { HOOK_ADDRESS } from "@/lib/constants";

export interface CuratorData {
  wallet: `0x${string}`;
  erc8004IdentityId: bigint;
  performanceFeeBps: number;
  lastRebalanceBlock: bigint;
  rebalanceCount: bigint;
  active: boolean;
}

export function useCuratorData(curatorId: bigint | undefined) {
  const result = useReadContract({
    address: HOOK_ADDRESS,
    abi: curatedVaultHookAbi,
    functionName: "getCurator",
    args: curatorId !== undefined ? [curatorId] : undefined,
    query: {
      enabled: curatorId !== undefined && curatorId > 0n,
      refetchInterval: 15_000,
    },
  });

  const raw = result.data as CuratorData | undefined;

  return {
    isLoading: result.isLoading,
    error: result.error,
    curator: raw,
  };
}
