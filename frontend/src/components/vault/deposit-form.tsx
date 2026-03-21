"use client";

import { useState, useEffect } from "react";
import { TokenInput } from "@/components/ui/token-input";
import { Button } from "@/components/ui/button";
import { TxLink } from "@/components/ui/tx-link";
import { useDeposit } from "@/hooks/use-deposit";
import { useTokenApproval } from "@/hooks/use-token-approval";
import { HOOK_ADDRESS } from "@/lib/constants";
import { parseUnits } from "viem";
import { Loader2, ArrowDownToLine } from "lucide-react";

interface DepositFormProps {
  token0Address?: `0x${string}`;
  token1Address?: `0x${string}`;
  token0Symbol?: string;
  token1Symbol?: string;
  token0Balance?: bigint;
  token1Balance?: bigint;
  token0Decimals?: number;
  token1Decimals?: number;
  token0Allowance?: bigint;
  token1Allowance?: bigint;
  isConnected: boolean;
  onSuccess?: () => void;
}

export function DepositForm({
  token0Address,
  token1Address,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  token0Balance,
  token1Balance,
  token0Decimals = 18,
  token1Decimals = 6,
  token0Allowance,
  token1Allowance,
  isConnected,
  onSuccess,
}: DepositFormProps) {
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const { deposit, isPending: isDepositing, isSuccess, hash, reset } = useDeposit();
  const {
    approve: approveToken,
    isPending: isApproving,
    isSuccess: approvalSuccess,
  } = useTokenApproval();

  const amount0Parsed =
    amount0 && parseFloat(amount0) > 0
      ? parseUnits(amount0, token0Decimals)
      : 0n;
  const amount1Parsed =
    amount1 && parseFloat(amount1) > 0
      ? parseUnits(amount1, token1Decimals)
      : 0n;

  const needsApproval0 =
    token0Allowance !== undefined && amount0Parsed > token0Allowance;
  const needsApproval1 =
    token1Allowance !== undefined && amount1Parsed > token1Allowance;

  const canDeposit =
    isConnected &&
    (parseFloat(amount0) > 0 || parseFloat(amount1) > 0) &&
    !needsApproval0 &&
    !needsApproval1;

  useEffect(() => {
    if (isSuccess) {
      setAmount0("");
      setAmount1("");
      onSuccess?.();
    }
  }, [isSuccess, onSuccess]);

  const handleDeposit = () => {
    deposit(amount0 || "0", amount1 || "0", token0Decimals, token1Decimals);
  };

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center gap-2.5 mb-6">
        <ArrowDownToLine className="h-5 w-5 text-[#4ade80]" />
        <h3 className="text-white font-semibold text-lg">
          Deposit
        </h3>
      </div>
      <div className="space-y-4">
        <TokenInput
          symbol={token0Symbol}
          balance={token0Balance}
          decimals={token0Decimals}
          value={amount0}
          onChange={setAmount0}
          disabled={!isConnected || isDepositing}
        />
        <TokenInput
          symbol={token1Symbol}
          balance={token1Balance}
          decimals={token1Decimals}
          value={amount1}
          onChange={setAmount1}
          disabled={!isConnected || isDepositing}
        />

        {needsApproval0 && token0Address && (
          <Button
            onClick={() => approveToken(token0Address, HOOK_ADDRESS)}
            disabled={isApproving}
            className="w-full h-11 bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20 font-mono rounded-xl hover:bg-accent-yellow/20"
          >
            {isApproving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Approve {token0Symbol}
          </Button>
        )}

        {needsApproval1 && token1Address && (
          <Button
            onClick={() => approveToken(token1Address, HOOK_ADDRESS)}
            disabled={isApproving}
            className="w-full h-11 bg-accent-yellow/10 text-accent-yellow border border-accent-yellow/20 font-mono rounded-xl hover:bg-accent-yellow/20"
          >
            {isApproving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Approve {token1Symbol}
          </Button>
        )}

        <Button
          onClick={handleDeposit}
          disabled={!canDeposit || isDepositing}
          className="w-full h-12 bg-accent-green text-black font-mono font-bold hover:bg-accent-green/90 rounded-full text-sm tracking-wide shadow-[0_0_24px_rgba(167,239,158,0.15)] hover:shadow-[0_0_32px_rgba(167,239,158,0.25)] transition-all duration-300"
        >
          {isDepositing ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : null}
          {!isConnected ? "Connect Wallet" : "Deposit"}
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
