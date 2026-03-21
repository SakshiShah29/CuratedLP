"use client";

import { useReadContract, useAccount } from "wagmi";
import { vaultSharesAbi } from "@/lib/abi/vault-shares";
import { erc20Abi } from "@/lib/abi/erc20";
import { VAULT_SHARES_ADDRESS, HOOK_ADDRESS } from "@/lib/constants";

export function useUserPosition(
  token0Address?: `0x${string}`,
  token1Address?: `0x${string}`
) {
  const { address } = useAccount();
  const enabled = !!address;

  const shareBalance = useReadContract({
    address: VAULT_SHARES_ADDRESS,
    abi: vaultSharesAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 12_000 },
  });

  const totalSupply = useReadContract({
    address: VAULT_SHARES_ADDRESS,
    abi: vaultSharesAbi,
    functionName: "totalSupply",
    query: { enabled, refetchInterval: 12_000 },
  });

  const token0Balance = useReadContract({
    address: token0Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!token0Address, refetchInterval: 12_000 },
  });

  const token0Decimals = useReadContract({
    address: token0Address,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!token0Address },
  });

  const token0Symbol = useReadContract({
    address: token0Address,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!token0Address },
  });

  const token1Balance = useReadContract({
    address: token1Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: enabled && !!token1Address, refetchInterval: 12_000 },
  });

  const token1Decimals = useReadContract({
    address: token1Address,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!token1Address },
  });

  const token1Symbol = useReadContract({
    address: token1Address,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!token1Address },
  });

  const token0Allowance = useReadContract({
    address: token0Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, HOOK_ADDRESS] : undefined,
    query: { enabled: enabled && !!token0Address, refetchInterval: 12_000 },
  });

  const token1Allowance = useReadContract({
    address: token1Address,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, HOOK_ADDRESS] : undefined,
    query: { enabled: enabled && !!token1Address, refetchInterval: 12_000 },
  });

  const refetch = () => {
    shareBalance.refetch();
    totalSupply.refetch();
    token0Balance.refetch();
    token1Balance.refetch();
    token0Allowance.refetch();
    token1Allowance.refetch();
  };

  return {
    isLoading: shareBalance.isLoading,
    isConnected: !!address,
    shareBalance: shareBalance.data as bigint | undefined,
    totalSupply: totalSupply.data as bigint | undefined,
    token0Balance: token0Balance.data as bigint | undefined,
    token0Decimals: token0Decimals.data as number | undefined,
    token0Symbol: token0Symbol.data as string | undefined,
    token1Balance: token1Balance.data as bigint | undefined,
    token1Decimals: token1Decimals.data as number | undefined,
    token1Symbol: token1Symbol.data as string | undefined,
    token0Allowance: token0Allowance.data as bigint | undefined,
    token1Allowance: token1Allowance.data as bigint | undefined,
    refetch,
  };
}
