/**
 * execute-rebalance.ts — CLI tool for OpenClaw
 *
 * Triggers a rebalance via MetaMask delegation redemption.
 * The Locus wallet (delegate) calls DelegationManager, which routes
 * through the CuratedVaultCaveatEnforcer and Agent Smart Account
 * to execute rebalance() on the hook. Smart Account pays gas.
 *
 * Usage: npx tsx src/tools/execute-rebalance.ts --tickLower -120 --tickUpper 120 --fee 3000
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

// ─── Parse CLI args ─────────────────────────────────────────────────────────

function parseArgs(): { tickLower: number; tickUpper: number; fee: number } {
  const args = process.argv.slice(2);
  let tickLower = 0, tickUpper = 0, fee = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tickLower" && args[i + 1]) tickLower = Number(args[++i]);
    if (args[i] === "--tickUpper" && args[i + 1]) tickUpper = Number(args[++i]);
    if (args[i] === "--fee" && args[i + 1]) fee = Number(args[++i]);
  }

  if (tickLower === 0 && tickUpper === 0 && fee === 0) {
    console.error(JSON.stringify({
      error: "Usage: npx tsx src/tools/execute-rebalance.ts --tickLower -120 --tickUpper 120 --fee 3000"
    }));
    process.exit(1);
  }

  return { tickLower, tickUpper, fee };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { tickLower, tickUpper, fee } = parseArgs();

  if (!CURATOR_KEY || !MOLTBOT_KEY || !RPC_URL || !HOOK_ADDRESS || !ENFORCER_ADDRESS) {
    console.error(JSON.stringify({
      error: "Missing required env vars: CURATOR_PRIVATE_KEY, MOLTBOT_PRIVATE_KEY, BASE_SEPOLIA_RPC, HOOK_ADDRESS, ENFORCER_ADDRESS"
    }));
    process.exit(1);
  }

  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const environment = getSmartAccountsEnvironment(chain.id);

  // Derive the same Curator Smart Account used during setup.
  const curatorSigner = privateKeyToAccount(CURATOR_KEY);
  const curatorSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [curatorSigner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: curatorSigner },
  });

  // Moltbot EOA (the delegate / trigger) calls redeemDelegations.
  const moltbotSigner = privateKeyToAccount(MOLTBOT_KEY);
  const moltbotWalletClient = createWalletClient({
    account: moltbotSigner,
    chain,
    transport: http(RPC_URL),
  });

  // Build the signed delegation (same as delegation.ts createSignedDelegation).
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

  // Encode rebalance calldata.
  const rebalanceCalldata = encodeFunctionData({
    abi: [{
      type: "function",
      name: "rebalance",
      inputs: [
        { name: "newTickLower", type: "int24" },
        { name: "newTickUpper", type: "int24" },
        { name: "newFee", type: "uint24" },
        { name: "maxIdleToken0", type: "uint256" },
        { name: "maxIdleToken1", type: "uint256" },
      ],
      outputs: [],
    }],
    functionName: "rebalance",
    args: [tickLower, tickUpper, fee, 2n ** 256n - 1n, 2n ** 256n - 1n], // type(uint256).max — skip idle dust check
  });

  // Redeem the delegation.
  const txHash = await redeemDelegations(
    moltbotWalletClient as any,
    publicClient as any,
    environment.DelegationManager as Address,
    [{
      permissionContext: [signedDelegation],
      executions: [{ target: HOOK_ADDRESS, value: 0n, callData: rebalanceCalldata }],
      mode: ExecutionMode.SingleDefault,
    }]
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  console.log(JSON.stringify({
    success: receipt.status === "success",
    txHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    tickLower,
    tickUpper,
    fee,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    success: false,
    error: err.message ?? String(err),
  }));
  process.exit(1);
});
