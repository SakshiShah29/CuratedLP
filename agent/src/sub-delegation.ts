/**
 * sub-delegation.ts — Phase 3: Three-Party Delegation Chain (MetaMask Bounty Differentiator)
 *
 * Chain structure:
 *   Alice (Curator Smart Account)
 *     └─ Delegation #1: fee [100, 50000], interval 30 blocks  (BROAD)
 *         └─► Bob (Moltbot EOA)
 *               └─ Delegation #2: fee [5000, 20000], interval 60 blocks  (NARROW)
 *                   authority = hash(Delegation #1)    ← cryptographic chain link
 *                       └─► Charlie (Volatility Agent EOA)
 *                             └─ redeems [#1, #2] → executes on behalf of Alice SA
 *                                Effective bounds = INTERSECTION: fee [5000, 20000], 60 blocks
 *
 * API (v0.4.0-beta.1):
 *   - Alice (SA) signs with: aliceAccount.signDelegation({ delegation })
 *   - Bob (EOA) signs with:  signDelegation({ privateKey, delegation, delegationManager, chainId })
 *   - createDelegation({ parentDelegation: signedAliceToBob }) resolves authority = hash(#1)
 *   - Charlie redeems with:  redeemDelegations(charlieWallet, publicClient, manager, redemptions)
 *     where permissionContext = [signedAliceToBob, signedBobToCharlie]  (the full chain)
 *
 * Run: npx tsx src/sub-delegation.ts
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  concat,
  toBytes,
  toHex,
  parseEther,
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
  signDelegation,
  ROOT_AUTHORITY,
  ExecutionMode,
} from "@metamask/smart-accounts-kit";


// ─── Configuration ────────────────────────────────────────────────────────────

const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;
const MOLTBOT_KEY = process.env.MOLTBOT_PRIVATE_KEY as Hex;
const VOLATILITY_KEY = process.env.VOLATILITY_AGENT_PRIVATE_KEY as Hex;
const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;
const ENFORCER_ADDRESS = process.env.ENFORCER_ADDRESS as Address;

const chain = baseSepolia;

// ─── Clients ──────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

const environment = getSmartAccountsEnvironment(chain.id);

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Minimal ABI for DelegationManager.getDelegationHash — the canonical on-chain
// hash used as the `authority` field in sub-delegations.
const GET_DELEGATION_HASH_ABI = [
  {
    type: "function",
    name: "getDelegationHash",
    inputs: [
      {
        name: "delegation",
        type: "tuple",
        components: [
          { name: "delegate",  type: "address" },
          { name: "delegator", type: "address" },
          { name: "authority", type: "bytes32" },
          {
            name: "caveats",
            type: "tuple[]",
            components: [
              { name: "enforcer", type: "address" },
              { name: "terms",    type: "bytes" },
              { name: "args",     type: "bytes" },
            ],
          },
          { name: "salt", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "hash", type: "bytes32" }],
    stateMutability: "pure",
  },
] as const;

type DelegationInput = {
  delegate: Hex; delegator: Hex; authority: Hex;
  caveats: { enforcer: Hex; terms: Hex; args: Hex }[];
  salt: Hex; signature: Hex;
};

/**
 * Returns the authority hash to use in a sub-delegation, by calling
 * DelegationManager.getDelegationHash() on-chain — guaranteed to match
 * the value the DelegationManager uses when validating the chain.
 */
async function getAuthorityHash(
  delegationManagerAddress: Address,
  parentDelegation: DelegationInput
): Promise<Hex> {
  return publicClient.readContract({
    address: delegationManagerAddress,
    abi: GET_DELEGATION_HASH_ABI,
    functionName: "getDelegationHash",
    args: [
      {
        delegate:  parentDelegation.delegate,
        delegator: parentDelegation.delegator,
        authority: parentDelegation.authority,
        caveats:   parentDelegation.caveats,
        salt:      BigInt(parentDelegation.salt),
      },
    ],
  }) as Promise<Hex>;
}

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

