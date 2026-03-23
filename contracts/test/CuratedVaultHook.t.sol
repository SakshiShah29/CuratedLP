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
            Hooks.AFTER_SWAP_FLAG |
            Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
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

        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);

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

        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);
        uint256 aliceShares = shares.balanceOf(alice);
        assertGt(aliceShares, 0);

        // Withdraw all shares
        hook.withdraw(aliceShares, 0, 0, type(uint256).max);

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
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);
        uint256 aliceShares = shares.balanceOf(alice);

        // Bob deposits same amount
        vm.prank(bob);
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);
        uint256 bobShares = shares.balanceOf(bob);

        // Bob should get approximately the same shares as Alice
        // (minus the dead shares from first deposit)
        assertApproxEqRel(bobShares, aliceShares, 0.01e18);
    }

    // ─── Test: Swap still works with hook ────────────────────────────

    function test_swapWorksAfterDeposit() public {
        // First, deposit liquidity so swaps have something to route through
        vm.prank(alice);
        hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

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
        hook.deposit(0, 0, 0, 0, 0, type(uint256).max);
    }

    // ─── Test: Withdraw more than balance reverts ────────────────────

    function test_withdrawMoreThanBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InsufficientShares.selector);
        hook.withdraw(1 ether, 0, 0, type(uint256).max);
    }

    function test_registerCurator() public {
    // For testing, we need to mock the ERC-8004 IdentityRegistry
    // since the real one is on Base Sepolia, not in our test environment.
    //
    // We'll use vm.mockCall to make the IDENTITY_REGISTRY.ownerOf()
    // return alice's address for token ID 1.

    address identityRegistry = address(0x8004A818BFB912233c491871b3d84c89A494BD9e);

    vm.mockCall(
        identityRegistry,
        abi.encodeWithSignature("ownerOf(uint256)", 1),
        abi.encode(alice)
    );

    vm.prank(alice);
    uint256 curatorId = hook.registerCurator(1000, 1); // 10% performance fee, identity ID 1

    assertEq(curatorId, 1);
    assertEq(hook.activeCuratorId(), 1);

    CuratedVaultHook.Curator memory curator = hook.getCurator(1);
    assertEq(curator.wallet, alice);
    assertEq(curator.erc8004IdentityId, 1);
    assertEq(curator.recommendedFee, 3000); // DEFAULT_FEE
    assertEq(curator.performanceFeeBps, 1000);
    assertTrue(curator.active);
}

// ─── Test: Double registration reverts ───────────────────────────

function test_doubleRegistrationReverts() public {
    address identityRegistry = address(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    vm.mockCall(
        identityRegistry,
        abi.encodeWithSignature("ownerOf(uint256)", 1),
        abi.encode(alice)
    );

    vm.prank(alice);
    hook.registerCurator(1000, 1);

    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_CuratorAlreadyRegistered.selector);
    hook.registerCurator(500, 1);
}

// ─── Test: Registration with wrong identity owner reverts ────────

function test_wrongIdentityOwnerReverts() public {
    address identityRegistry = address(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    // Mock: token ID 1 is owned by bob, not alice
    vm.mockCall(
        identityRegistry,
        abi.encodeWithSignature("ownerOf(uint256)", 1),
        abi.encode(bob)
    );

    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_IdentityNotOwned.selector);
    hook.registerCurator(1000, 1);
}

// ─── Test: Performance fee too high reverts ──────────────────────

function test_performanceFeeTooHighReverts() public {
    address identityRegistry = address(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    vm.mockCall(
        identityRegistry,
        abi.encodeWithSignature("ownerOf(uint256)", 1),
        abi.encode(alice)
    );

    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InvalidPerformanceFee.selector);
    hook.registerCurator(2001, 1); // 20.01% — over limit
}

// ─── Helper: register alice as curator for subsequent tests ──────

