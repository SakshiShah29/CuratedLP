"use client";

import { useReadContract } from "wagmi";
import { namehash } from "viem";
import { baseSepolia } from "viem/chains";
import { BASENAMES_L2_RESOLVER } from "@/lib/constants";
import { l2ResolverAbi } from "@/lib/abi/basenames";

/**
 * Forward resolution: .base.eth name → address
 */
export function useResolveBasename(name: string | undefined) {
  const node = name ? namehash(name) : undefined;

  const { data, isLoading } = useReadContract({
    address: BASENAMES_L2_RESOLVER,
    abi: l2ResolverAbi,
    functionName: "addr",
    args: node ? [node] : undefined,
    chainId: baseSepolia.id,
    query: {
      enabled: !!node,
      staleTime: 60_000,
    },
  });

  return {
    address: data as `0x${string}` | undefined,
    isLoading,
  };
}
