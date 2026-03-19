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

  console.log(JSON.stringify({
    success: receipt.status === "success",
    txHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    success: false,
    error: err.message ?? String(err),
  }));
  process.exit(1);
});
