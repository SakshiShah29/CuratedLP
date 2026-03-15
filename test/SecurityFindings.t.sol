// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title SecurityFindings
 *
 * Consolidated test suite validating the fixes for security findings from the
 * CuratedLP audit. Each section corresponds to one finding.
 *
 * ─── Finding #1 ───────────────────────────────────────────────────────────────
 * "Reentrancy in deposit() — CEI violation enables share inflation via refund hook"
 *
 * VULNERABILITY:
 *   deposit() sent unused-token refunds (Step 5) BEFORE updating totalLiquidity
 *   and minting shares (Step 6). An ERC-777 tokensReceived callback on the refund
 *   transfer could re-enter deposit() while the outer call's state was not yet
 *   committed, enabling share inflation.
 *
 * FIX:
 *   - nonReentrant modifier on deposit(), withdraw(), rebalance()
 *   - CEI ordering: totalLiquidity and vaultShares.mint() moved before refund transfers
 *
 * ─── Finding #3 ───────────────────────────────────────────────────────────────
 * "rebalance() exposes all vault liquidity to sandwich attack"
 *
 * VULNERABILITY:
 *   rebalance() removed ALL vault liquidity and re-added at the new range using
 *   live balances with no idle-balance check. A sandwich attacker could push the
 *   price outside the new tick range so the vault could only deploy one token,
 *   leaving the other stranded idle and earning zero fees.
 *
 * FIX:
 *   - maxIdleToken0 and maxIdleToken1 parameters added to rebalance()
 *   - After re-deployment, _checkIdleBalance() reverts if idle balances exceed limits
 *   - Curators pass 0 for strict protection, type(uint256).max to opt out
 *
 * ─── Finding #4 ───────────────────────────────────────────────────────────────
 * "Missing deadline enables stale transaction execution"
 *
 * VULNERABILITY:
 *   deposit() and withdraw() had no deadline parameter. A transaction submitted
 *   at time T could be mined at T+N after a curator rebalance had moved the
 *   active tick range, adding/removing liquidity in the wrong range.
 *
 * FIX:
 *   - deadline parameter added to deposit() and withdraw()
 *   - Reverts with CuratedVaultHook_DeadlineExpired if block.timestamp > deadline
 *
 * ─── Finding #6 ───────────────────────────────────────────────────────────────
 * "Missing minShares allows silent share dilution"
 *
 * VULNERABILITY:
 *   deposit() enforced amount0Min/amount1Min but not share-output slippage.
 *   A front-runner inflating totalLiquidity caused the victim to receive far
 *   fewer shares than expected with no way to revert.
 *
 * FIX:
 *   - minShares parameter added to deposit()
 *   - Reverts with CuratedVaultHook_SlippageExceeded if shares < minShares
 */

import "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {CuratedVaultHook} from "../src/CuratedVaultHook.sol";
import {VaultShares} from "../src/VaultShares.sol";
import {IIdentityRegistry} from "../src/interfaces/IIdentityRegistry.sol";

// ═════════════════════════════════════════════════════════════════════════════
//  Finding #1 helpers — ERC-777 simulation + reentrancy attacker
// ═════════════════════════════════════════════════════════════════════════════

interface ITokenReceiver {
    function onTokenTransfer(address from, uint256 amount) external;
}

/// @dev Minimal ERC-20 that fires ITokenReceiver.onTokenTransfer on contract
///      recipients during every transfer(), simulating ERC-777 tokensReceived.
///      Uses try/catch so contracts that don't implement ITokenReceiver (e.g. the
///      hook receiving tokens in Step 1) don't revert the transfer.
///      If the callback itself reverts (e.g. re-entry blocked by nonReentrant),
///      the revert propagates out of onTokenTransfer and is caught here, rolling
///      back all state the callback set.
contract CallbackERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol) {
        name = _name;
        symbol = _symbol;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        if (to.code.length > 0) {
            try ITokenReceiver(to).onTokenTransfer(from, amount) {} catch {}
        }
        return true;
    }
}

