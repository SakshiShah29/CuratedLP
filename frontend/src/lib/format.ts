import { formatUnits } from "viem";

export function formatTokenAmount(
  amount: bigint | undefined,
  decimals: number = 18,
  displayDecimals: number = 4
): string {
  if (amount === undefined) return "0";
  const formatted = formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

export function formatFee(fee: number | undefined): string {
  if (fee === undefined) return "—";
  return `${(fee / 10000).toFixed(2)}%`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isFullRange(tickLower: number, tickUpper: number): boolean {
  return tickLower <= -887200 && tickUpper >= 887200;
}

export function tickToPrice(tick: number): string {
  if (tick <= -887200) return "0";
  if (tick >= 887200) return "∞";
  const price = Math.pow(1.0001, tick);
  if (price < 0.001) return price.toExponential(2);
  if (price > 1_000_000) return price.toExponential(2);
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function formatLargeNumber(num: number): string {
  if (num >= 1e15) return `${(num / 1e15).toFixed(2)}Q`;
  if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

export function formatSharePrice(
  totalAsset: bigint | undefined,
  totalSupply: bigint | undefined,
  decimals: number = 18
): string {
  if (!totalAsset || !totalSupply || totalSupply === 0n) return "0.0000";
  const scaled = (totalAsset * 10000n) / totalSupply;
  const num = Number(scaled) / 10000;
  const formatted = formatUnits(totalAsset * 10n ** 18n / totalSupply, decimals);
  return parseFloat(formatted).toFixed(4);
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
