"use client";

import { useNotification } from "@blockscout/app-sdk";
import { BASE_SEPOLIA_CHAIN_ID } from "@/lib/constants";

export function useBlockscoutToast() {
  const { openTxToast } = useNotification();

  const showTxToast = (hash: string) => {
    openTxToast(String(BASE_SEPOLIA_CHAIN_ID), hash);
  };

  return { showTxToast };
}
