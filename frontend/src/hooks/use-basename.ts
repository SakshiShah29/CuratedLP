"use client";

import { useEnsName } from "wagmi";
import { base } from "viem/chains";

export function useBasename(address: `0x${string}` | undefined) {
  const result = useEnsName({
    address,
    chainId: base.id,
    query: {
      enabled: !!address,
      staleTime: 60_000,
    },
  });

  return {
    basename: result.data ?? undefined,
    isLoading: result.isLoading,
  };
}
