"use client";

import { useState, useEffect, useMemo } from "react";
import { TokenInput } from "@/components/ui/token-input";
import { Button } from "@/components/ui/button";
import { TxLink } from "@/components/ui/tx-link";
import { useDeposit } from "@/hooks/use-deposit";
import { useTokenApproval } from "@/hooks/use-token-approval";
import { HOOK_ADDRESS } from "@/lib/constants";
import { parseUnits, formatUnits } from "viem";
import { Loader2, ArrowDownToLine, Check } from "lucide-react";
import { TokenIcon } from "@/components/ui/token-icon";

/**
 * Compute the token0/token1 deposit ratio from the pool's current sqrtPriceX96
 * and the active tick range. This matches how Uniswap v4 calculates liquidity
 * from amounts, so the paired amount won't be wasted.
 *
 * Returns { amount0Per1Liq, amount1Per1Liq } in human-readable units,
 * or null if data is missing or price is outside range.
 */
function computePoolRatio(
  sqrtPriceX96: bigint,
  tickLower: number,
  tickUpper: number,
  token0Decimals: number,
  token1Decimals: number,
): { ratio01: number; ratio10: number } | null {
  // sqrtPrice as a float: sqrtPriceX96 / 2^96
  const Q96 = 2 ** 96;
  const sqrtP = Number(sqrtPriceX96) / Q96;
  if (sqrtP === 0) return null;

  const sqrtLower = Math.sqrt(1.0001 ** tickLower);
  const sqrtUpper = Math.sqrt(1.0001 ** tickUpper);

  // Price is below range: position is 100% token0
  if (sqrtP <= sqrtLower) return null;
  // Price is above range: position is 100% token1
  if (sqrtP >= sqrtUpper) return null;

  // Amount of each token per unit of liquidity (in raw units)
  const amount0Raw = (1 / sqrtP) - (1 / sqrtUpper);
  const amount1Raw = sqrtP - sqrtLower;

  if (amount0Raw <= 0 || amount1Raw <= 0) return null;

  // Convert to human-readable by scaling for decimal difference
  const amount0Human = amount0Raw / (10 ** token0Decimals);
  const amount1Human = amount1Raw / (10 ** token1Decimals);

  // ratio01: how much token1 per 1 token0
  // ratio10: how much token0 per 1 token1
  return {
    ratio01: amount1Human / amount0Human,
    ratio10: amount0Human / amount1Human,
  };
}

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
  totalLiquidity?: bigint;
  sqrtPriceX96?: bigint;
  tickLower?: number;
  tickUpper?: number;
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
  totalLiquidity,
  sqrtPriceX96,
  tickLower,
  tickUpper,
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

  // Compute deposit ratio from sqrtPriceX96 + tick range (accurate even when liquidity is deployed)
  const poolRatio = useMemo(() => {
    if (sqrtPriceX96 == null || tickLower == null || tickUpper == null) return null;
    return computePoolRatio(sqrtPriceX96, tickLower, tickUpper, token0Decimals, token1Decimals);
  }, [sqrtPriceX96, tickLower, tickUpper, token0Decimals, token1Decimals]);

  // Auto-calculate paired amount based on pool's price ratio
  const handleAmount0Change = (val: string) => {
    setAmount0(val);
    setLastEdited(0);
    if (poolRatio && val && parseFloat(val) > 0) {
      const paired = (parseFloat(val) * poolRatio.ratio01).toFixed(token1Decimals > 8 ? 8 : token1Decimals);
      setAmount1(paired);
    } else if (!val || parseFloat(val) <= 0) {
      setAmount1("");
    }
  };

  const handleAmount1Change = (val: string) => {
    setAmount1(val);
    setLastEdited(1);
    if (poolRatio && val && parseFloat(val) > 0) {
      const paired = (parseFloat(val) * poolRatio.ratio10).toFixed(token0Decimals > 8 ? 8 : token0Decimals);
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
  // Uses the same formula as the hook: shares = (newLiquidity * totalSupply) / totalLiquidity
  // We estimate newLiquidity from amount0 using the sqrtPrice math.
  let estimatedShares: string | null = null;
  if (totalSupply && totalSupply > 0n && totalLiquidity && totalLiquidity > 0n && sqrtPriceX96 && tickLower != null && tickUpper != null && amount0Parsed > 0n) {
    const Q96 = 2n ** 96n;
    const sqrtPLower = Math.sqrt(1.0001 ** tickLower);
    const sqrtPUpper = Math.sqrt(1.0001 ** tickUpper);
    const sqrtP = Number(sqrtPriceX96) / Number(Q96);

    if (sqrtP > sqrtPLower && sqrtP < sqrtPUpper) {
      // amount0 = L * (1/sqrtP - 1/sqrtPUpper) → L = amount0 / (1/sqrtP - 1/sqrtPUpper)
      const denom = (1 / sqrtP) - (1 / sqrtPUpper);
      if (denom > 0) {
        const amount0Float = Number(formatUnits(amount0Parsed, token0Decimals));
        const estimatedLiquidity = amount0Float / denom;
        const totalLiqFloat = Number(totalLiquidity);
        const totalSupplyFloat = Number(formatUnits(totalSupply, 18));
        if (totalLiqFloat > 0) {
          const shares = (estimatedLiquidity / totalLiqFloat) * totalSupplyFloat;
          estimatedShares = shares.toFixed(4);
        }
      }
    }
  } else if (amount0Parsed > 0n && amount1Parsed > 0n && (!totalSupply || totalSupply === 0n)) {
    // First deposit: geometric mean
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
          <div className="w-8 h-8 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-[#999] text-xs font-mono">+</div>
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
            <span className="text-[#999] text-xs">You will receive</span>
            <span className="text-[#4ade80] text-sm font-mono font-medium">~{estimatedShares} cvLP</span>
          </div>
        )}

        {/* Ratio info when pool ratio is available */}
        {poolRatio && hasAmount && (
          <p className="text-xs text-[#999] px-1">Amounts auto-calculated to match pool ratio</p>
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