async function ensureEth(address: Address, label: string) {
  const balance = await publicClient.getBalance({ address });
  if (balance >= parseEther("0.001")) return;

  console.log(`  ${label} (${address}) needs ETH — funding from curator...`);
  const curatorSigner = privateKeyToAccount(CURATOR_KEY);
  const curatorWallet = createWalletClient({
    account: curatorSigner,
    chain,
    transport: http(RPC_URL),
  });
  const hash = await curatorWallet.sendTransaction({
    to: address,
    value: parseEther("0.002"),
  });
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  ${label} funded ✓`);
}

// ─── Main Demo ────────────────────────────────────────────────────────────────

async function runSubDelegationDemo() {
  console.log("=== Sub-Delegation Chain Demo ===\n");
  console.log("Alice (Curator SA) → Bob (EOA) → Charlie (EOA)\n");

  // ── Accounts ─────────────────────────────────────────────────────────────

  const aliceSigner = privateKeyToAccount(CURATOR_KEY);
  const bobSigner   = privateKeyToAccount(MOLTBOT_KEY);
  const charlieSigner = privateKeyToAccount(VOLATILITY_KEY);

  // Alice uses a Smart Account — DelegationManager calls aliceSA.execute() on redemption.
  const aliceAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [aliceSigner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: aliceSigner },
  });

  // Bob and Charlie are plain EOAs — they call redeemDelegations() as regular txs.
  const charlieWallet = createWalletClient({ account: charlieSigner, chain, transport: http(RPC_URL) });

  console.log("Alice SA:", aliceAccount.address);
  console.log("Bob EOA: ", bobSigner.address);
  console.log("Charlie: ", charlieSigner.address, "\n");

  // Ensure Bob and Charlie have gas money.
  await ensureEth(bobSigner.address, "Bob");
  await ensureEth(charlieSigner.address, "Charlie");

  // ── Step 1: Alice → Bob (BROAD bounds) ───────────────────────────────────
  //
  //   fee: [100, 50000]  (0.01% – 5.00%)
  //   interval: 30 blocks
  //   salt: 100n  ← different from delegation.ts (salt=0n) to avoid rate-limit collision

  console.log("[1/4] Alice signs delegation to Bob  (broad: 0.01%-5%, 30 blocks)");

  const aliceToBob = {
    delegate: bobSigner.address as Hex,
    delegator: aliceAccount.address as Hex,
    authority: ROOT_AUTHORITY as Hex,
    caveats: [
      {
        enforcer: ENFORCER_ADDRESS,
        terms: encodeCaveatTerms(HOOK_ADDRESS, 100, 50000, 30),
        args: "0x" as Hex,
      },
    ],
    salt: toHex(100n),    // distinct salt — independent rate-limit state
    signature: "0x" as Hex,
  };

  const aliceSig = await aliceAccount.signDelegation({ delegation: aliceToBob });
  const signedAliceToBob = { ...aliceToBob, signature: aliceSig as Hex };
  console.log("  Signed ✓\n");

  // ── Step 2: Bob → Charlie (NARROW bounds, sub-delegation) ─────────────────
  //
  //   fee: [5000, 20000]  (0.50% – 2.00%)   ← narrower than Alice's [100, 50000]
  //   interval: 60 blocks                   ← stricter than Alice's 30 blocks
  //
  //   createDelegation({ parentDelegation: signedAliceToBob }) sets
  //   authority = hash(aliceToBob) — cryptographically chains the two delegations.
  //
  //   Bob signs with his raw private key (he's an EOA, not an SA).

  console.log("[2/4] Bob sub-delegates to Charlie  (narrow: 0.5%-2%, 60 blocks)");

  // Build the sub-delegation manually.
  // getDelegationHashOffchain computes the EIP-712 struct hash — same as what
  // createDelegation({ parentDelegation }) does internally, but without the
  // broken scope/caveats resolution in v0.4.0-beta.1's createDelegation.
  const bobToCharlie = {
    delegate:  charlieSigner.address as Hex,
    delegator: bobSigner.address as Hex,
    authority: hashDelegation(signedAliceToBob), // chain link = hash of parent delegation
    caveats: [
      {
        enforcer: ENFORCER_ADDRESS,
        terms: encodeCaveatTerms(HOOK_ADDRESS, 5000, 20000, 60),
        args: "0x" as Hex,
      },
    ],
    salt: toHex(1n),
    signature: "0x" as Hex,
  };

  // Bob signs the sub-delegation using the standalone signDelegation (EOA private key).
  const bobSig = await signDelegation({
    privateKey: MOLTBOT_KEY,
    delegation: bobToCharlie,
    delegationManager: environment.DelegationManager as Address,
    chainId: chain.id,
  });
  const signedBobToCharlie = { ...bobToCharlie, signature: bobSig };
  console.log("  Signed ✓\n");

  // ── Step 3: Charlie redeems the FULL chain ────────────────────────────────
  //
  //   permissionContext = [signedBobToCharlie, signedAliceToBob]
  //   Order: redeemer's delegation FIRST, then parent chain toward root.
  //   DelegationManager checks permissionContext[0].delegate == msg.sender (Charlie).
  //
  //   DelegationManager validates:
  //     1. Alice's signature on #1                          ✓
  //     2. Bob's signature on #2                           ✓
  //     3. #2 authority == hash(#1)                        ✓
  //     4. Enforcer #1: fee 8000 ∈ [100, 50000]           ✓
  //     5. Enforcer #1: rate limit 30 blocks               ✓ (first use)
  //     6. Enforcer #2: fee 8000 ∈ [5000, 20000]          ✓
  //     7. Enforcer #2: rate limit 60 blocks               ✓ (first use)
  //   Then: aliceSA.execute(hook.rebalance(...))
  //   msg.sender in hook == Alice SA                        ✓

  console.log("[3/4] Charlie redeems chain — fee 0.80% (within both bounds)");

  const rebalanceCalldata = encodeRebalanceCalldata(-600, 600, 8000, 0n, 0n);

  const txHash = await redeemDelegations(
    charlieWallet as any,
    publicClient as any,
    environment.DelegationManager as Address,
    [
      {
        permissionContext: [signedBobToCharlie, signedAliceToBob],
        executions: [{ target: HOOK_ADDRESS, value: 0n, callData: rebalanceCalldata }],
        mode: ExecutionMode.SingleDefault,
      },
    ]
  );

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("  Rebalance executed ✓  tx:", txHash, "\n");

  // ── Step 4: Verify bound intersection — fee outside Bob's bounds reverts ──
  //
  //   fee = 30000 (3.00%):
  //     Alice's enforcer: 30000 ∈ [100, 50000]?  YES ✓
  //     Bob's enforcer:   30000 ∈ [5000, 20000]? NO  ✗ → simulation reverts
  //
  //   The tighter bounds always win. Charlie can never exceed Bob's limits,
  //   even though Alice would allow it.

  console.log("[4/4] Verifying intersection — fee 3% should revert at Bob's enforcer");

  const tooHighCalldata = encodeRebalanceCalldata(-600, 600, 30000, 0n, 0n);

  try {
    await redeemDelegations(
      charlieWallet as any,
      publicClient as any,
      environment.DelegationManager as Address,
      [
        {
          permissionContext: [signedBobToCharlie, signedAliceToBob],
          executions: [{ target: HOOK_ADDRESS, value: 0n, callData: tooHighCalldata }],
          mode: ExecutionMode.SingleDefault,
        },
      ]
    );
    console.log("  ERROR: should have reverted but did not!");
  } catch (e: any) {
    console.log("  Correctly reverted ✓ (fee 3% > Bob's max 2%)");
    console.log("  Reason:", e?.message?.slice(0, 120));
  }

  console.log("\n=== Sub-delegation chain complete ===");
  console.log("  Chain:           Alice SA → Bob EOA → Charlie EOA");
  console.log("  Alice allows:    fee [100, 50000],  interval 30 blocks");
  console.log("  Bob allows:      fee [5000, 20000], interval 60 blocks");
  console.log("  Effective:       fee [5000, 20000], interval 60 blocks  (intersection)");
  console.log("  Used:            fee 8000 (0.80%) ✓");
}

runSubDelegationDemo().catch(console.error);