function _registerAliceAsCurator() internal returns (uint256 curatorId) {
    address identityRegistry = address(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    vm.mockCall(
        identityRegistry,
        abi.encodeWithSignature("ownerOf(uint256)", 1),
        abi.encode(alice)
    );
    vm.prank(alice);
    curatorId = hook.registerCurator(1000, 1);
}

// ─── Test: Dynamic fee applied on swap ───────────────────────────

function test_dynamicFeeApplied() public {
    _registerAliceAsCurator();

    // Deposit liquidity
    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // The fee should be DEFAULT_FEE (3000 = 0.30%)
    assertEq(hook.getCurrentFee(), 3000);

    // Perform a swap
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);

    uint256 token1Before = token1.balanceOf(swapper);

    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        }),
        ""
    );

    uint256 token1After = token1.balanceOf(swapper);
    vm.stopPrank();

    // Swapper should have received token1 (less than 0.1 ether due to fee)
    uint256 received = token1After - token1Before;
    assertGt(received, 0);
    // With a 0.30% LP fee + curator performance fee (10% of LP fee ≈ 0.03%),
    // received should be roughly 0.1 * 0.997 * (1 - 0.0003) ≈ 0.09967 ether.
    // Allow 2% tolerance for concentrated liquidity math + performance fee.
    assertApproxEqRel(received, 0.0997 ether, 0.02e18);

    // Fee tracking should be updated
    assertGt(hook.cumulativeVolume(), 0);
    assertGt(hook.cumulativeFeeRevenue(), 0);
    assertEq(hook.totalSwaps(), 1);
}

// ─── Test: Rebalance changes tick range and fee ──────────────────

function test_rebalance() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Check initial state
    assertEq(hook.currentTickLower(), -887220);
    assertEq(hook.currentTickUpper(), 887220);
    assertEq(hook.getCurrentFee(), 3000);

    // Advance blocks past the MIN_REBALANCE_INTERVAL
    vm.roll(block.number + 31);

    // Rebalance to a tighter range with a higher fee
    vm.prank(alice);
    hook.rebalance(-600, 600, 5000, type(uint256).max, type(uint256).max); // [-600, 600] range, 0.50% fee

    assertEq(hook.currentTickLower(), -600);
    assertEq(hook.currentTickUpper(), 600);
    assertEq(hook.getCurrentFee(), 5000);
    assertGt(hook.totalLiquidity(), 0);
}

// ─── Test: Rebalance by non-curator reverts ──────────────────────

function test_rebalanceByNonCuratorReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    vm.roll(block.number + 31);

    // Bob is not the curator
    vm.prank(bob);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_OnlyCurator.selector);
    hook.rebalance(-600, 600, 5000, 0, 0);
}

// ─── Test: Rebalance too frequent reverts ────────────────────────

function test_rebalanceTooFrequentReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    vm.roll(block.number + 31);

    // First rebalance succeeds
    vm.prank(alice);
    hook.rebalance(-600, 600, 5000, type(uint256).max, type(uint256).max);

    // Immediate second rebalance fails
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_RebalanceTooFrequent.selector);
    hook.rebalance(-1200, 1200, 3000, 0, 0);
}

// ─── Test: Fee changes visible between swaps ─────────────────────

function test_feeChangesBetweenSwaps() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Swap 1 at 0.30% fee
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);

    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.01 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        }),
        ""
    );
    vm.stopPrank();

    uint256 volumeAfterSwap1 = hook.cumulativeVolume();
    uint256 feeAfterSwap1 = hook.cumulativeFeeRevenue();

    // Curator rebalances with higher fee
    vm.roll(block.number + 31);
    vm.prank(alice);
    hook.rebalance(-600, 600, 10000, type(uint256).max, type(uint256).max); // 1.00% fee

    // Swap 2 at 1.00% fee
    vm.startPrank(swapper);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.01 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        }),
        ""
    );
    vm.stopPrank();

    uint256 feeAfterSwap2 = hook.cumulativeFeeRevenue();
    uint256 feeFromSwap2 = feeAfterSwap2 - feeAfterSwap1;
    uint256 feeFromSwap1 = feeAfterSwap1;

    // Swap 2's fee revenue should be ~3.3x swap 1's (1.00% vs 0.30%)
    // Allow generous tolerance because concentrated liquidity math
    // and tick position changes affect exact amounts
    assertGt(feeFromSwap2, feeFromSwap1);
    assertEq(hook.totalSwaps(), 2);
}

// ─── Test: Invalid tick range reverts ────────────────────────────

function test_invalidTickRangeReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    vm.roll(block.number + 31);

    // tickLower >= tickUpper
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InvalidTickRange.selector);
    hook.rebalance(600, -600, 3000, 0, 0);

    // Ticks not aligned to tickSpacing (60)
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InvalidTickRange.selector);
    hook.rebalance(-601, 600, 3000, 0, 0);
}