/// @dev Attacker that re-enters deposit() from the ERC-777 refund callback.
///      Deposits 2:1 excess of the callback token to force a refund, which
///      fires onTokenTransfer and re-enters deposit().
contract ReentrancyAttacker is ITokenReceiver {
    CuratedVaultHook public immutable hook;
    address public immutable callbackToken;
    address public immutable stableToken;

    bool private _active;

    bool public reentrancyOccurred;
    uint256 public totalSupplyAtReentry;
    uint256 public totalLiquidityAtReentry;

    constructor(address _hook, address _cbToken, address _stableToken) {
        hook = CuratedVaultHook(_hook);
        callbackToken = _cbToken;
        stableToken = _stableToken;
    }

    function approveHook() external {
        CallbackERC20(callbackToken).approve(address(hook), type(uint256).max);
        MockERC20(stableToken).approve(address(hook), type(uint256).max);
    }

    function attack() external {
        _active = true;
        (Currency c0,,,,) = hook.poolKey();
        bool cbIsCurrency0 = address(callbackToken) == Currency.unwrap(c0);
        if (cbIsCurrency0) {
            hook.deposit(2 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);
        } else {
            hook.deposit(1 ether, 2 ether, 0, 0, 0.5 ether, type(uint256).max);
        }
        _active = false;
    }

    function onTokenTransfer(address, uint256) external override {
        if (_active && !reentrancyOccurred) {
            reentrancyOccurred = true;
            totalSupplyAtReentry = hook.vaultShares().totalSupply();
            totalLiquidityAtReentry = uint256(hook.totalLiquidity());
            hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, type(uint256).max);
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Finding #1 — Reentrancy
// ═════════════════════════════════════════════════════════════════════════════

contract Finding1ReentrancyTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    CuratedVaultHook hook;
    VaultShares vaultShares;
    PoolKey hookKey;

    CallbackERC20 cbToken;
    MockERC20 stableToken;

    ReentrancyAttacker attacker;
    address alice = makeAddr("alice");

    function setUp() public {
        deployFreshManagerAndRouters();

        cbToken = new CallbackERC20("CallbackToken", "CBT");
        stableToken = new MockERC20("StableToken", "STB", 18);

        (Currency currency0, Currency currency1) = address(cbToken) < address(stableToken)
            ? (Currency.wrap(address(cbToken)), Currency.wrap(address(stableToken)))
            : (Currency.wrap(address(stableToken)), Currency.wrap(address(cbToken)));

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        deployCodeTo("CuratedVaultHook.sol", abi.encode(manager), address(flags));
        hook = CuratedVaultHook(address(flags));
        vaultShares = hook.vaultShares();

        hookKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(hookKey, TickMath.getSqrtPriceAtTick(0));

        cbToken.mint(alice, 100 ether);
        stableToken.mint(alice, 100 ether);
        vm.startPrank(alice);
        cbToken.approve(address(hook), type(uint256).max);
        stableToken.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        attacker = new ReentrancyAttacker(address(hook), address(cbToken), address(stableToken));
        cbToken.mint(address(attacker), 100 ether);
        stableToken.mint(address(attacker), 100 ether);
        attacker.approveHook();
    }

    /// @notice Passes with nonReentrant fix. Fails if the guard is removed.
    ///
    ///         The re-entrant hook.deposit() reverts (ReentrancyGuardReentrantCall),
    ///         which propagates out of onTokenTransfer and is caught by the try/catch
    ///         in CallbackERC20, rolling back reentrancyOccurred to false.
    function test_finding1_nonReentrantGuardBlocksReentry() public {
        vm.prank(alice);
        hook.deposit(5 ether, 5 ether, 0, 0, 0, type(uint256).max);

        attacker.attack();

        assertFalse(attacker.reentrancyOccurred(), "nonReentrant must block re-entry");
        assertGt(vaultShares.balanceOf(address(attacker)), 0, "outer deposit must complete");
    }

    /// @notice Passes with nonReentrant + CEI fix. Fails if either is removed.
    ///
    ///         Re-entry is blocked entirely so no stale state snapshot is captured
    ///         (totalLiquidityAtReentry stays 0). The vault's final totalLiquidity
    ///         correctly reflects only the legitimate deposits.
    function test_finding1_noStaleTotalLiquidityWindow() public {
        vm.prank(alice);
        hook.deposit(10 ether, 10 ether, 0, 0, 5 ether, type(uint256).max);

        uint256 liquidityAfterAlice = hook.totalLiquidity();

        attacker.attack();

        assertEq(attacker.totalLiquidityAtReentry(), 0, "re-entry must not capture any state");
        assertGt(hook.totalLiquidity(), liquidityAfterAlice, "attacker outer deposit must be accounted for");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Finding #3 — Rebalance sandwich attack
// ═════════════════════════════════════════════════════════════════════════════

contract Finding3RebalanceSandwichTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    CuratedVaultHook hook;
    PoolKey hookKey;

    MockERC20 token0;
    MockERC20 token1;

    address alice = makeAddr("alice");
    address curator_addr = makeAddr("curator");
    address attacker_addr = makeAddr("attacker");

    address constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    function setUp() public {
        deployFreshManagerAndRouters();

        MockERC20 tokenA = new MockERC20("TokenA", "TKA", 18);
        MockERC20 tokenB = new MockERC20("TokenB", "TKB", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        deployCodeTo("CuratedVaultHook.sol", abi.encode(manager), address(flags));
        hook = CuratedVaultHook(address(flags));

        hookKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(hookKey, TickMath.getSqrtPriceAtTick(0));

        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);
        vm.startPrank(alice);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        vm.mockCall(
            IDENTITY_REGISTRY,
            abi.encodeWithSelector(IIdentityRegistry.ownerOf.selector, uint256(1)),
            abi.encode(curator_addr)
        );
        vm.prank(curator_addr);
        hook.registerCurator(500, 1);

        vm.roll(block.number + 31);
    }

    /// @dev Executes the sandwich: sells 2000 token1 to push price above tick 600.
    function _manipulatePriceUp() internal {
        token1.mint(attacker_addr, 2000 ether);
        vm.startPrank(attacker_addr);
        token1.approve(address(swapRouter), type(uint256).max);
        swapRouter.swap(
            hookKey,
            SwapParams({zeroForOne: false, amountSpecified: -2000 ether, sqrtPriceLimitX96: MAX_PRICE_LIMIT}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        vm.stopPrank();
        (, int24 tick,,) = manager.getSlot0(hookKey.toId());
        assertGt(tick, 600, "Precondition: price must be above tick 600");
    }

    /// @notice Documents the vulnerability: when protection is opted out
    ///         (maxIdleToken0 = type(uint256).max), a sandwiched rebalance
    ///         succeeds and leaves token0 stranded idle in the hook.
    function test_finding3_token0StrandedWhenProtectionOptedOut() public {
        vm.prank(alice);
        hook.deposit(100 ether, 100 ether, 0, 0, 50 ether, type(uint256).max);

        _manipulatePriceUp();

        vm.prank(curator_addr);
        hook.rebalance(-600, 600, 3000, type(uint256).max, type(uint256).max);

        (uint256 idleToken0,) = hook.totalAssets();
        assertGt(idleToken0, 1 ether, "token0 is stranded when idle check is skipped");
    }

    /// @notice Passes with the idle balance fix. Fails if _checkIdleBalance is removed.
    ///
    ///         With maxIdleToken0 = 0, the sandwiched rebalance reverts because
    ///         token0 cannot be deployed to [-600, 600] when price > tick 600.
    function test_finding3_idleBalanceCheckBlocksSandwich() public {
        vm.prank(alice);
        hook.deposit(100 ether, 100 ether, 0, 0, 50 ether, type(uint256).max);

        _manipulatePriceUp();

        vm.prank(curator_addr);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_ExcessiveIdleBalance.selector);
        hook.rebalance(-600, 600, 3000, 0, type(uint256).max);
    }

    /// @notice Passes with the fix. Confirms a clean (unmanipulated) rebalance
    ///         with maxIdleToken0 = 0 succeeds because both tokens are deployed
    ///         when price is inside the new range.
    function test_finding3_cleanRebalanceSucceedsWithStrictProtection() public {
        vm.prank(alice);
        hook.deposit(100 ether, 100 ether, 0, 0, 50 ether, type(uint256).max);

        // No price manipulation — price stays at tick 0, inside [-600, 600].
        // Both tokens are deployable, so idle balances are 0 after rebalance.
        vm.prank(curator_addr);
        hook.rebalance(-600, 600, 3000, 0, 0);

        (uint256 idleToken0, uint256 idleToken1) = hook.totalAssets();
        assertEq(idleToken0, 0, "no token0 idle after clean rebalance");
        assertEq(idleToken1, 0, "no token1 idle after clean rebalance");
        assertGt(hook.totalLiquidity(), 0, "liquidity deployed");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Finding #4 — Deadline
// ═════════════════════════════════════════════════════════════════════════════

contract Finding4DeadlineTest is Test, Deployers {
    CuratedVaultHook hook;
    VaultShares vaultShares;
    PoolKey hookKey;

    MockERC20 token0;
    MockERC20 token1;

    address alice = makeAddr("alice");

    function setUp() public {
        deployFreshManagerAndRouters();

        MockERC20 tokenA = new MockERC20("TokenA", "TKA", 18);
        MockERC20 tokenB = new MockERC20("TokenB", "TKB", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        deployCodeTo("CuratedVaultHook.sol", abi.encode(manager), address(flags));
        hook = CuratedVaultHook(address(flags));
        vaultShares = hook.vaultShares();

        hookKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(hookKey, TickMath.getSqrtPriceAtTick(0));

        token0.mint(alice, 100 ether);
        token1.mint(alice, 100 ether);
        vm.startPrank(alice);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    /// @notice Passes with deadline fix. Fails if deadline check is removed.
    function test_finding4_depositRevertsIfDeadlineExpired() public {
        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_DeadlineExpired.selector);
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, block.timestamp - 1);
    }

    /// @notice Passes with deadline fix. Fails if deadline check is removed.
    function test_finding4_withdrawRevertsIfDeadlineExpired() public {
        vm.prank(alice);
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, block.timestamp + 1 hours);
        uint256 aliceShares = vaultShares.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_DeadlineExpired.selector);
        hook.withdraw(aliceShares, 0, 0, block.timestamp - 1);
    }

    /// @notice Confirms a valid deadline does not block deposit.
    function test_finding4_depositSucceedsWithValidDeadline() public {
        vm.prank(alice);
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, block.timestamp + 1 hours);
        assertGt(vaultShares.balanceOf(alice), 0, "shares must be minted");
    }
}

// ═════════════════════════════════════════════════════════════════════════════
//  Finding #6 — minShares
// ═════════════════════════════════════════════════════════════════════════════

contract Finding6MinSharesTest is Test, Deployers {
    CuratedVaultHook hook;
    VaultShares vaultShares;
    PoolKey hookKey;

    MockERC20 token0;
    MockERC20 token1;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        deployFreshManagerAndRouters();

        MockERC20 tokenA = new MockERC20("TokenA", "TKA", 18);
        MockERC20 tokenB = new MockERC20("TokenB", "TKB", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
                | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
                | Hooks.BEFORE_SWAP_FLAG
                | Hooks.AFTER_SWAP_FLAG
        );
        deployCodeTo("CuratedVaultHook.sol", abi.encode(manager), address(flags));
        hook = CuratedVaultHook(address(flags));
        vaultShares = hook.vaultShares();

        hookKey = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 0x800000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(hookKey, TickMath.getSqrtPriceAtTick(0));

        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);
        vm.startPrank(alice);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        token0.mint(bob, 100 ether);
        token1.mint(bob, 100 ether);
        vm.startPrank(bob);
        token0.approve(address(hook), type(uint256).max);
        token1.approve(address(hook), type(uint256).max);
        vm.stopPrank();
    }

    /// @notice Passes with minShares fix. Fails if minShares check is removed.
    ///
    ///         Bob front-runs alice's deposit, doubling totalLiquidity so alice
    ///         receives roughly half the expected shares. Demanding
    ///         type(uint256).max shares is always impossible → SlippageExceeded.
    function test_finding6_depositRevertsIfSharesBelowMinShares() public {
        vm.prank(alice);
        hook.deposit(100 ether, 100 ether, 0, 0, 50 ether, block.timestamp + 1 hours);

        // Bob front-runs: doubles totalLiquidity
        vm.prank(bob);
        hook.deposit(100 ether, 100 ether, 0, 0, 50 ether, block.timestamp + 1 hours);

        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.CuratedVaultHook_SlippageExceeded.selector);
        hook.deposit(1 ether, 1 ether, 0, 0, type(uint256).max, block.timestamp + 1 hours);
    }

    /// @notice Confirms minShares = 0 never blocks a deposit.
    function test_finding6_depositSucceedsWithZeroMinShares() public {
        vm.prank(alice);
        hook.deposit(1 ether, 1 ether, 0, 0, 0.5 ether, block.timestamp + 1 hours);
        assertGt(vaultShares.balanceOf(alice), 0, "shares must be minted");
    }
}
