/**
 * delegation.ts — Phase 3: MetaMask Delegation Lifecycle (v0.4.0-beta.1 API)
 *
 * Full flow:
 *   1. Create Curator Smart Account (delegator) + Moltbot EOA wallet (delegate)
 *   2. Curator Smart Account calls registerCurator() on the hook (already done in setup.ts)
 *   3. Curator Smart Account signs a delegation to Moltbot with caveat bounds
 *   4. Moltbot redeems the delegation → DelegationManager calls curatorSA.execute(hook.rebalance())
 *
 * API changes vs v0.3.x:
 *   - DelegationManager export removed → use redeemDelegations() standalone function
 *   - hashDelegation removed → use createDelegation({ parentDelegation }) for sub-delegation
 *   - Moltbot is an EOA walletClient making a regular tx (not a UserOp)
 *   - curatorSmartAccount.signDelegation({ delegation }) → still works, returns Hex
 *
 * Run: npx tsx src/delegation.ts
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
  formatEther,
  parseEther,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createBundlerClient } from "viem/account-abstraction";
import {
  Implementation,
  toMetaMaskSmartAccount,
  getSmartAccountsEnvironment,
  redeemDelegations,
  ExecutionMode,
  ROOT_AUTHORITY,
} from "@metamask/smart-accounts-kit";

// ─── Configuration ────────────────────────────────────────────────────────────

const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;
const MOLTBOT_KEY = process.env.MOLTBOT_PRIVATE_KEY as Hex;
const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const PIMLICO_KEY = process.env.PIMLICO_API_KEY!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;
const ENFORCER_ADDRESS = process.env.ENFORCER_ADDRESS as Address;
const ERC8004_IDENTITY_ID = BigInt(process.env.ERC8004_IDENTITY_ID ?? "0");
const PERFORMANCE_FEE_BPS = Number(process.env.PERFORMANCE_FEE_BPS ?? "1000");

// Caveat bounds for the Moltbot delegation
const MIN_FEE = 100;       // 0.01%
const MAX_FEE = 50000;     // 5.00%
const MIN_BLOCK_INTERVAL = 30;

const chain = baseSepolia;

// ─── Clients ──────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

// Bundler client — for Curator SA UserOps (registerCurator).
const bundlerClient = createBundlerClient({
  client: publicClient as any,
  transport: http(
    `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${PIMLICO_KEY}`
  ),
});

// Resolve MetaMask Delegation Framework addresses for Base Sepolia.
const environment = getSmartAccountsEnvironment(chain.id);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function encodeCaveatTerms(
  hookAddress: Address,
  minFee: number,
  maxFee: number,
  minBlockInterval: number
): Hex {
  return encodeAbiParameters(
    parseAbiParameters("address, uint24, uint24, uint64"),
    [hookAddress, minFee, maxFee, BigInt(minBlockInterval)]
  );
}

/**
 * CRITICAL: Must match the hook's 5-param signature exactly.
 * rebalance(int24,int24,uint24,uint256,uint256) — enforcer requires 164 bytes.
 */
function encodeRebalanceCalldata(
  tickLower: number,
  tickUpper: number,
  fee: number,
  maxIdleToken0 = 0n,
  maxIdleToken1 = 0n
): Hex {
  return encodeFunctionData({
    abi: [
      {
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
      },
    ],
    functionName: "rebalance",
    args: [tickLower, tickUpper, fee, maxIdleToken0, maxIdleToken1],
  });
}

// ─── Step 1: Create Accounts ──────────────────────────────────────────────────

