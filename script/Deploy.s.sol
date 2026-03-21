// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {CuratedVaultHook} from "../src/CuratedVaultHook.sol";
import {HookMiner} from "v4-hooks-public/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

contract DeployScript is Script {
    // ─── Base Sepolia PoolManager ─────────────────────────────────────
    // Different from mainnet (0x498581fF...). Confirmed via hookmate/constants/AddressConstants.sol
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    // CREATE2 Deployer Proxy — forge script routes `new Contract{salt: ...}`
    // through this address when broadcasting.
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // ── Step 1: Mine the hook address (off-chain, before broadcast) ──
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );

        bytes memory creationCode = type(CuratedVaultHook).creationCode;
        bytes memory constructorArgs = abi.encode(IPoolManager(POOL_MANAGER));

        (address hookAddress, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            flags,
            creationCode,
            constructorArgs
        );

        console.log("Hook will deploy to:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // ── Step 2: Deploy everything (on-chain) ─────────────────────────
        vm.startBroadcast(deployerPrivateKey);

        // Deploy test tokens (both 18 decimals for simplicity)
        MockERC20 tokenA = new MockERC20("Mock USDC", "mUSDC", 18);
        MockERC20 tokenB = new MockERC20("Mock wstETH", "mwstETH", 18);

        // Sort: token0 must have the lower address
        (MockERC20 token0, MockERC20 token1) = address(tokenA) < address(tokenB)
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        console.log("Token0:", address(token0));
        console.log("Token1:", address(token1));

        // Deploy hook with mined salt
        CuratedVaultHook hook = new CuratedVaultHook{salt: salt}(
            IPoolManager(POOL_MANAGER)
        );

        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("Hook deployed at:", address(hook));
        console.log("VaultShares at:", address(hook.vaultShares()));

        // ── Step 3: Initialize pool at 1:1 price ─────────────────────────
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // tick 0 → sqrtPriceX96 = 2^96 → price = 1:1
        uint160 sqrtPriceX96 = 79228162514264337593543950336; // 2^96
        IPoolManager(POOL_MANAGER).initialize(key, sqrtPriceX96);
        console.log("Pool initialized at 1:1 price");

        // ── Step 4: Mint tokens, approve, and do initial deposit ─────────
        uint256 depositAmount = 100 ether;
        token0.mint(deployer, depositAmount);
        token1.mint(deployer, depositAmount);

        token0.approve(address(hook), depositAmount);
        token1.approve(address(hook), depositAmount);

        uint256 shares = hook.deposit(depositAmount, depositAmount, 0, 0, 0, type(uint256).max);
        console.log("Initial deposit complete, shares:", shares);

        vm.stopBroadcast();

        console.log("");
        console.log("=== NEXT: Deploy enforcer separately ===");
        console.log("Run: forge script script/DeployEnforcer.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --private-key $PRIVATE_KEY");
    }
}
