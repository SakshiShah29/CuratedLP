"use client";

import Image from "next/image";

const TOKEN_LOGOS: Record<string, string> = {
  mUSDC: "/usdc.png",
  USDC: "/usdc.png",
  mwstETH: "/wsteth.png",
  wstETH: "/wsteth.png",
};

interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenIcon({ symbol, size = 20, className = "" }: TokenIconProps) {
  const src = TOKEN_LOGOS[symbol];

  if (!src) {
    return (
      <div
        className={`rounded-full bg-[#2a2a2a] flex items-center justify-center text-[#888] font-bold ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={symbol}
      width={size}
      height={size}
      className={`rounded-full ${className}`}
    />
  );
}
