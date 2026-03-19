/**
 * setup.ts — One-time curator setup
 *
 * Derives the Curator Smart Account from CURATOR_PRIVATE_KEY, then:
 *   1. (Optional) Funds the SA from the EOA if balance is low
 *   2. SA calls IdentityRegistry.register() → receives identity NFT
 *   3. Reads the minted tokenId from the Transfer event
 *   4. SA calls CuratedVaultHook.registerCurator(performanceFeeBps, tokenId)
 *   5. Prints ERC8004_IDENTITY_ID to copy into .env
 *
 * Why the Smart Account (not EOA)?
 *   When Moltbot redeems a delegation, DelegationManager executes on behalf of
 *   the delegator (Curator SA) → msg.sender in the hook = Curator SA address.
 *   curatorByWallet[CuratorSA] must equal activeCuratorId for rebalance() to succeed.
 *
 * Pre-requisites:
 *   - CURATOR_PRIVATE_KEY set in agent/.env
 *   - HOOK_ADDRESS set in agent/.env
 *   - PIMLICO_API_KEY set in agent/.env
 *   - Curator EOA has Base Sepolia ETH (to fund the SA, ~0.005 ETH is enough)
 *     Faucet: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet
 *
 * Run: npx tsx src/setup.ts
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  decodeEventLog,
  parseEther,
  formatEther,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createBundlerClient } from "viem/account-abstraction";
import {
  Implementation,
  toMetaMaskSmartAccount,
} from "@metamask/smart-accounts-kit";

// ─── Configuration ─────────────────────────────────────────────────────────────

const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;
const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const PIMLICO_KEY = process.env.PIMLICO_API_KEY!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;

const PERFORMANCE_FEE_BPS = Number(process.env.PERFORMANCE_FEE_BPS ?? "1000");

// Regular Base Sepolia node for EOA funding tx.
// Falls back to BASE_SEPOLIA_RPC (works if it's Alchemy/Infura/any full node).
// Pimlico bundler URLs don't support eth_sendRawTransaction, so use a real node.
const NODE_RPC = process.env.NODE_RPC ?? RPC_URL;

// ERC-8004 IdentityRegistry on Base Sepolia
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;

const chain = baseSepolia;

// ─── Clients ──────────────────────────────────────────────────────────────────

// publicClient can use Pimlico URL (eth_call, eth_getBalance all work fine).
const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
});

// walletClient MUST use a regular node — Pimlico bundler rejects eth_sendRawTransaction.
const nodePublicClient = createPublicClient({
  chain,
  transport: http(NODE_RPC),
});

const bundlerClient = createBundlerClient({
  client: publicClient as any,
  transport: http(
    `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${PIMLICO_KEY}`
  ),
});

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "register",
    inputs: [],
    outputs: [{ name: "tokenId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

const HOOK_ABI = [
  {
    type: "function",
    name: "registerCurator",
    inputs: [
      { name: "performanceFeeBps", type: "uint256" },
      { name: "erc8004IdentityId", type: "uint256" },
    ],
    outputs: [{ name: "curatorId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "curatorByWallet",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!CURATOR_KEY || CURATOR_KEY === "0x...") {
    throw new Error("CURATOR_PRIVATE_KEY not set in agent/.env");
  }
  if (!HOOK_ADDRESS || HOOK_ADDRESS === "0x...") {
    throw new Error("HOOK_ADDRESS not set in agent/.env");
  }
  if (!PIMLICO_KEY) {
    throw new Error("PIMLICO_API_KEY not set in agent/.env");
  }

  const curatorSigner = privateKeyToAccount(CURATOR_KEY);

  console.log("=== Curator Setup ===\n");
  console.log("Curator EOA:", curatorSigner.address);

  // ── Step 1: Derive Curator Smart Account ────────────────────────────────────

  const curatorSmartAccount = await toMetaMaskSmartAccount({
    client: publicClient as any,
    implementation: Implementation.Hybrid,
    deployParams: [curatorSigner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: curatorSigner },
  });

  const saAddress = curatorSmartAccount.address;
  console.log("Curator Smart Account:", saAddress);
  console.log("  (This is the address that will be registered as curator on the hook)\n");

  // ── Step 2: Check if SA is already registered ────────────────────────────────

  const existingCuratorId = await publicClient.readContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: "curatorByWallet",
    args: [saAddress],
  });

  if (existingCuratorId > 0n) {
    console.log(`✓ Curator SA is already registered on the hook (curatorId=${existingCuratorId})`);
    console.log("  No action needed.\n");
    return;
  }

  // ── Step 3: Check SA ETH balance, fund if needed ─────────────────────────────

  const saBalance = await nodePublicClient.getBalance({ address: saAddress });
  console.log(`Curator SA balance: ${formatEther(saBalance)} ETH`);

  // Need at least 0.003 ETH for two UserOps (register + registerCurator).
  const MIN_BALANCE = parseEther("0.003");

  if (saBalance < MIN_BALANCE) {
    const eoaBalance = await nodePublicClient.getBalance({ address: curatorSigner.address });
    console.log(`Curator EOA balance: ${formatEther(eoaBalance)} ETH`);

    if (eoaBalance < MIN_BALANCE + parseEther("0.001")) {
      throw new Error(
        `Curator EOA needs at least ${formatEther(MIN_BALANCE + parseEther("0.001"))} ETH.\n` +
        `Get Base Sepolia ETH from: https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet\n` +
        `EOA address: ${curatorSigner.address}`
      );
    }

    const fundAmount = MIN_BALANCE - saBalance + parseEther("0.001"); // small buffer
    console.log(`\nFunding SA with ${formatEther(fundAmount)} ETH from EOA...`);

    // Use regular RPC (not Pimlico bundler) for this normal ETH transfer.
    const eoaWalletClient = createWalletClient({
      account: curatorSigner,
      chain,
      transport: http(NODE_RPC),
    });

    const fundHash = await eoaWalletClient.sendTransaction({
      to: saAddress,
      value: fundAmount,
    });

    console.log("  Funding tx:", fundHash);
    await nodePublicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log("  SA funded ✓\n");
  } else {
    console.log("  SA already has sufficient ETH ✓\n");
  }

  // ── Step 4: Get or mint ERC-8004 identity NFT ────────────────────────────────

  // If the SA already owns an identity NFT (e.g. from a previous partial run),
  // skip the register() UserOp to avoid the AA25 nonce issue that occurs when
  // the SA was just deployed in the same session.
  let mintedTokenId: bigint | undefined;

  // Check ERC8004_IDENTITY_ID env var first (set after a previous run).
  const envTokenId = process.env.ERC8004_IDENTITY_ID;
  if (envTokenId && envTokenId !== "0") {
    mintedTokenId = BigInt(envTokenId);
    console.log(`--- Step 1/2: Using existing identity NFT from .env ---`);
    console.log(`  tokenId = ${mintedTokenId} (skipping register())\n`);
  } else {
    // Check if the SA already owns an NFT on-chain (covers partial runs).
    const nftBalance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "balanceOf",
      args: [saAddress],
    });

    if (nftBalance > 0n) {
      // Fetch the tokenId via ERC721Enumerable (tokenOfOwnerByIndex).
      try {
        mintedTokenId = await publicClient.readContract({
          address: IDENTITY_REGISTRY,
          abi: IDENTITY_REGISTRY_ABI,
          functionName: "tokenOfOwnerByIndex",
          args: [saAddress, 0n],
        });
        console.log(`--- Step 1/2: SA already owns identity NFT ---`);
        console.log(`  tokenId = ${mintedTokenId} (skipping register())\n`);
      } catch {
        // tokenOfOwnerByIndex not available — fall through to register()
      }
    }
  }

  if (mintedTokenId === undefined) {
    console.log("--- Step 1/2: Minting ERC-8004 identity NFT via SA ---");

    const registerCalldata = encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [],
    });

    const registerUserOpHash = await bundlerClient.sendUserOperation({
      account: curatorSmartAccount,
      calls: [{ to: IDENTITY_REGISTRY, data: registerCalldata }],
    });

    console.log("  UserOp:", registerUserOpHash);
    const registerReceipt = await bundlerClient.waitForUserOperationReceipt({
      hash: registerUserOpHash,
    });

    console.log("  TxHash:", registerReceipt.receipt.transactionHash);

    // Parse Transfer event to get the minted tokenId.
    for (const log of registerReceipt.receipt.logs) {
      try {
        if (log.address.toLowerCase() !== IDENTITY_REGISTRY.toLowerCase()) continue;
        const decoded = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          eventName: "Transfer",
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        if (decoded.args.from === "0x0000000000000000000000000000000000000000") {
          mintedTokenId = decoded.args.tokenId;
          break;
        }
      } catch { /* skip non-Transfer logs */ }
    }

    if (mintedTokenId === undefined) {
      throw new Error(
        "Could not find Transfer event in receipt. Check tx: " +
        registerReceipt.receipt.transactionHash
      );
    }

    console.log(`  Identity NFT minted! tokenId = ${mintedTokenId} ✓\n`);
  }

  // ── Step 5: SA calls CuratedVaultHook.registerCurator() ──────────────────────

  console.log("--- Step 2/2: Registering curator on hook ---");
  console.log(`  performanceFeeBps: ${PERFORMANCE_FEE_BPS}`);
  console.log(`  erc8004IdentityId: ${mintedTokenId}`);

  const registerCuratorCalldata = encodeFunctionData({
    abi: HOOK_ABI,
    functionName: "registerCurator",
    args: [BigInt(PERFORMANCE_FEE_BPS), mintedTokenId],
  });

  const registerCuratorUserOpHash = await bundlerClient.sendUserOperation({
    account: curatorSmartAccount,
    calls: [{ to: HOOK_ADDRESS, data: registerCuratorCalldata }],
  });

  console.log("  UserOp:", registerCuratorUserOpHash);
  const registerCuratorReceipt = await bundlerClient.waitForUserOperationReceipt({
    hash: registerCuratorUserOpHash,
  });

  console.log("  TxHash:", registerCuratorReceipt.receipt.transactionHash);
  console.log("  Curator registered on hook ✓\n");

  // ── Summary ──────────────────────────────────────────────────────────────────

  console.log("=== Setup Complete ===\n");
  console.log("Add this to agent/.env:");
  console.log(`  ERC8004_IDENTITY_ID=${mintedTokenId}`);
  console.log("\nCurator Smart Account:", saAddress);
  console.log(`  curatorByWallet[${saAddress}] = activeCuratorId ✓`);
  console.log("\nYou can now run: npx tsx src/delegation.ts");
}

main().catch((err) => {
  console.error("\n✗ Setup failed:", err.message ?? err);
  process.exit(1);
});
