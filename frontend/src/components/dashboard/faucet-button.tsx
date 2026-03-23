"use client";

import { useState } from "react";
import { Droplets } from "lucide-react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseAbi, parseEther } from "viem";

const MINT_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
]);

const TOKEN0 = "0xb6eeA72564e01F8a6AD1d2D7eDf690065F2A72dF" as const; // mUSDC
const TOKEN1 = "0xD79D66484c1C51B9D5cd455e3C7Ee3d0950e448D" as const; // mwstETH
const MINT_AMOUNT = parseEther("100"); // 100 tokens per click

export function FaucetButton() {
  const { address, isConnected } = useAccount();
  const [mintingToken, setMintingToken] = useState<string | null>(null);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  const mint = (token: `0x${string}`, label: string) => {
    if (!address) return;
    setMintingToken(label);
    writeContract({
      address: token,
      abi: MINT_ABI,
      functionName: "mint",
      args: [address, MINT_AMOUNT],
    });
  };

  const busy = isPending || isConfirming;

  if (!isConnected) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => mint(TOKEN0, "mUSDC")}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-2 bg-[#1a1a1a] hover:bg-[#252525] border border-[#2a2a2a] rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Droplets className="w-3.5 h-3.5 text-blue-400" />
        {busy && mintingToken === "mUSDC" ? (isConfirming ? "Confirming..." : "Signing...") : "mUSDC"}
      </button>
      <button
        onClick={() => mint(TOKEN1, "mwstETH")}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-2 bg-[#1a1a1a] hover:bg-[#252525] border border-[#2a2a2a] rounded-lg text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Droplets className="w-3.5 h-3.5 text-purple-400" />
        {busy && mintingToken === "mwstETH" ? (isConfirming ? "Confirming..." : "Signing...") : "mwstETH"}
      </button>
      {isSuccess && (
        <span className="text-[10px] text-[#4ade80] ml-1">+100</span>
      )}
    </div>
  );
}
