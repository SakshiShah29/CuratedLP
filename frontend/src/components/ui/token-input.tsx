"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatTokenAmount } from "@/lib/format";

interface TokenInputProps {
  symbol: string;
  balance?: bigint;
  decimals: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function TokenInput({
  symbol,
  balance,
  decimals,
  value,
  onChange,
  disabled,
}: TokenInputProps) {
  const handleMax = () => {
    if (balance !== undefined) {
      const formatted = (Number(balance) / Math.pow(10, decimals)).toString();
      onChange(formatted);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs px-1">
        <span className="text-text-primary/70 font-medium">{symbol}</span>
        <span className="text-text-secondary">
          Balance:{" "}
          <span className="font-mono text-text-primary/70">
            {formatTokenAmount(balance, decimals)}
          </span>
        </span>
      </div>
      <div className="relative flex items-center rounded-2xl bg-black/30 border border-white/6 focus-within:border-accent-green/25 transition-all duration-200">
        <Input
          type="number"
          placeholder="0.0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="font-mono bg-transparent border-0 text-white text-lg h-12 focus-visible:ring-0 focus-visible:border-0 placeholder:text-white/20"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleMax}
          disabled={disabled || !balance}
          className="mr-2 text-accent-green/70 hover:text-accent-green hover:bg-accent-green/10 font-mono text-xs font-bold rounded-lg"
        >
          MAX
        </Button>
      </div>
    </div>
  );
}
