"use client";

import { useEffect } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { maxUint256 } from "viem";
import { useBlockscoutToast } from "./use-blockscout-toast";

export function useTokenApproval() {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });

  const { showTxToast } = useBlockscoutToast();

  useEffect(() => {
    if (hash) showTxToast(hash);
  }, [hash]);

  const approve = (tokenAddress: `0x${string}`, spender: `0x${string}`) => {
    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, maxUint256],
    });
  };

  return {
    approve,
    isPending: isPending || isConfirming,
    isSuccess,
    error,
    hash,
  };
}
