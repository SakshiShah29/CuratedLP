/**
 * do-deposit.ts — Test utility (NOT an agent tool)
 *
 * Deposits tokens into the CuratedVaultHook.
 * Uses MockERC20 mint (testnet only) so no real tokens needed.
 *
 * Usage:
 *   npx tsx src/tools/do-deposit.ts --amount0 <wei> --amount1 <wei>
 */

import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type Address,
  maxUint256,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const RPC_URL = process.env.BASE_SEPOLIA_RPC!;
const HOOK_ADDRESS = process.env.HOOK_ADDRESS as Address;
const CURATOR_KEY = process.env.CURATOR_PRIVATE_KEY as Hex;

const TOKEN0 = "0xb06794b116533EA0948009eCFa268c8E690902F1" as Address;
const TOKEN1 = "0xF4Ac05194da1e2A0af24Fb22d9471935371aC355" as Address;

const ERC20_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
]);

const HOOK_ABI = parseAbi([
  "function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 minShares, uint256 deadline) external returns (uint256 shares)",
]);

async function main() {
  const args = process.argv.slice(2);
  const idx0 = args.indexOf("--amount0");
  const idx1 = args.indexOf("--amount1");
  const amount0 = idx0 >= 0 ? BigInt(args[idx0 + 1]) : 0n;
  const amount1 = idx1 >= 0 ? BigInt(args[idx1 + 1]) : 0n;

  if (amount0 === 0n && amount1 === 0n) {
    console.error("Usage: npx tsx src/tools/do-deposit.ts --amount0 <wei> --amount1 <wei>");
    process.exit(1);
  }

  const account = privateKeyToAccount(CURATOR_KEY);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });

  console.log(`Depositor: ${account.address}`);
  console.log(`Amount0 (mUSDC): ${amount0}`);
  console.log(`Amount1 (mwstETH): ${amount1}`);

  // Mint and approve token0 if needed
  if (amount0 > 0n) {
    const mintHash = await walletClient.writeContract({ address: TOKEN0, abi: ERC20_ABI, functionName: "mint", args: [account.address, amount0] });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    const approveHash = await walletClient.writeContract({ address: TOKEN0, abi: ERC20_ABI, functionName: "approve", args: [HOOK_ADDRESS, amount0] });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Token0 minted & approved");
  }

  // Mint and approve token1 if needed
  if (amount1 > 0n) {
    const mintHash = await walletClient.writeContract({ address: TOKEN1, abi: ERC20_ABI, functionName: "mint", args: [account.address, amount1] });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    const approveHash = await walletClient.writeContract({ address: TOKEN1, abi: ERC20_ABI, functionName: "approve", args: [HOOK_ADDRESS, amount1] });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log("Token1 minted & approved");
  }

  // Deposit
  console.log("Depositing...");
  const depositHash = await walletClient.writeContract({
    address: HOOK_ADDRESS,
    abi: HOOK_ABI,
    functionName: "deposit",
    args: [amount0, amount1, 0n, 0n, 0n, maxUint256],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log(`Deposit tx: ${depositHash}`);
  console.log(`Block: ${receipt.blockNumber}`);
  console.log(`Status: ${receipt.status}`);
  console.log(`Gas used: ${receipt.gasUsed}`);
}

main().catch((err) => {
  console.error("Error:", err.message ?? err);
  process.exit(1);
});
