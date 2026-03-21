"use client";

import { useEffect } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { curatedVaultHookAbi } from "@/lib/abi/curated-vault-hook";
import { HOOK_ADDRESS } from "@/lib/constants";
import { parseUnits } from "viem";
import { useBlockscoutToast } from "./use-blockscout-toast";

export function useDeposit() {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });

  const { showTxToast } = useBlockscoutToast();

  useEffect(() => {
    if (hash) showTxToast(hash);
  }, [hash]);

  const deposit = (
    amount0: string,
    amount1: string,
    decimals0: number,
    decimals1: number,
    slippage: number = 0.01 // 1%
  ) => {
    const amount0Desired = parseUnits(amount0, decimals0);
    const amount1Desired = parseUnits(amount1, decimals1);
    const amount0Min =
      (amount0Desired * BigInt(Math.floor((1 - slippage) * 10000))) / 10000n;
    const amount1Min =
      (amount1Desired * BigInt(Math.floor((1 - slippage) * 10000))) / 10000n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    writeContract({
      address: HOOK_ADDRESS,
      abi: curatedVaultHookAbi,
      functionName: "deposit",
      args: [amount0Desired, amount1Desired, amount0Min, amount1Min, 0n, deadline],
    });
  };

  return {
    deposit,
    isPending: isPending || isConfirming,
    isSuccess,
    error,
    hash,
    reset,
  };
}
