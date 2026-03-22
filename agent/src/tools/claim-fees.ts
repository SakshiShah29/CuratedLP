/**
 * claim-fees.ts — CLI tool for OpenClaw
 *
 * Claims accrued performance fees via MetaMask delegation redemption.
 * The delegate calls DelegationManager, which routes through the
 * CuratedVaultCaveatEnforcer (target-check only, no fee bounds or
 * rate limit for claimPerformanceFee) and Agent Smart Account to
 * execute claimPerformanceFee() on the hook.
 *
 * Usage: npx tsx src/tools/claim-fees.ts
 *
 * Outputs JSON to stdout. Exits 0 on success, 1 on failure.
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  type Hex,
  type Address,
} from "viem";
import { logCycle } from "../lib/logger.js";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import {
  Implementation,
  toMetaMaskSmartAccount,
  getSmartAccountsEnvironment,
  redeemDelegations,
  ExecutionMode,
  ROOT_AUTHORITY,
} from "@metamask/smart-accounts-kit";

// ─── Configuration ──────────────────────────────────────────────────────────

const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;
const MOLTBOT_KEY = process.env.MOLTBOT_PRIVATE_KEY as Hex;
const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;
const ENFORCER_ADDRESS = process.env.ENFORCER_ADDRESS as Address;

// Token0 address (MockERC20 on Base Sepolia — from poolKey.currency0)
const TOKEN0_ADDRESS = "0xb06794b116533EA0948009eCFa268c8E690902F1" as Address;
const TOKEN1_ADDRESS = "0xF4Ac05194da1e2A0af24Fb22d9471935371aC355" as Address;

const MIN_FEE = Number(process.env.DELEGATION_MIN_FEE ?? "100");
const MAX_FEE = Number(process.env.DELEGATION_MAX_FEE ?? "50000");
const MIN_BLOCK_INTERVAL = Number(process.env.DELEGATION_MIN_BLOCK_INTERVAL ?? "30");

const chain = baseSepolia;

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!CURATOR_KEY || !MOLTBOT_KEY || !RPC_URL || !HOOK_ADDRESS || !ENFORCER_ADDRESS) {
    console.error(JSON.stringify({
      error: "Missing required env vars: CURATOR_PRIVATE_KEY, MOLTBOT_PRIVATE_KEY, BASE_SEPOLIA_RPC, HOOK_ADDRESS, ENFORCER_ADDRESS"
    }));
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const environment = getSmartAccountsEnvironment(chain.id);

  // Pre-flight: check hook's idle token0 balance covers the accrued fee.
  // After a rebalance all token0 is deployed as liquidity — the hook has no
  // idle balance to pay from. Skip gracefully rather than hitting a Panic.
  const [accruedFee0, accruedFee1, hookBalance0, hookBalance1] = await Promise.all([
    publicClient.readContract({
      address: HOOK_ADDRESS,
      abi: [{ type: "function", name: "accruedPerformanceFee0", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "accruedPerformanceFee0",
    }),
    publicClient.readContract({
      address: HOOK_ADDRESS,
      abi: [{ type: "function", name: "accruedPerformanceFee1", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "accruedPerformanceFee1",
    }),
    publicClient.readContract({
      address: TOKEN0_ADDRESS,
      abi: [{ type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "balanceOf",
      args: [HOOK_ADDRESS],
    }),
    publicClient.readContract({
      address: TOKEN1_ADDRESS,
      abi: [{ type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "balanceOf",
      args: [HOOK_ADDRESS],
    }),
  ]);

  if (accruedFee0 === 0n && accruedFee1 === 0n) {
    console.log(JSON.stringify({ success: false, error: "NoFeesToClaim" }, null, 2));
    process.exit(0);
  }

  if (hookBalance0 < accruedFee0 && hookBalance1 < accruedFee1) {
    console.log(JSON.stringify({
      success: false,
      error: "InsufficientHookBalance",
      accruedFee0: accruedFee0.toString(),
      accruedFee1: accruedFee1.toString(),
      hookToken0Balance: hookBalance0.toString(),
      hookToken1Balance: hookBalance1.toString(),
      note: "Fees track swap volume but token0, token1 is deployed as liquidity. Will be claimable after next rebalance collects LP fees.",
    }, null, 2));
    process.exit(0); // Not an error — try again after next rebalance
  }

  const curatorSigner = privateKeyToAccount(CURATOR_KEY);
  const curatorSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [curatorSigner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: curatorSigner },
  });

  const moltbotSigner = privateKeyToAccount(MOLTBOT_KEY);
  const moltbotWalletClient = createWalletClient({
    account: moltbotSigner,
    chain,
    transport: http(RPC_URL),
  });

  // Build the signed delegation (same terms as execute-rebalance).
  const terms = encodeAbiParameters(
    parseAbiParameters("address, uint24, uint24, uint64"),
    [HOOK_ADDRESS, MIN_FEE, MAX_FEE, BigInt(MIN_BLOCK_INTERVAL)]
  );

  const delegation = {
    delegate: moltbotSigner.address as Hex,
    delegator: curatorSmartAccount.address as Hex,
    authority: ROOT_AUTHORITY as Hex,
    caveats: [{ enforcer: ENFORCER_ADDRESS, terms, args: "0x" as Hex }],
    salt: toHex(0n),
    signature: "0x" as Hex,
  };

  const signature = await curatorSmartAccount.signDelegation({ delegation });
  const signedDelegation = { ...delegation, signature: signature as Hex };

  // Encode claimPerformanceFee calldata.
  const claimCalldata = encodeFunctionData({
    abi: [{
      type: "function",
      name: "claimPerformanceFee",
      inputs: [],
      outputs: [],
    }],
    functionName: "claimPerformanceFee",
    args: [],
  });

  const txHash = await redeemDelegations(
    moltbotWalletClient as any,
    publicClient as any,
    environment.DelegationManager as Address,
    [{
      permissionContext: [signedDelegation],
      executions: [{ target: HOOK_ADDRESS, value: 0n, callData: claimCalldata }],
      mode: ExecutionMode.SingleDefault,
    }]
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  const success = receipt.status === "success";
  console.log(JSON.stringify({
    success,
    txHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));

  if (success) {
    logCycle({
      timestamp: new Date().toISOString(),
      action: "CLAIMED",
      summary: "Claimed accrued performance fees",
      txHash,
    });
  }
}

main().catch((err) => {
  const msg: string = err.message ?? String(err);
  // CuratedVaultHook_NoFeesToClaim() — not an error, just nothing to claim yet.
  const noFees = msg.includes("0x69d4b6b7") || msg.includes("NoFeesToClaim");
  console.log(JSON.stringify({
    success: false,
    error: noFees ? "NoFeesToClaim" : msg.slice(0, 200),
  }, null, 2));
  if (!noFees) {
    logCycle({
      timestamp: new Date().toISOString(),
      action: "ERROR",
      summary: `Fee claim failed: ${msg.slice(0, 120)}`,
      error: msg.slice(0, 200),
    });
  }
  // Exit 0 for NoFeesToClaim — it's an expected condition, not a failure.
  process.exit(noFees ? 0 : 1);
});