export async function createAccounts() {
  const curatorSigner = privateKeyToAccount(CURATOR_KEY);
  const moltbotSigner = privateKeyToAccount(MOLTBOT_KEY);

  // Curator uses a Smart Account — the DelegationManager calls curatorSA.execute()
  // when redeeming, so msg.sender in hook = curatorSA address.
  const curatorSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [curatorSigner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: curatorSigner },
  });

  // Moltbot is a plain EOA walletClient — calls redeemDelegations() as a regular tx.
  // Needs a small amount of ETH for gas (~0.001 ETH).
  const moltbotWalletClient = createWalletClient({
    account: moltbotSigner,
    chain,
    transport: http(RPC_URL),
  });

  console.log("Curator Smart Account:", curatorSmartAccount.address);
  console.log("Moltbot EOA:          ", moltbotSigner.address);

  // Ensure Moltbot has ETH for gas.
  const moltbotBalance = await publicClient.getBalance({ address: moltbotSigner.address });
  if (moltbotBalance < parseEther("0.001")) {
    console.log(`\nMoltbot EOA balance: ${formatEther(moltbotBalance)} ETH — funding from curator EOA...`);
    const curatorWalletClient = createWalletClient({
      account: curatorSigner,
      chain,
      transport: http(RPC_URL),
    });
    const fundHash = await curatorWalletClient.sendTransaction({
      to: moltbotSigner.address,
      value: parseEther("0.002"),
    });
    await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log("  Moltbot funded ✓\n");
  }

  return { curatorSmartAccount, moltbotWalletClient, moltbotSigner };
}

// ─── Step 2: Register Curator (if not already done) ──────────────────────────

