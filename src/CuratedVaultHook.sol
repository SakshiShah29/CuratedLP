// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";
import {VaultShares} from "./VaultShares.sol";

/// @title CuratedVaultHook
/// @notice Uniswap v4 hook that manages a concentrated liquidity vault.
///         LPs deposit tokens and receive vault shares. A curator agent
///         manages the tick range and fee. All liquidity is owned by this hook.
contract CuratedVaultHook is BaseHook,IUnlockCallback{
 using PoolIdLibrary for PoolKey;
 using StateLibrary for IPoolManager;

 error CuratedVaultHook_PoolNotInitialized();
    error CuratedVaultHook_DirectLiquidityNotAllowed();
    error CuratedVaultHook_OnlyHookCanModifyLiquidity();
    error CuratedVaultHook_ZeroShares();
    error CuratedVaultHook_InsufficientShares();
    error CuratedVaultHook_ZeroDeposit();
    error CuratedVaultHook_CallbackNotFromPoolManager();
    error CuratedVaultHook_SlippageExceeded();

    event Deposited(address indexed depositor, uint256 amount0, uint256 amount1, uint256 shares);
    event Withdrawn(address indexed withdrawer, uint256 shares, uint256 amount0, uint256 amount1);
    event LiquidityModified(int24 tickLower, int24 tickUpper, int128 liquidityDelta);


    /// @dev Dead shares minted to address(1) on first deposit to prevent
    ///      share inflation attacks. See: ERC-4626 inflation attack.
    uint256 public constant MINIMUM_SHARES = 1000;

    VaultShares public immutable vaultShares;
    PoolKey public poolKey;
    PoolId public poolId;
    bool public poolInitialized;

     /// @dev The current concentrated liquidity position boundaries.
    int24 public currentTickLower;
    int24 public currentTickUpper;

/// @dev Total liquidity units owned by this hook in the PoolManager.
    uint128 public totalLiquidity;

    /// @dev Salt for the hook's position in the PoolManager.
    ///      v4 uses salt to distinguish positions owned by the same address.
    bytes32 public constant POSITION_SALT = bytes32(uint256(0xCDAB));

     enum CallbackAction {
        ADD_LIQUIDITY,
        REMOVE_LIQUIDITY
    }

    struct CallbackData {
        CallbackAction action;
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        address sender;
    }

    // ═════════════════════════════════════════════════════════════════════
    //                          CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        vaultShares = new VaultShares(address(this));
    }

    // ═════════════════════════════════════════════════════════════════════
    //                       HOOK PERMISSIONS
    // ═════════════════════════════════════════════════════════════════════

    function getHookPermissions()
        public
        pure
        override
        returns (Hooks.Permissions memory)
    {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true,         // Store pool key
            beforeAddLiquidity: true,       // Block direct adds
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true,    // Block direct removes
            afterRemoveLiquidity: false,
            beforeSwap: true,               
            afterSwap: true,               
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // ═════════════════════════════════════════════════════════════════════
    //                        HOOK CALLBACKS
    // ═════════════════════════════════════════════════════════════════════

    /// @dev Called by PoolManager after pool initialization.
    ///      Stores the pool key so the hook knows which pool it manages.
    function _afterInitialize(
        address,
        PoolKey calldata key,
        uint160,
        int24
    ) internal override returns (bytes4) {
        poolKey = key;
        poolId = key.toId();
        poolInitialized = true;

        // Set initial tick range: wide range for safety on first deploy.
        // The curator will tighten this in Phase 2.
        currentTickLower = -887220; // Near MIN_TICK, aligned to tickSpacing=60
        currentTickUpper = 887220;  // Near MAX_TICK, aligned to tickSpacing=60

        return this.afterInitialize.selector;
    }

    /// @dev Blocks ALL direct liquidity additions to the pool.
    ///      Users MUST go through deposit() on this hook.
    ///      The hook itself IS allowed to add liquidity (via the unlock callback).
    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) internal view override returns (bytes4) {
        // The PoolManager calls this with sender = the address that called
        // poolManager.modifyLiquidity(). When the hook itself adds liquidity
        // via the unlock callback, the sender is this contract.
        if (sender != address(this)) {
            revert CuratedVaultHook_DirectLiquidityNotAllowed();
        }
        return this.beforeAddLiquidity.selector;
    }

    /// @dev Blocks ALL direct liquidity removals from the pool.
    ///      Users MUST go through withdraw() on this hook.
    function _beforeRemoveLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) internal view override returns (bytes4) {
        if (sender != address(this)) {
            revert CuratedVaultHook_DirectLiquidityNotAllowed();
        }
        return this.beforeRemoveLiquidity.selector;
    }

    /// @dev Phase 1 stub: returns default fee. Phase 2 adds dynamic fees.
    function _beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) internal pure override returns (bytes4, BeforeSwapDelta, uint24) {
        // Return zero delta (no fee override yet) and no fee adjustment.
        // Phase 2 will return: fee | LPFeeLibrary.OVERRIDE_FEE_FLAG
        return (
            this.beforeSwap.selector,
            BeforeSwapDeltaLibrary.ZERO_DELTA,
            0
        );
    }

    /// @dev Phase 1 stub: no-op. Phase 2 adds fee revenue tracking.
    function _afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) internal pure override returns (bytes4, int128) {
        return (this.afterSwap.selector, 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    //                         DEPOSIT
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Deposit tokens into the vault and receive shares.
    /// @param amount0Desired Amount of token0 (lower-address token) to deposit.
    /// @param amount1Desired Amount of token1 (higher-address token) to deposit.
    /// @param amount0Min Minimum token0 accepted (slippage protection).
    /// @param amount1Min Minimum token1 accepted (slippage protection).
    /// @return shares Number of vault shares minted.
    function deposit(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 shares) {
        if (!poolInitialized) revert CuratedVaultHook_PoolNotInitialized();
        if (amount0Desired == 0 && amount1Desired == 0) revert CuratedVaultHook_ZeroDeposit();

        // ── Step 1: Transfer tokens from depositor to this hook ──────
        {
            IERC20Minimal token0 = IERC20Minimal(Currency.unwrap(poolKey.currency0));
            IERC20Minimal token1 = IERC20Minimal(Currency.unwrap(poolKey.currency1));
            if (amount0Desired > 0) token0.transferFrom(msg.sender, address(this), amount0Desired);
            if (amount1Desired > 0) token1.transferFrom(msg.sender, address(this), amount1Desired);
        }

        // ── Step 2: Calculate liquidity from deposited amounts ───────
        uint128 liquidity;
        {
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
            liquidity = _getLiquidityForAmounts(
                sqrtPriceX96,
                TickMath.getSqrtPriceAtTick(currentTickLower),
                TickMath.getSqrtPriceAtTick(currentTickUpper),
                amount0Desired,
                amount1Desired
            );
        }
        if (liquidity == 0) revert CuratedVaultHook_ZeroDeposit();

        // ── Step 3: Add liquidity to the pool via unlock callback ────
        uint256 amount0Used;
        uint256 amount1Used;
        {
            (int256 delta0, int256 delta1) = _modifyPoolLiquidity(
                currentTickLower,
                currentTickUpper,
                int256(uint256(liquidity))
            );
            // delta0 and delta1 are NEGATIVE when we owe tokens to the pool.
            amount0Used = uint256(-delta0);
            amount1Used = uint256(-delta1);
        }

        // ── Step 4: Slippage check ──────────────────────────────────
        if (amount0Used < amount0Min || amount1Used < amount1Min) {
            revert CuratedVaultHook_SlippageExceeded();
        }

        // ── Step 5: Refund unused tokens ────────────────────────────
        {
            IERC20Minimal token0 = IERC20Minimal(Currency.unwrap(poolKey.currency0));
            IERC20Minimal token1 = IERC20Minimal(Currency.unwrap(poolKey.currency1));
            if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
            if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
        }

        // ── Step 6: Compute and mint shares ─────────────────────────
        uint256 currentTotalShares = vaultShares.totalSupply();

        if (currentTotalShares == 0) {
            shares = _sqrt(amount0Used * amount1Used);
            if (shares <= MINIMUM_SHARES) revert CuratedVaultHook_ZeroShares();
            vaultShares.mint(address(1), MINIMUM_SHARES);
            shares -= MINIMUM_SHARES;
        } else {
            shares = (uint256(liquidity) * currentTotalShares) / uint256(totalLiquidity);
        }

        if (shares == 0) revert CuratedVaultHook_ZeroShares();

        totalLiquidity += liquidity;
        vaultShares.mint(msg.sender, shares);

        emit Deposited(msg.sender, amount0Used, amount1Used, shares);
    }

    // ═════════════════════════════════════════════════════════════════════
    //                        WITHDRAW
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Burn shares and withdraw proportional tokens from the vault.
    /// @param sharesToBurn Number of vault shares to burn.
    /// @param amount0Min Minimum token0 to receive (slippage protection).
    /// @param amount1Min Minimum token1 to receive (slippage protection).
    /// @return amount0 Tokens returned to withdrawer.
    /// @return amount1 Tokens returned to withdrawer.
    function withdraw(
        uint256 sharesToBurn,
        uint256 amount0Min,
        uint256 amount1Min
    ) external returns (uint256 amount0, uint256 amount1) {
        if (!poolInitialized) revert CuratedVaultHook_PoolNotInitialized();
        if (sharesToBurn == 0) revert CuratedVaultHook_InsufficientShares();
        if (vaultShares.balanceOf(msg.sender) < sharesToBurn) revert CuratedVaultHook_InsufficientShares();

        // ── Step 1: Calculate proportional liquidity to remove ───────
        uint256 currentTotalShares = vaultShares.totalSupply();
        uint128 liquidityToRemove = uint128(
            (uint256(totalLiquidity) * sharesToBurn) / currentTotalShares
        );

        if (liquidityToRemove == 0) revert CuratedVaultHook_ZeroShares();

        // ── Step 2: Remove liquidity from pool via unlock callback ───
        // Negative liquidityDelta = remove liquidity.
        (int256 delta0, int256 delta1) = _modifyPoolLiquidity(
            currentTickLower,
            currentTickUpper,
            -int256(uint256(liquidityToRemove))
        );

        // delta0 and delta1 are POSITIVE when the pool owes us tokens.
        amount0 = uint256(delta0);
        amount1 = uint256(delta1);

        // ── Step 3: Slippage check ──────────────────────────────────
        if (amount0 < amount0Min || amount1 < amount1Min) {
            revert CuratedVaultHook_SlippageExceeded();
        }

        // ── Step 4: Update state ────────────────────────────────────
        totalLiquidity -= liquidityToRemove;
        vaultShares.burn(msg.sender, sharesToBurn);

        // ── Step 5: Transfer tokens to withdrawer ───────────────────
        IERC20Minimal token0 = IERC20Minimal(Currency.unwrap(poolKey.currency0));
        IERC20Minimal token1 = IERC20Minimal(Currency.unwrap(poolKey.currency1));

        if (amount0 > 0) token0.transfer(msg.sender, amount0);
        if (amount1 > 0) token1.transfer(msg.sender, amount1);

        emit Withdrawn(msg.sender, sharesToBurn, amount0, amount1);
    }

    // ═════════════════════════════════════════════════════════════════════
    //                    UNLOCK CALLBACK
    // ═════════════════════════════════════════════════════════════════════

    /// @dev Called by PoolManager after unlock(). This is where the actual
    ///      liquidity modification happens.
    ///
    ///      CRITICAL SECURITY: This function is called by the PoolManager
    ///      via the IUnlockCallback interface. The `onlyPoolManager` check
    ///      ensures only the PoolManager can call it.
    function unlockCallback(
        bytes calldata data
    ) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) {
            revert CuratedVaultHook_CallbackNotFromPoolManager();
        }

        CallbackData memory cbData = abi.decode(data, (CallbackData));

        // Perform the liquidity modification
        (BalanceDelta callerDelta, ) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: cbData.tickLower,
                tickUpper: cbData.tickUpper,
                liquidityDelta: cbData.liquidityDelta,
                salt: POSITION_SALT
            }),
            ""  // No hookData needed — we ARE the hook
        );

        // ── Settle deltas ────────────────────────────────────────────
        // CRITICAL: Use the ACTUAL deltas returned by modifyLiquidity(),
        // not pre-calculated amounts. Uniswap docs: "Never assume
        // getAmountsForLiquidity() == modifyLiquidity() deltas".
        //
        // When ADDING liquidity (positive liquidityDelta):
        //   callerDelta.amount0() < 0 → we OWE token0 to the pool
        //   callerDelta.amount1() < 0 → we OWE token1 to the pool
        //   We settle by transferring tokens to the PoolManager.
        //
        // When REMOVING liquidity (negative liquidityDelta):
        //   callerDelta.amount0() > 0 → the pool OWES us token0
        //   callerDelta.amount1() > 0 → the pool OWES us token1
        //   We take by pulling tokens from the PoolManager.

        _settleDelta(poolKey.currency0, callerDelta.amount0());
        _settleDelta(poolKey.currency1, callerDelta.amount1());

        // Return the actual deltas so the caller (deposit/withdraw) can
        // use them for refunds and share calculations.
        return abi.encode(callerDelta.amount0(), callerDelta.amount1());
    }

    // ═════════════════════════════════════════════════════════════════════
    //                      INTERNAL HELPERS
    // ═════════════════════════════════════════════════════════════════════

    /// @dev Calls poolManager.unlock() with encoded callback data.
    ///      Returns the actual token amounts consumed/returned.
    function _modifyPoolLiquidity(
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    ) internal returns (int256 amount0, int256 amount1) {
        bytes memory result = poolManager.unlock(
            abi.encode(CallbackData({
                action: liquidityDelta > 0
                    ? CallbackAction.ADD_LIQUIDITY
                    : CallbackAction.REMOVE_LIQUIDITY,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                sender: msg.sender
            }))
        );

        (amount0, amount1) = abi.decode(result, (int256, int256));
    }

    /// @dev Settles a single currency delta with the PoolManager.
    ///      Negative delta = we owe → transfer tokens TO PoolManager.
    ///      Positive delta = pool owes us → take tokens FROM PoolManager.
    function _settleDelta(Currency currency, int128 delta) internal {
        if (delta < 0) {
            // We owe tokens to the pool. Transfer them.
            uint256 amount = uint256(uint128(-delta));
            // sync() must be called before transferring ERC-20 tokens
            poolManager.sync(currency);
            IERC20Minimal(Currency.unwrap(currency)).transfer(
                address(poolManager),
                amount
            );
            poolManager.settle();
        } else if (delta > 0) {
            // The pool owes us tokens. Take them.
            uint256 amount = uint256(uint128(delta));
            poolManager.take(currency, address(this), amount);
        }
        // delta == 0: nothing to do
    }

    /// @dev Compute liquidity from token amounts and current price.
    ///      Replicates LiquidityAmounts.getLiquidityForAmounts() logic.
    ///      This is a VIEW function — no state changes.
    function _getLiquidityForAmounts(
        uint160 sqrtPriceX96,
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount0,
        uint256 amount1
    ) internal pure returns (uint128 liquidity) {
        // Ensure sqrtPriceA < sqrtPriceB
        if (sqrtPriceAX96 > sqrtPriceBX96) {
            (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        }

        if (sqrtPriceX96 <= sqrtPriceAX96) {
            // Current price below range: all token0
            liquidity = _getLiquidityForAmount0(sqrtPriceAX96, sqrtPriceBX96, amount0);
        } else if (sqrtPriceX96 < sqrtPriceBX96) {
            // Current price inside range: both tokens
            uint128 liquidity0 = _getLiquidityForAmount0(sqrtPriceX96, sqrtPriceBX96, amount0);
            uint128 liquidity1 = _getLiquidityForAmount1(sqrtPriceAX96, sqrtPriceX96, amount1);
            liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
        } else {
            // Current price above range: all token1
            liquidity = _getLiquidityForAmount1(sqrtPriceAX96, sqrtPriceBX96, amount1);
        }
    }

    function _getLiquidityForAmount0(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount0
    ) internal pure returns (uint128) {
        uint256 intermediate = uint256(sqrtPriceAX96) * uint256(sqrtPriceBX96) / (1 << 96);
        return uint128(amount0 * intermediate / (uint256(sqrtPriceBX96) - uint256(sqrtPriceAX96)));
    }

    function _getLiquidityForAmount1(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint256 amount1
    ) internal pure returns (uint128) {
        return uint128(amount1 * (1 << 96) / (uint256(sqrtPriceBX96) - uint256(sqrtPriceAX96)));
    }

    /// @dev Integer square root (Babylonian method).
    function _sqrt(uint256 x) internal pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = x / 2 + 1;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //                       VIEW FUNCTIONS
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Returns the total value of the vault in token terms.
    function totalAssets() external view returns (uint256 amount0, uint256 amount1) {
        amount0 = IERC20Minimal(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
        amount1 = IERC20Minimal(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
    }

    /// @notice Token addresses in the pool (sorted).
    function getTokens() external view returns (address token0, address token1) {
        token0 = Currency.unwrap(poolKey.currency0);
        token1 = Currency.unwrap(poolKey.currency1);
    }
}
