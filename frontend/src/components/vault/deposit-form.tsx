"use client";

import { useState, useEffect } from "react";
import { TokenInput } from "@/components/ui/token-input";
import { Button } from "@/components/ui/button";
import { TxLink } from "@/components/ui/tx-link";
import { useDeposit } from "@/hooks/use-deposit";
import { useTokenApproval } from "@/hooks/use-token-approval";
import { HOOK_ADDRESS } from "@/lib/constants";
import { parseUnits, formatUnits } from "viem";
import { Loader2, ArrowDownToLine, Check } from "lucide-react";
import { TokenIcon } from "@/components/ui/token-icon";

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
  totalAssets?: [bigint, bigint];
  totalSupply?: bigint;
  isConnected: boolean;
  onSuccess?: () => void;
  refetchAllowances?: () => void;
}

export function DepositForm({
  token0Address,
  token1Address,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  token0Balance,
  token1Balance,
  token0Decimals = 18,
  token1Decimals = 18,
  token0Allowance,
  token1Allowance,
  totalAssets,
  totalSupply,
  isConnected,
  onSuccess,
  refetchAllowances,
}: DepositFormProps) {
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const [lastEdited, setLastEdited] = useState<0 | 1>(0);
  const { deposit, isPending: isDepositing, isSuccess, hash, error: depositError, reset } = useDeposit();

  // Separate approval hooks for each token
  const {
    approve: approveToken0,
    isPending: isApproving0,
    isSuccess: approval0Success,
  } = useTokenApproval();
  const {
    approve: approveToken1,
    isPending: isApproving1,
    isSuccess: approval1Success,
  } = useTokenApproval();

  // Auto-calculate paired amount based on vault's current asset ratio
  const handleAmount0Change = (val: string) => {
    setAmount0(val);
    setLastEdited(0);
    if (totalAssets && totalAssets[0] > 0n && totalAssets[1] > 0n && val && parseFloat(val) > 0) {
      const asset0 = Number(formatUnits(totalAssets[0], token0Decimals));
      const asset1 = Number(formatUnits(totalAssets[1], token1Decimals));
      const ratio = asset1 / asset0;
      const paired = (parseFloat(val) * ratio).toFixed(token1Decimals > 8 ? 8 : token1Decimals);
      setAmount1(paired);
    } else if (!val || parseFloat(val) <= 0) {
      setAmount1("");
    }
  };

  const handleAmount1Change = (val: string) => {
    setAmount1(val);
    setLastEdited(1);
    if (totalAssets && totalAssets[0] > 0n && totalAssets[1] > 0n && val && parseFloat(val) > 0) {
      const asset0 = Number(formatUnits(totalAssets[0], token0Decimals));
      const asset1 = Number(formatUnits(totalAssets[1], token1Decimals));
      const ratio = asset0 / asset1;
      const paired = (parseFloat(val) * ratio).toFixed(token0Decimals > 8 ? 8 : token0Decimals);
      setAmount0(paired);
    } else if (!val || parseFloat(val) <= 0) {
      setAmount0("");
    }
  };

  const amount0Parsed =
    amount0 && parseFloat(amount0) > 0
      ? parseUnits(amount0, token0Decimals)
      : 0n;
  const amount1Parsed =
    amount1 && parseFloat(amount1) > 0
      ? parseUnits(amount1, token1Decimals)
      : 0n;

  // Treat undefined allowance as 0 (conservative: require approval)
  const effectiveAllowance0 = token0Allowance ?? 0n;
  const effectiveAllowance1 = token1Allowance ?? 0n;

  // Check on-chain allowance OR session approval success
  const token0Approved = approval0Success || (amount0Parsed > 0n && amount0Parsed <= effectiveAllowance0);
  const token1Approved = approval1Success || (amount1Parsed > 0n && amount1Parsed <= effectiveAllowance1);

  const needsApproval0 = amount0Parsed > 0n && !token0Approved;
  const needsApproval1 = amount1Parsed > 0n && !token1Approved;

  const hasAmount = amount0Parsed > 0n && amount1Parsed > 0n;
  const canDeposit =
    isConnected && hasAmount && !needsApproval0 && !needsApproval1;

  // Refetch allowances after each approval confirms
  useEffect(() => {
    if (approval0Success) refetchAllowances?.();
  }, [approval0Success]);
  useEffect(() => {
    if (approval1Success) refetchAllowances?.();
  }, [approval1Success]);

  // Estimate shares user will receive
  let estimatedShares: string | null = null;
  if (totalSupply && totalAssets && totalSupply > 0n && amount0Parsed > 0n) {
    const [asset0] = totalAssets;
    if (asset0 > 0n) {
      const shares = (amount0Parsed * totalSupply) / asset0;
      estimatedShares = Number(formatUnits(shares, 18)).toFixed(4);
    }
  } else if (amount0Parsed > 0n && amount1Parsed > 0n && (!totalSupply || totalSupply === 0n)) {
    const val = Math.sqrt(
      Number(formatUnits(amount0Parsed, token0Decimals)) *
      Number(formatUnits(amount1Parsed, token1Decimals))
    );
    estimatedShares = val.toFixed(4);
  }

  // Track submitted amounts for success message (cleared on new deposit)
  const [submitted, setSubmitted] = useState<{ a0: string; a1: string } | null>(null);

  useEffect(() => {
    if (isSuccess) {
      setAmount0("");
      setAmount1("");
      onSuccess?.();
    }
  }, [isSuccess, onSuccess]);

  const handleDeposit = () => {
    setSubmitted({ a0: amount0, a1: amount1 });
    deposit(
      amount0 || "0",
      amount1 || "0",
      token0Decimals,
      token1Decimals
    );
  };

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(74, 222, 128, 0.15) 0%, transparent 50%), #141414" }}
    >
      <div className="flex items-center gap-2.5 mb-5">
        <ArrowDownToLine className="h-5 w-5 text-[#4ade80]" />
        <h3 className="text-white font-semibold text-lg">Deposit</h3>
      </div>

      <div className="space-y-4">
        {/* Token 0 input */}
        <TokenInput
          symbol={token0Symbol}
          balance={token0Balance}
          decimals={token0Decimals}
          value={amount0}
          onChange={handleAmount0Change}
          disabled={!isConnected || isDepositing}
        />

        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[#666] text-xs font-mono">+</div>
        </div>

        {/* Token 1 input */}
        <TokenInput
          symbol={token1Symbol}
          balance={token1Balance}
          decimals={token1Decimals}
          value={amount1}
          onChange={handleAmount1Change}
          disabled={!isConnected || isDepositing}
        />

        {/* Allowance status indicators */}
        {hasAmount && (
          <div className="flex gap-3">
            <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${
              token0Approved
                ? "bg-[#4ade80]/5 border-[#4ade80]/20 text-[#4ade80]"
                : "bg-[#FFD93D]/5 border-[#FFD93D]/20 text-[#FFD93D]"
            }`}>
              {token0Approved ? <Check className="h-3 w-3 shrink-0" /> : <Loader2 className="h-3 w-3 shrink-0" />}
              {token0Symbol}: {token0Approved ? "Approved" : "Needs approval"}
            </div>
            <div className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${
              token1Approved
                ? "bg-[#4ade80]/5 border-[#4ade80]/20 text-[#4ade80]"
                : "bg-[#FFD93D]/5 border-[#FFD93D]/20 text-[#FFD93D]"
            }`}>
              {token1Approved ? <Check className="h-3 w-3 shrink-0" /> : <Loader2 className="h-3 w-3 shrink-0" />}
              {token1Symbol}: {token1Approved ? "Approved" : "Needs approval"}
            </div>
          </div>
        )}

        {/* Sequential approval: token0 first, then token1 */}
        {needsApproval0 && token0Address && (
          <Button
            onClick={() => approveToken0(token0Address, HOOK_ADDRESS)}
            disabled={isApproving0}
            className="w-full h-11 bg-[#FFD93D]/10 text-[#FFD93D] border border-[#FFD93D]/20 font-mono rounded-xl hover:bg-[#FFD93D]/20"
          >
            {isApproving0 ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {needsApproval1 ? "Step 1: " : ""}Approve {token0Symbol}
          </Button>
        )}

        {!needsApproval0 && needsApproval1 && token1Address && (
          <Button
            onClick={() => approveToken1(token1Address, HOOK_ADDRESS)}
            disabled={isApproving1}
            className="w-full h-11 bg-[#FFD93D]/10 text-[#FFD93D] border border-[#FFD93D]/20 font-mono rounded-xl hover:bg-[#FFD93D]/20"
          >
            {isApproving1 ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {token0Approved ? "Step 2: " : ""}Approve {token1Symbol}
          </Button>
        )}

        {estimatedShares && (
          <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
            <span className="text-[#666] text-xs">You will receive</span>
            <span className="text-[#4ade80] text-sm font-mono font-medium">~{estimatedShares} cvLP</span>
          </div>
        )}

        {/* Ratio info when vault has assets */}
        {totalAssets && totalAssets[0] > 0n && totalAssets[1] > 0n && hasAmount && (
          <p className="text-xs text-[#666] px-1">Amounts auto-calculated to match pool ratio</p>
        )}

        <Button
          onClick={handleDeposit}
          disabled={!canDeposit || isDepositing}
          className="w-full h-12 bg-[#4ade80] text-black font-mono font-bold hover:bg-[#22c55e] rounded-xl text-sm tracking-wide transition-all duration-300"
        >
          {isDepositing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {!isConnected
            ? "Connect Wallet"
            : needsApproval0 || needsApproval1
              ? "Approve tokens first"
              : `Deposit ${token0Symbol} + ${token1Symbol}`}
        </Button>

        {/* Deposit error display */}
        {depositError && (
          <div className="text-sm text-[#f87171] p-3 rounded-xl bg-[#f87171]/5 border border-[#f87171]/10 break-all">
            {depositError.message?.includes("SlippageExceeded")
              ? "Transaction failed: slippage exceeded. The pool ratio may have changed — try again."
              : depositError.message?.includes("User rejected")
                ? "Transaction rejected by wallet."
                : `Error: ${(depositError as any).shortMessage || depositError.message || "Transaction failed"}`}
          </div>
        )}

        {isSuccess && hash && (
          <div className="text-sm text-[#4ade80] p-3 rounded-xl bg-[#4ade80]/5 border border-[#4ade80]/10 space-y-2">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0" /> Deposit successful
            </div>
            {submitted && (
              <div className="text-xs font-mono pl-6 space-y-0.5 text-[#4ade80]/70">
                <p className="flex items-center gap-1.5">
                  <TokenIcon symbol={token0Symbol} size={14} /> {submitted.a0} {token0Symbol} deposited
                </p>
                <p className="flex items-center gap-1.5">
                  <TokenIcon symbol={token1Symbol} size={14} /> {submitted.a1} {token1Symbol} deposited
                </p>
                <p className="flex items-center gap-1.5 text-[#4ade80]">
                  <Check className="h-3 w-3" /> cvLP shares minted
                </p>
              </div>
            )}
            <div className="pl-6"><TxLink hash={hash} /></div>
          </div>
        )}
      </div>
    </div>
  );
}