// ─── Test: Invalid fee reverts ───────────────────────────────────

function test_invalidFeeReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    vm.roll(block.number + 31);

    // Fee = 0
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InvalidFee.selector);
    hook.rebalance(-600, 600, 0, 0, 0);

    // Fee > MAX_FEE
    vm.roll(block.number + 31);
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_InvalidFee.selector);
    hook.rebalance(-600, 600, 100001, 0, 0);
}

// ─── Test: Claim performance fee after zeroForOne swap ────────────

function test_claimPerformanceFee_zeroForOne() public {
    _registerAliceAsCurator();

    // Deposit liquidity
    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Perform a zeroForOne swap (output is token1)
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // Fees should have accrued in token1 (the output currency)
    assertEq(hook.accruedPerformanceFee0(), 0);
    assertGt(hook.accruedPerformanceFee1(), 0);

    // The hook should hold the fee tokens
    uint256 hookToken1Balance = token1.balanceOf(address(hook));
    assertGe(hookToken1Balance, hook.accruedPerformanceFee1());

    // Curator claims
    uint256 aliceToken1Before = token1.balanceOf(alice);
    uint256 expectedFee1 = hook.accruedPerformanceFee1();

    vm.prank(alice);
    hook.claimPerformanceFee();

    // Alice received the fee tokens
    assertEq(token1.balanceOf(alice) - aliceToken1Before, expectedFee1);

    // Accumulators reset
    assertEq(hook.accruedPerformanceFee0(), 0);
    assertEq(hook.accruedPerformanceFee1(), 0);
}

// ─── Test: Claim performance fee after reverse swap ───────────────

function test_claimPerformanceFee_oneForZero() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Perform a oneForZero swap (output is token0)
    address swapper = makeAddr("swapper");
    token1.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token1.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: false,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // Fees should have accrued in token0 (the output currency)
    assertGt(hook.accruedPerformanceFee0(), 0);
    assertEq(hook.accruedPerformanceFee1(), 0);

    uint256 aliceToken0Before = token0.balanceOf(alice);
    uint256 expectedFee0 = hook.accruedPerformanceFee0();

    vm.prank(alice);
    hook.claimPerformanceFee();

    assertEq(token0.balanceOf(alice) - aliceToken0Before, expectedFee0);
    assertEq(hook.accruedPerformanceFee0(), 0);
}

// ─── Test: Fees accumulate across multiple swaps in both currencies ─

function test_claimPerformanceFee_bothCurrencies() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    token1.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    token1.approve(address(swapRouter), type(uint256).max);

    // Swap 1: zeroForOne → fees in token1
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );

    // Swap 2: oneForZero → fees in token0
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: false,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // Both accumulators should have fees
    assertGt(hook.accruedPerformanceFee0(), 0);
    assertGt(hook.accruedPerformanceFee1(), 0);

    uint256 aliceToken0Before = token0.balanceOf(alice);
    uint256 aliceToken1Before = token1.balanceOf(alice);
    uint256 expectedFee0 = hook.accruedPerformanceFee0();
    uint256 expectedFee1 = hook.accruedPerformanceFee1();

    vm.prank(alice);
    hook.claimPerformanceFee();

    assertEq(token0.balanceOf(alice) - aliceToken0Before, expectedFee0);
    assertEq(token1.balanceOf(alice) - aliceToken1Before, expectedFee1);
    assertEq(hook.accruedPerformanceFee0(), 0);
    assertEq(hook.accruedPerformanceFee1(), 0);
}

// ─── Test: Multiple swaps accumulate before single claim ──────────

function test_claimPerformanceFee_accumulatesAcrossSwaps() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);

    // Three identical swaps
    for (uint256 i = 0; i < 3; i++) {
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -0.01 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
    }
    vm.stopPrank();

    // Fees should have accumulated from all 3 swaps
    uint256 totalFee1 = hook.accruedPerformanceFee1();
    assertGt(totalFee1, 0);
    assertEq(hook.totalSwaps(), 3);

    // Claim all at once
    uint256 aliceToken1Before = token1.balanceOf(alice);
    vm.prank(alice);
    hook.claimPerformanceFee();

    assertEq(token1.balanceOf(alice) - aliceToken1Before, totalFee1);
}

// ─── Test: Claim with no fees reverts ─────────────────────────────

function test_claimPerformanceFee_noFeesReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_NoFeesToClaim.selector);
    hook.claimPerformanceFee();
}

