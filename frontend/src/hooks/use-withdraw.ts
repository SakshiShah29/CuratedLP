"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { curatedVaultHookAbi } from "@/lib/abi/curated-vault-hook";
import { HOOK_ADDRESS } from "@/lib/constants";
import { parseUnits } from "viem";

export function useWithdraw() {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });

  const withdraw = (shares: string, decimals: number = 18) => {
    const sharesToBurn = parseUnits(shares, decimals);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    writeContract({
      address: HOOK_ADDRESS,
      abi: curatedVaultHookAbi,
      functionName: "withdraw",
      args: [sharesToBurn, 0n, 0n, deadline],
    });
  };

  return {
    withdraw,
    isPending: isPending || isConfirming,
    isSuccess,
    error,
    hash,
    reset,
  };
}
