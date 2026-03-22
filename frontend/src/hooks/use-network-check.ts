"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { baseSepolia } from "viem/chains";

export function useNetworkCheck() {
  const { chain, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = isConnected && chain?.id !== baseSepolia.id;

  const switchToBaseSepolia = () => {
    switchChain?.({ chainId: baseSepolia.id });
  };

  return { isWrongNetwork, switchToBaseSepolia };
}
