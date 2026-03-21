"use client";

import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi } from "@/lib/abi/erc20";
import { maxUint256 } from "viem";

export function useTokenApproval() {
  const {
    writeContract,
    data: hash,
    isPending,
    error,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } =
    useWaitForTransactionReceipt({ hash });

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
