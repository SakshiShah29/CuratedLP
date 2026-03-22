"use client";

import { ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useTransactionPopup } from "@blockscout/app-sdk";
import { shortenAddress, formatTokenAmount } from "@/lib/format";
import { TokenIcon } from "@/components/ui/token-icon";
import { BASE_SEPOLIA_CHAIN_ID } from "@/lib/constants";
import type { DepositedEvent, WithdrawnEvent } from "@/hooks/use-vault-events";

interface TransactionHistoryProps {
  deposits: DepositedEvent[];
  withdrawals: WithdrawnEvent[];
  token0Symbol?: string;
  token1Symbol?: string;
  isLoading: boolean;
}

type TxRow = {
  type: "Deposit" | "Withdraw";
  address: string;
  amount0: bigint;
  amount1: bigint;
  shares: bigint;
  txHash: string;
  blockNumber: bigint;
};

const PAGE_SIZE = 5;

export function TransactionHistory({
  deposits,
  withdrawals,
  token0Symbol = "Token0",
  token1Symbol = "Token1",
  isLoading,
}: TransactionHistoryProps) {
  const { address } = useAccount();
  const { openPopup } = useTransactionPopup();
  const [page, setPage] = useState(0);

  const handleViewAll = () => {
    openPopup({
      chainId: String(BASE_SEPOLIA_CHAIN_ID),
      address: address,
    });
  };

  const allRows: TxRow[] = [
    ...deposits.map((d) => ({
      type: "Deposit" as const,
      address: d.depositor,
      amount0: d.amount0,
      amount1: d.amount1,
      shares: d.shares,
      txHash: d.transactionHash,
      blockNumber: d.blockNumber,
    })),
    ...withdrawals.map((w) => ({
      type: "Withdraw" as const,
      address: w.withdrawer,
      amount0: w.amount0,
      amount1: w.amount1,
      shares: w.shares,
      txHash: w.transactionHash,
      blockNumber: w.blockNumber,
    })),
  ].sort((a, b) => Number(b.blockNumber - a.blockNumber));

  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const rows = allRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div
      className="rounded-2xl p-5 border border-[#2a2a2a] bg-[#141414] relative overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 100%, rgba(74, 222, 128, 0.08) 0%, transparent 50%), #141414",
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white text-lg font-semibold">Transaction History</h3>
        {address && (
          <button
            onClick={handleViewAll}
            className="inline-flex items-center gap-1.5 text-[#4ade80] text-xs hover:underline transition-colors"
          >
            View All
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-[#999] text-sm text-center py-8">Loading transactions...</p>
      ) : allRows.length === 0 ? (
        <p className="text-[#999] text-sm text-center py-8">No transactions yet</p>
      ) : (
        <>
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto premium-scrollbar">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#141414]">
                <tr className="text-[#999] text-xs">
                  <th className="text-left pb-3 font-normal">Type</th>
                  <th className="text-left pb-3 font-normal">Address</th>
                  <th className="text-right pb-3 font-normal">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <TokenIcon symbol={token0Symbol} size={14} />
                      {token0Symbol}
                    </span>
                  </th>
                  <th className="text-right pb-3 font-normal">
                    <span className="inline-flex items-center gap-1 justify-end">
                      <TokenIcon symbol={token1Symbol} size={14} />
                      {token1Symbol}
                    </span>
                  </th>
                  <th className="text-right pb-3 font-normal">Shares</th>
                  <th className="text-right pb-3 font-normal">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1a]">
                {rows.map((row, i) => (
                  <tr
                    key={`${row.txHash}-${i}`}
                    className={`border-l-2 ${
                      row.type === "Deposit" ? "border-l-[#4ade80]" : "border-l-[#ef4444]"
                    }`}
                  >
                    <td className="py-3 pl-3">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          row.type === "Deposit"
                            ? "bg-[#4ade80]/10 text-[#4ade80]"
                            : "bg-[#ef4444]/10 text-[#ef4444]"
                        }`}
                      >
                        {row.type}
                      </span>
                    </td>
                    <td className="py-3 text-white font-mono text-xs">
                      {shortenAddress(row.address)}
                    </td>
                    <td className="py-3 text-right text-white font-mono">
                      {formatTokenAmount(row.amount0)}
                    </td>
                    <td className="py-3 text-right text-white font-mono">
                      {formatTokenAmount(row.amount1)}
                    </td>
                    <td className="py-3 text-right text-[#4ade80] font-mono">
                      {formatTokenAmount(row.shares)}
                    </td>
                    <td className="py-3 text-right">
                      <a
                        href={`https://base-sepolia.blockscout.com/tx/${row.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#4ade80] hover:underline text-xs font-mono"
                      >
                        {row.txHash.slice(0, 6)}...
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#1a1a1a]">
              <span className="text-[#999] text-xs font-mono">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, allRows.length)} of {allRows.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg hover:bg-[#1a1a1a] transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="w-4 h-4 text-[#aaa]" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg hover:bg-[#1a1a1a] transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="w-4 h-4 text-[#aaa]" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
