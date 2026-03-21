"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useBasename } from "@/hooks/use-basename";
import { shortenAddress } from "@/lib/format";

interface AddressDisplayProps {
  address: `0x${string}`;
}

export function AddressDisplay({ address }: AddressDisplayProps) {
  const { basename } = useBasename(address);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm">
      {basename ? (
        <span className="text-accent-green">{basename}</span>
      ) : (
        <span className="text-text-secondary">{shortenAddress(address)}</span>
      )}
      <button
        onClick={handleCopy}
        className="text-text-secondary hover:text-text-primary transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}