export async function registerCuratorIfNeeded(
  curatorSmartAccount: Awaited<ReturnType<typeof toMetaMaskSmartAccount>>
) {
  const HOOK_ABI = [
    {
      type: "function",
      name: "curatorByWallet",
      inputs: [{ name: "wallet", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
    {
      type: "function",
      name: "registerCurator",
      inputs: [
        { name: "performanceFeeBps", type: "uint256" },
        { name: "erc8004IdentityId", type: "uint256" },
      ],
      outputs: [{ name: "curatorId", type: "uint256" }],
    },
  ] as const;

  const existing = (await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: "curatorByWallet",
    args: [curatorSmartAccount.address],
  })) as bigint;

  if (existing > 0n) {
    console.log(`✓ Curator SA already registered (curatorId=${existing})`);
    return;
  }

  if (ERC8004_IDENTITY_ID === 0n) {
    throw new Error(
      "ERC8004_IDENTITY_ID not set in .env — run `npx tsx src/setup.ts` first."
    );
  }

  console.log("\n--- Registering curator on hook ---");
  const calldata = encodeFunctionData({
    abi: HOOK_ABI,
    functionName: "registerCurator",
    args: [BigInt(PERFORMANCE_FEE_BPS), ERC8004_IDENTITY_ID],
  });

  const userOpHash = await bundlerClient.sendUserOperation({
    account: curatorSmartAccount,
    calls: [{ to: HOOK_ADDRESS, data: calldata }],
  });

  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  console.log("  Registered! TxHash:", receipt.receipt.transactionHash);
}

// ─── Step 3: Create and Sign Delegation ──────────────────────────────────────

export async function createSignedDelegation(
  curatorSmartAccount: Awaited<ReturnType<typeof toMetaMaskSmartAccount>>,
  moltbotAddress: Address
) {
  console.log("\n--- Creating delegation ---");

  const terms = encodeCaveatTerms(HOOK_ADDRESS, MIN_FEE, MAX_FEE, MIN_BLOCK_INTERVAL);

  const delegation = {
    delegate: moltbotAddress,
    delegator: curatorSmartAccount.address,
    authority: ROOT_AUTHORITY as Hex,
    caveats: [
      {
        enforcer: ENFORCER_ADDRESS,
        terms,
        args: "0x" as Hex,
      },
    ],
    salt: toHex(0n),
    signature: "0x" as Hex,
  };

  // curatorSmartAccount.signDelegation() uses the SA's internal signer.
  // Returns Hex in v0.4.0-beta.1.
  const signature = await curatorSmartAccount.signDelegation({ delegation });
  const signedDelegation = { ...delegation, signature: signature as Hex };

  console.log("  Delegator (Curator SA):", signedDelegation.delegator);
  console.log("  Delegate  (Moltbot  ):", signedDelegation.delegate);
  console.log(`  Bounds: fee [${MIN_FEE}, ${MAX_FEE}], interval ${MIN_BLOCK_INTERVAL} blocks`);

  return signedDelegation;
}

// ─── Step 4: Redeem Delegation to Rebalance ──────────────────────────────────

export async function redeemRebalance(
  moltbotWalletClient: ReturnType<typeof createWalletClient>,
  signedDelegation: Awaited<ReturnType<typeof createSignedDelegation>>,
  newTickLower: number,
  newTickUpper: number,
  newFee: number,
  maxIdleToken0 = 0n,
  maxIdleToken1 = 0n
) {
  console.log("\n--- Redeeming delegation to rebalance ---");
  console.log(`  Tick range: [${newTickLower}, ${newTickUpper}]`);
  console.log(`  Fee: ${newFee} (${(newFee / 10000).toFixed(2)}%)`);

  const rebalanceCalldata = encodeRebalanceCalldata(
    newTickLower, newTickUpper, newFee, maxIdleToken0, maxIdleToken1
  );

  // redeemDelegations() builds the redeemDelegations calldata, simulates, and sends a tx.
  // permissionContext: array of signed delegations in the chain (just one for root delegation).
  // executions: array of calls to make on behalf of the delegator.
  const txHash = await redeemDelegations(
    moltbotWalletClient as any,
    publicClient as any,
    environment.DelegationManager as Address,
    [
      {
        permissionContext: [signedDelegation],
        executions: [
          {
            target: HOOK_ADDRESS,
            value: 0n,
            callData: rebalanceCalldata,
          },
        ],
        mode: ExecutionMode.SingleDefault,
      },
    ]
  );

  console.log("  Tx submitted:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("  Rebalance executed ✓");
  return txHash;
}

// ─── Step 5: Redeem Delegation to Claim Performance Fee ──────────────────────

export async function redeemClaimFee(
  moltbotWalletClient: ReturnType<typeof createWalletClient>,
  signedDelegation: Awaited<ReturnType<typeof createSignedDelegation>>
) {
  console.log("\n--- Redeeming delegation to claim performance fee ---");

  const claimCalldata = encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "claimPerformanceFee",
        inputs: [],
        outputs: [],
      },
    ],
    functionName: "claimPerformanceFee",
    args: [],
  });

  const txHash = await redeemDelegations(
    moltbotWalletClient as any,
    publicClient as any,
    environment.DelegationManager as Address,
    [
      {
        permissionContext: [signedDelegation],
        executions: [
          {
            target: HOOK_ADDRESS,
            value: 0n,
            callData: claimCalldata,
          },
        ],
        mode: ExecutionMode.SingleDefault,
      },
    ]
  );

  console.log("  Tx submitted:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("  Fee claimed ✓");
  return txHash;
}

// ─── Main: Full lifecycle demo ────────────────────────────────────────────────

export async function runDelegationDemo() {
  console.log("=== Phase 3: MetaMask Delegation Demo ===\n");

  const { curatorSmartAccount, moltbotWalletClient, moltbotSigner } =
    await createAccounts();

  await registerCuratorIfNeeded(curatorSmartAccount);

  const signedDelegation = await createSignedDelegation(
    curatorSmartAccount,
    moltbotSigner.address
  );

  // Rebalance: tick range [-1200, 1200], 0.30% fee — within enforcer's [100, 50000] bounds.
  await redeemRebalance(
    moltbotWalletClient,
    signedDelegation,
    -1200,
    1200,
    3000,
    0n,
    0n
  );

  console.log("\n=== Delegation lifecycle complete ===");
}

runDelegationDemo().catch(console.error);
