"use client";

import { ExternalLink } from "lucide-react";
import { BASESCAN_URL } from "@/lib/constants";
import { shortenAddress } from "@/lib/format";

interface TxLinkProps {
  hash: string;
}

export function TxLink({ hash }: TxLinkProps) {
  return (
    <a
      href={`${BASESCAN_URL}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-sm text-accent-blue hover:underline"
    >
      {shortenAddress(hash)}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
