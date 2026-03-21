"use client";

import { useState, useEffect } from "react";
import { TokenInput } from "@/components/ui/token-input";
import { Button } from "@/components/ui/button";
import { TxLink } from "@/components/ui/tx-link";
import { useWithdraw } from "@/hooks/use-withdraw";
import { formatTokenAmount } from "@/lib/format";
import { Loader2, ArrowUpFromLine } from "lucide-react";
import { TokenIcon } from "@/components/ui/token-icon";

interface WithdrawFormProps {
  shareBalance?: bigint;
  totalSupply?: bigint;
  totalAssets?: [bigint, bigint];
  token0Symbol?: string;
  token1Symbol?: string;
  isConnected: boolean;
  onSuccess?: () => void;
}

export function WithdrawForm({
  shareBalance,
  totalSupply,
  totalAssets,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  isConnected,
  onSuccess,
}: WithdrawFormProps) {
  const [shares, setShares] = useState("");
  const { withdraw, isPending, isSuccess, hash, reset } = useWithdraw();

  const sharesNum = parseFloat(shares) || 0;
  const sharesBigInt = shareBalance
    ? (BigInt(Math.floor(sharesNum * 1e18)))
    : 0n;

  const estimatedToken0 =
    totalSupply && totalAssets && totalSupply > 0n && sharesBigInt > 0n
      ? (totalAssets[0] * sharesBigInt) / totalSupply
      : undefined;
  const estimatedToken1 =
    totalSupply && totalAssets && totalSupply > 0n && sharesBigInt > 0n
      ? (totalAssets[1] * sharesBigInt) / totalSupply
      : undefined;

  useEffect(() => {
    if (isSuccess) {
      setShares("");
      onSuccess?.();
    }
  }, [isSuccess, onSuccess]);

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 70% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center gap-2.5 mb-6">
        <ArrowUpFromLine className="h-5 w-5 text-[#4ade80]" />
        <h3 className="text-white font-semibold text-lg">
          Withdraw
        </h3>
      </div>
      <div className="space-y-4">
        <TokenInput
          symbol="cvLP"
          balance={shareBalance}
          decimals={18}
          value={shares}
          onChange={setShares}
          disabled={!isConnected || isPending}
        />

        {estimatedToken0 !== undefined && estimatedToken1 !== undefined && (
          <div className="text-sm text-text-secondary p-3 rounded-xl bg-black/20 border border-white/5">
            You will receive:
            <span className="inline-flex items-center gap-1 mx-1">
              <TokenIcon symbol={token0Symbol} size={14} />
              ~{formatTokenAmount(estimatedToken0, 18)} {token0Symbol}
            </span>
            +
            <span className="inline-flex items-center gap-1 mx-1">
              <TokenIcon symbol={token1Symbol} size={14} />
              ~{formatTokenAmount(estimatedToken1, 6)} {token1Symbol}
            </span>
          </div>
        )}

        <Button
          onClick={() => withdraw(shares)}
          disabled={!isConnected || !sharesNum || isPending}
          variant="outline"
          className="w-full h-12 border-accent-green/15 text-accent-green hover:bg-accent-green/5 font-mono font-bold rounded-full text-sm tracking-wide transition-all duration-300"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          {!isConnected ? "Connect Wallet" : "Withdraw"}
        </Button>

        {isSuccess && hash && (
          <div className="text-sm text-accent-green flex items-center gap-2 p-3 rounded-xl bg-accent-green/5 border border-accent-green/10">
            Success: <TxLink hash={hash} />
          </div>
        )}
      </div>
    </div>
  );
}
