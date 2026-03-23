/**
 * do-swap.ts — Test utility (NOT an agent tool)
 *
 * Executes a swap on the CuratedLP pool to generate fee revenue.
 * Uses the MockERC20 mint function (testnet only) so no tokens are needed.
 *
 * Usage:
 *   npx tsx src/tools/do-swap.ts [--zeroForOne] [--amount <wei>]
 *
 * Defaults: zeroForOne=true, amount=2000e18
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── Addresses ──────────────────────────────────────────────────────────────

const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;
const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;

// Base Sepolia Uniswap v4 infrastructure
const POOL_SWAP_TEST = "0x8b5bcc363dde2614281ad875bad385e0a785d3b9" as Address;

// Tokens (from poolKey storage on hook)
const TOKEN0 = "0xb6eeA72564e01F8a6AD1d2D7eDf690065F2A72dF" as Address;
const TOKEN1 = "0xD79D66484c1C51B9D5cd455e3C7Ee3d0950e448D" as Address;

// Tick math constants
const MIN_SQRT_PRICE_LIMIT = 4295128740n;         // MIN_SQRT_PRICE + 1
const MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970341n; // MAX_SQRT_PRICE - 1

// ─── ABIs ───────────────────────────────────────────────────────────────────

const ERC20_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
]);

// PoolSwapTest.swap(PoolKey, SwapParams, TestSettings, bytes) → BalanceDelta
// PoolKey: (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)
// SwapParams: (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
// TestSettings: (bool takeClaims, bool settleUsingBurn)
const SWAP_TEST_ABI = parseAbi([
  "function swap((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, (bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, (bool takeClaims, bool settleUsingBurn) testSettings, bytes hookData) external payable returns (int256)",
]);

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const zeroForOne = !args.includes("--oneForZero");
  const amountIdx = args.indexOf("--amount");
  const amount = amountIdx >= 0 ? BigInt(args[amountIdx + 1]) : 200n * 10n ** 18n;

  if (!RPC_URL || !HOOK_ADDRESS || !CURATOR_KEY) {
    console.error("Missing env vars: BASE_SEPOLIA_RPC, HOOK_ADDRESS, CURATOR_PRIVATE_KEY");
    process.exit(1);
  }

  const chain = baseSepolia;
  const account = privateKeyToAccount(CURATOR_KEY);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain, transport: http(RPC_URL) });

  console.log(`Swapper: ${account.address}`);
  console.log(`Direction: ${zeroForOne ? "token0 → token1" : "token1 → token0"}`);
  console.log(`Amount: ${amount.toString()} wei`);

  // Mint tokens to swapper (MockERC20 allows anyone to mint on testnet)
  const tokenToMint = zeroForOne ? TOKEN0 : TOKEN1;
  console.log(`\nMinting tokens from ${tokenToMint}...`);
  const mintHash = await walletClient.writeContract({
    address: tokenToMint,
    abi: ERC20_ABI,
    functionName: "mint",
    args: [account.address, amount * 10n], // mint 10x for buffer
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log(`Minted: ${mintHash}`);

  // Approve PoolSwapTest
  console.log(`\nApproving PoolSwapTest...`);
  const approveHash = await walletClient.writeContract({
    address: tokenToMint,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [POOL_SWAP_TEST, amount * 10n],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log(`Approved: ${approveHash}`);

  // Execute swap
  console.log(`\nExecuting swap...`);
  const swapHash = await walletClient.writeContract({
    address: POOL_SWAP_TEST,
    abi: SWAP_TEST_ABI,
    functionName: "swap",
    args: [
      {
        currency0: TOKEN0,
        currency1: TOKEN1,
        fee: 0x800000,
        tickSpacing: 60,
        hooks: HOOK_ADDRESS,
      },
      {
        zeroForOne,
        amountSpecified: -amount, // negative = exact input
        sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT,
      },
      {
        takeClaims: false,
        settleUsingBurn: false,
      },
      "0x" as Hex,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });
  console.log(`\nSwap tx: ${swapHash}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