// ─── Test: Non-curator cannot claim ───────────────────────────────

function test_claimPerformanceFee_nonCuratorReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Generate fees
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    assertGt(hook.accruedPerformanceFee1(), 0);

    // Bob is not the curator
    vm.prank(bob);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_OnlyCurator.selector);
    hook.claimPerformanceFee();
}

// ─── Test: Claim with no curator set reverts ──────────────────────

function test_claimPerformanceFee_noCuratorReverts() public {
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_NoCuratorSet.selector);
    hook.claimPerformanceFee();
}

// ─── Test: Double claim reverts (no new fees) ─────────────────────

function test_claimPerformanceFee_doubleClaimReverts() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Generate fees
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // First claim succeeds
    vm.prank(alice);
    hook.claimPerformanceFee();

    // Second claim reverts — no new fees
    vm.prank(alice);
    vm.expectRevert(CuratedVaultHook.CuratedVaultHook_NoFeesToClaim.selector);
    hook.claimPerformanceFee();
}

// ─── Test: Claim after rebalance + swap works ─────────────────────

function test_claimPerformanceFee_afterRebalance() public {
    _registerAliceAsCurator();

    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Rebalance to tighter range with higher fee
    vm.roll(block.number + 31);
    vm.prank(alice);
    hook.rebalance(-1200, 1200, 10000, type(uint256).max, type(uint256).max); // 1% fee

    // Swap generates fees at the new fee rate
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // Fees at 1% LP fee should be larger than at 0.3%
    uint256 fee1 = hook.accruedPerformanceFee1();
    assertGt(fee1, 0);

    // Claim succeeds
    uint256 aliceToken1Before = token1.balanceOf(alice);
    vm.prank(alice);
    hook.claimPerformanceFee();

    assertEq(token1.balanceOf(alice) - aliceToken1Before, fee1);
}

// ─── Test: No fees accrue without a curator ───────────────────────

function test_noPerformanceFeeWithoutCurator() public {
    // Deposit without registering a curator
    vm.prank(alice);
    hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

    // Swap
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
        ""
    );
    vm.stopPrank();

    // Volume tracked but no performance fee accrued
    assertGt(hook.cumulativeVolume(), 0);
    assertEq(hook.accruedPerformanceFee0(), 0);
    assertEq(hook.accruedPerformanceFee1(), 0);
}

// ─── Test: Deposit + Rebalance + Swap + Withdraw full cycle ──────

function test_fullCycleWithCurator() public {
    _registerAliceAsCurator();

    // Alice deposits
    vm.prank(alice);
    hook.deposit(5 ether, 5 ether, 0, 0, 2.5 ether, type(uint256).max);
    uint256 aliceShares = hook.vaultShares().balanceOf(alice);
    assertGt(aliceShares, 0);

    // Bob deposits
    vm.prank(bob);
    hook.deposit(5 ether, 5 ether, 0, 0, 2.5 ether, type(uint256).max);

    // Curator rebalances
    vm.roll(block.number + 31);
    vm.prank(alice);
    hook.rebalance(-1200, 1200, 5000, type(uint256).max, type(uint256).max);

    // Someone swaps
    address swapper = makeAddr("swapper");
    token0.mint(swapper, 1 ether);
    vm.startPrank(swapper);
    token0.approve(address(swapRouter), type(uint256).max);
    swapRouter.swap(
        key,
        SwapParams({
            zeroForOne: true,
            amountSpecified: -0.1 ether,
            sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
        }),
        PoolSwapTest.TestSettings({
            takeClaims: false,
            settleUsingBurn: false
        }),
        ""
    );
    vm.stopPrank();

    // Verify fee tracking
    assertGt(hook.cumulativeVolume(), 0);
    assertGt(hook.cumulativeFeeRevenue(), 0);
    assertEq(hook.totalSwaps(), 1);

    // Alice withdraws
    vm.prank(alice);
    hook.withdraw(aliceShares, 0, 0, type(uint256).max);
    assertEq(hook.vaultShares().balanceOf(alice), 0);

    // Bob withdraws
    uint256 bobShares = hook.vaultShares().balanceOf(bob);
    vm.prank(bob);
    hook.withdraw(bobShares, 0, 0, type(uint256).max);
    assertEq(hook.vaultShares().balanceOf(bob), 0);
}
}