// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {CuratedVaultHook} from "../src/CuratedVaultHook.sol";
import {VaultShares} from "../src/VaultShares.sol";

contract CuratedVaultHookTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    CuratedVaultHook hook;
    VaultShares shares;
    PoolId id;

    MockERC20 token0;
    MockERC20 token1;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        // ── Deploy v4 core infrastructure ────────────────────────────
        deployFreshManagerAndRouters();

        // ── Deploy test tokens ──────────────────────────────────────
        (Currency currency0, Currency currency1) = deployMintAndApprove2Currencies();
        token0 = MockERC20(Currency.unwrap(currency0));
        token1 = MockERC20(Currency.unwrap(currency1));

        // ── Mine and deploy hook ────────────────────────────────────
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );

        // Use vm.etch for testing — bypasses address mining.
        // In production, use HookMiner + CREATE2.
        address hookAddr = address(flags);
        deployCodeTo(
            "CuratedVaultHook.sol",
            abi.encode(manager),
            hookAddr
        );
        hook = CuratedVaultHook(hookAddr);
        shares = hook.vaultShares();

        // ── Initialize pool ─────────────────────────────────────────
        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0x800000,  // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks: IHooks(hookAddr)
        });
        id = key.toId();

        // Price = 1:1 for simplicity
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        // ── Fund test users ─────────────────────────────────────────
        token0.mint(alice, 100 ether);
        token1.mint(alice, 100 ether);
        token0.mint(bob, 100 ether);
        token1.mint(bob, 100 ether);

        // Approve hook to spend tokens
        vm.startPrank(alice);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Test: Pool initialized correctly ────────────────────────────

    function test_poolInitialized() public view {
        assertTrue(hook.poolInitialized());
        assertEq(PoolId.unwrap(hook.poolId()), PoolId.unwrap(id));
    }

    // ─── Test: Direct LP blocked ─────────────────────────────────────

    function test_directAddLiquidityReverts() public {
        PoolModifyLiquidityTest lpRouter = new PoolModifyLiquidityTest(manager);
        token0.approve(address(lpRouter), type(uint256).max);
        token1.approve(address(lpRouter), type(uint256).max);
        token0.mint(address(this), 1 ether);
        token1.mint(address(this), 1 ether);

        // PoolManager wraps hook reverts in WrappedError, so we can't match
        // the exact selector. Just verify it reverts.
        vm.expectRevert();
        lpRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -60,
                tickUpper: 60,
                liquidityDelta: 1 ether,
                salt: bytes32(0)
            }),
            ""
        );
    }

    // ─── Test: Deposit ───────────────────────────────────────────────

    function test_deposit() public {
        vm.startPrank(alice);
        uint256 sharesBefore = shares.balanceOf(alice);

        hook.deposit(1 ether, 1 ether, 0, 0);

        uint256 sharesAfter = shares.balanceOf(alice);
        assertGt(sharesAfter, sharesBefore);
        assertGt(hook.totalLiquidity(), 0);
        vm.stopPrank();
    }

    // ─── Test: Deposit + Withdraw roundtrip ──────────────────────────

    function test_depositWithdrawRoundtrip() public {
        vm.startPrank(alice);

        // Deposit
        uint256 bal0Before = token0.balanceOf(alice);
        uint256 bal1Before = token1.balanceOf(alice);

        hook.deposit(1 ether, 1 ether, 0, 0);
        uint256 aliceShares = shares.balanceOf(alice);
        assertGt(aliceShares, 0);

        // Withdraw all shares
        hook.withdraw(aliceShares, 0, 0);

        uint256 bal0After = token0.balanceOf(alice);
        uint256 bal1After = token1.balanceOf(alice);

        // Should get back approximately what we put in (minus rounding)
        // Allow 0.1% tolerance for rounding
        assertApproxEqRel(bal0After, bal0Before, 0.001e18);
        assertApproxEqRel(bal1After, bal1Before, 0.001e18);
        assertEq(shares.balanceOf(alice), 0);

        vm.stopPrank();
    }

    // ─── Test: Two depositors get fair shares ────────────────────────

    function test_twoDepositors() public {
        // Alice deposits first
        vm.prank(alice);
        hook.deposit(1 ether, 1 ether, 0, 0);
        uint256 aliceShares = shares.balanceOf(alice);

        // Bob deposits same amount
        vm.prank(bob);
        hook.deposit(1 ether, 1 ether, 0, 0);
        uint256 bobShares = shares.balanceOf(bob);

        // Bob should get approximately the same shares as Alice
        // (minus the dead shares from first deposit)
        assertApproxEqRel(bobShares, aliceShares, 0.01e18);
    }

    // ─── Test: Swap still works with hook ────────────────────────────

    function test_swapWorksAfterDeposit() public {
        // First, deposit liquidity so swaps have something to route through
        vm.prank(alice);
        hook.deposit(10 ether, 10 ether, 0, 0);

        // Fund swapper and approve
        address swapper = makeAddr("swapper");
        token0.mint(swapper, 1 ether);
        vm.startPrank(swapper);
        token0.approve(address(swapRouter), type(uint256).max);

        // Perform a swap: exact input 0.01 token0 for token1
        uint256 token1Before = token1.balanceOf(swapper);

        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -0.01 ether,  // negative = exact input
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({
                takeClaims: false,
                settleUsingBurn: false
            }),
            ""
        );

        assertGt(token1.balanceOf(swapper), token1Before);
        vm.stopPrank();
    }

    // ─── Test: Zero deposit reverts ──────────────────────────────────

    function test_zeroDepositReverts() public {
        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_ZeroDeposit.selector);
        hook.deposit(0, 0, 0, 0);
    }

    // ─── Test: Withdraw more than balance reverts ────────────────────

    function test_withdrawMoreThanBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InsufficientShares.selector);
        hook.withdraw(1 ether, 0, 0);
    }
}