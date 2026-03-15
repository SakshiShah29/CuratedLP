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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BaseHook} from "v4-hooks-public/src/base/BaseHook.sol";
import {VaultShares} from "./VaultShares.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {IReputationRegistry} from "./interfaces/IReputationRegistry.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CuratedVaultHook
/// @notice Uniswap v4 hook that manages a concentrated liquidity vault.
///         LPs deposit tokens and receive vault shares. A curator agent
///         manages the tick range and fee. All liquidity is owned by this hook.
contract CuratedVaultHook is BaseHook, IUnlockCallback, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    error CuratedVaultHook_PoolNotInitialized();
    error CuratedVaultHook_DirectLiquidityNotAllowed();
    error CuratedVaultHook_OnlyHookCanModifyLiquidity();
    error CuratedVaultHook_ZeroShares();
    error CuratedVaultHook_InsufficientShares();
    error CuratedVaultHook_ZeroDeposit();
    error CuratedVaultHook_CallbackNotFromPoolManager();
    error CuratedVaultHook_SlippageExceeded();
    error CuratedVaultHook_CuratorAlreadyRegistered();
    error CuratedVaultHook_InvalidPerformanceFee();
    error CuratedVaultHook_CuratorNotActive();
    error CuratedVaultHook_OnlyCurator();
    error CuratedVaultHook_InvalidFee();
    error CuratedVaultHook_InvalidTickRange();
    error CuratedVaultHook_RebalanceTooFrequent();
    error CuratedVaultHook_IdentityNotOwned();
    error CuratedVaultHook_NoCuratorSet();
    error CuratedVaultHook_ExcessiveIdleBalance();
    error CuratedVaultHook_DeadlineExpired();

    event Deposited(address indexed depositor, uint256 amount0, uint256 amount1, uint256 shares);
    event Withdrawn(address indexed withdrawer, uint256 shares, uint256 amount0, uint256 amount1);
    event LiquidityModified(int24 tickLower, int24 tickUpper, int128 liquidityDelta);
    event CuratorRegistered(uint256 indexed curatorId, address indexed wallet, uint256 erc8004IdentityId);
    event Rebalanced(uint256 indexed curatorId, int24 newTickLower, int24 newTickUpper, uint24 newFee);
    event FeeUpdated(uint24 oldFee, uint24 newFee);
    event SwapTracked(uint256 volume, uint256 feeRevenue);

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
    /// @dev Maximum performance fee a curator can charge: 20% (2000 bps)
    uint256 public constant MAX_PERFORMANCE_FEE_BPS = 2000;

    /// @dev Minimum blocks between rebalances (prevents spam). ~1 minute on Base.
    uint64 public constant MIN_REBALANCE_INTERVAL = 30;

    /// @dev Default fee for new pools before a curator sets one: 0.30%
    uint24 public constant DEFAULT_FEE = 3000;

    /// @dev Maximum LP fee: 10% (100000 in hundredths of bip)
    uint24 public constant MAX_FEE = 100000;

    /// @dev ERC-8004 contracts on Base Sepolia
    IIdentityRegistry public constant IDENTITY_REGISTRY = IIdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
    IReputationRegistry public constant REPUTATION_REGISTRY =
        IReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);

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

    struct Curator {
        address wallet; // The curator's address
        uint256 erc8004IdentityId; // ERC-8004 identity token ID
        uint24 recommendedFee; // Current fee in hundredths of bip
        uint256 performanceFeeBps; // Performance fee in basis points (max 2000 = 20%)
        uint64 lastRebalanceBlock; // Block number of last rebalance
        bool active; // Whether this curator is active
    }
    /// @dev Curator ID → Curator data. Curator IDs are sequential starting at 1.
    mapping(uint256 => Curator) public curators;

    /// @dev Wallet address → Curator ID. Prevents double registration.
    mapping(address => uint256) public curatorByWallet;

    /// @dev The next curator ID to assign.
    uint256 public nextCuratorId = 1;

    /// @dev The currently active curator for this vault. 0 = no curator.
    uint256 public activeCuratorId;

    // ─── Fee tracking state ──────────────────────────────────────────
    /// @dev Cumulative absolute swap volume (token0 denominated).
    uint256 public cumulativeVolume;

    /// @dev Cumulative approximate fee revenue (token0 denominated).
    uint256 public cumulativeFeeRevenue;

    /// @dev Total number of swaps processed.
    uint256 public totalSwaps;

    // ═════════════════════════════════════════════════════════════════════
    //                          CONSTRUCTOR
    // ═════════════════════════════════════════════════════════════════════

    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
        vaultShares = new VaultShares(address(this));
    }

    // ═════════════════════════════════════════════════════════════════════
    //                       HOOK PERMISSIONS
    // ═════════════════════════════════════════════════════════════════════

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: true, // Store pool key
            beforeAddLiquidity: true, // Block direct adds
            afterAddLiquidity: false,
            beforeRemoveLiquidity: true, // Block direct removes
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
    function _afterInitialize(address, PoolKey calldata key, uint160, int24) internal override returns (bytes4) {
        poolKey = key;
        poolId = key.toId();
        poolInitialized = true;

        currentTickLower = -887220;
        currentTickUpper = 887220;

        // Set the initial dynamic fee so swaps work before a curator registers.
        // Without this, dynamic fee pools start at 0%.
        poolManager.updateDynamicLPFee(key, DEFAULT_FEE);

        return this.afterInitialize.selector;
    }

    /// @dev Blocks ALL direct liquidity additions to the pool.
    ///      Users MUST go through deposit() on this hook.
    ///      The hook itself IS allowed to add liquidity (via the unlock callback).
    function _beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
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
    function _beforeRemoveLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4)
    {
        if (sender != address(this)) {
            revert CuratedVaultHook_DirectLiquidityNotAllowed();
        }
        return this.beforeRemoveLiquidity.selector;
    }

    /// @dev Returns the active curator's recommended fee for every swap.
    ///      If no curator is set, returns DEFAULT_FEE.
    function _beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        uint24 fee;

        if (activeCuratorId != 0) {
            fee = curators[activeCuratorId].recommendedFee;
        } else {
            fee = DEFAULT_FEE;
        }

        // Return the fee with OVERRIDE_FEE_FLAG set.
        // This tells the PoolManager: "use this fee for this swap,
        // overriding whatever fee is stored in the pool's slot0."
        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    /// @dev Track cumulative swap volume and approximate fee revenue.
    function _afterSwap(address, PoolKey calldata, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        // Compute the absolute swap volume.
        // delta.amount0() is the change in token0: negative if swapper sold token0,
        // positive if swapper bought token0.
        // We use the absolute value of amount0 as the volume measure.
        int128 amount0 = delta.amount0();
        uint256 volume = amount0 < 0 ? uint256(uint128(-amount0)) : uint256(uint128(amount0));

        // Approximate fee revenue:
        // The PoolManager already deducted the fee from the swap output.
        // Fee revenue ≈ volume * currentFee / 1_000_000
        // (fee is in hundredths of a bip, so 1_000_000 = 100%)
        uint24 currentFee = activeCuratorId != 0 ? curators[activeCuratorId].recommendedFee : DEFAULT_FEE;

        uint256 feeRevenue = (volume * uint256(currentFee)) / 1_000_000;

        cumulativeVolume += volume;
        cumulativeFeeRevenue += feeRevenue;
        totalSwaps++;

        emit SwapTracked(volume, feeRevenue);

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
    /// @param minShares Minimum vault shares to receive. Reverts if diluted below this.
    /// @param deadline Unix timestamp after which the transaction reverts.
    /// @return shares Number of vault shares minted.
    function deposit(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 minShares,
        uint256 deadline
    ) external nonReentrant returns (uint256 shares) {
        if (block.timestamp > deadline) revert CuratedVaultHook_DeadlineExpired();
        if (!poolInitialized) revert CuratedVaultHook_PoolNotInitialized();
        if (amount0Desired == 0 && amount1Desired == 0) revert CuratedVaultHook_ZeroDeposit();

        // ── Step 1: Transfer tokens from depositor to this hook ──────
        {
            IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
            IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));
            if (amount0Desired > 0) token0.safeTransferFrom(msg.sender, address(this), amount0Desired);
            if (amount1Desired > 0) token1.safeTransferFrom(msg.sender, address(this), amount1Desired);
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
            (int256 delta0, int256 delta1) =
                _modifyPoolLiquidity(currentTickLower, currentTickUpper, int256(uint256(liquidity)));
            // delta0 and delta1 are NEGATIVE when we owe tokens to the pool.
            amount0Used = uint256(-delta0);
            amount1Used = uint256(-delta1);
        }

        // ── Step 4: Slippage check ──────────────────────────────────
        if (amount0Used < amount0Min || amount1Used < amount1Min) {
            revert CuratedVaultHook_SlippageExceeded();
        }

        // ── Step 5: Compute and mint shares (CEI: state before external calls) ──
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
        if (shares < minShares) revert CuratedVaultHook_SlippageExceeded();

        totalLiquidity += liquidity;
        vaultShares.mint(msg.sender, shares);

        emit Deposited(msg.sender, amount0Used, amount1Used, shares);

        // ── Step 6: Refund unused tokens (interactions last) ─────────
        {
            IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
            IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));
            if (amount0Desired > amount0Used) token0.safeTransfer(msg.sender, amount0Desired - amount0Used);
            if (amount1Desired > amount1Used) token1.safeTransfer(msg.sender, amount1Desired - amount1Used);
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    //                        WITHDRAW
    // ═════════════════════════════════════════════════════════════════════

    /// @notice Burn shares and withdraw proportional tokens from the vault.
    /// @param sharesToBurn Number of vault shares to burn.
    /// @param amount0Min Minimum token0 to receive (slippage protection).
    /// @param amount1Min Minimum token1 to receive (slippage protection).
    /// @param deadline Unix timestamp after which the transaction reverts.
    /// @return amount0 Tokens returned to withdrawer.
    /// @return amount1 Tokens returned to withdrawer.
    function withdraw(uint256 sharesToBurn, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        if (block.timestamp > deadline) revert CuratedVaultHook_DeadlineExpired();
        if (!poolInitialized) revert CuratedVaultHook_PoolNotInitialized();
        if (sharesToBurn == 0) revert CuratedVaultHook_InsufficientShares();
        if (vaultShares.balanceOf(msg.sender) < sharesToBurn) revert CuratedVaultHook_InsufficientShares();

        // ── Step 1: Calculate proportional liquidity to remove ───────
        uint256 currentTotalShares = vaultShares.totalSupply();
        uint128 liquidityToRemove = uint128((uint256(totalLiquidity) * sharesToBurn) / currentTotalShares);

        if (liquidityToRemove == 0) revert CuratedVaultHook_ZeroShares();

        // ── Step 2: Remove liquidity from pool via unlock callback ───
        // Negative liquidityDelta = remove liquidity.
        (int256 delta0, int256 delta1) =
            _modifyPoolLiquidity(currentTickLower, currentTickUpper, -int256(uint256(liquidityToRemove)));

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
        IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
        IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));

        if (amount0 > 0) token0.safeTransfer(msg.sender, amount0);
        if (amount1 > 0) token1.safeTransfer(msg.sender, amount1);

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
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) {
            revert CuratedVaultHook_CallbackNotFromPoolManager();
        }

        CallbackData memory cbData = abi.decode(data, (CallbackData));

        // Perform the liquidity modification
        (BalanceDelta callerDelta,) = poolManager.modifyLiquidity(
            poolKey,
            ModifyLiquidityParams({
                tickLower: cbData.tickLower,
                tickUpper: cbData.tickUpper,
                liquidityDelta: cbData.liquidityDelta,
                salt: POSITION_SALT
            }),
            "" // No hookData needed — we ARE the hook
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
    //                     REBALANCE FUNCTION
    // ═════════════════════════════════════════════════════════════════════
    /// @notice Rebalance the vault's liquidity position to a new tick range and fee.
    /// @dev Only the active curator can call this.
    /// @param newTickLower New lower tick boundary (must be aligned to tickSpacing).
    /// @param newTickUpper New upper tick boundary (must be aligned to tickSpacing).
    /// @param newFee New swap fee in hundredths of a bip (e.g., 3000 = 0.30%).
    /// @param maxIdleToken0 Maximum amount of token0 allowed to remain undeployed after rebalance.
    ///        Reverts if the actual idle token0 exceeds this value.
    ///        Pass type(uint256).max to skip the check.
    /// @param maxIdleToken1 Maximum amount of token1 allowed to remain undeployed after rebalance.
    ///        Pass type(uint256).max to skip the check.
    function rebalance(
        int24 newTickLower,
        int24 newTickUpper,
        uint24 newFee,
        uint256 maxIdleToken0,
        uint256 maxIdleToken1
    ) external nonReentrant {
        if (!poolInitialized) revert CuratedVaultHook_PoolNotInitialized();

        // ── Check 1: Caller is the active curator ────────────────────
        uint256 curatorId = curatorByWallet[msg.sender];
        if (curatorId == 0) revert CuratedVaultHook_OnlyCurator();
        if (curatorId != activeCuratorId) revert CuratedVaultHook_OnlyCurator();

        Curator storage curator = curators[curatorId];
        if (!curator.active) revert CuratedVaultHook_CuratorNotActive();

        // ── Check 2: Rate limiting ───────────────────────────────────
        if (uint64(block.number) < curator.lastRebalanceBlock + MIN_REBALANCE_INTERVAL) {
            revert CuratedVaultHook_RebalanceTooFrequent();
        }

        // ── Check 3: Valid tick range ────────────────────────────────
        if (newTickLower >= newTickUpper) revert CuratedVaultHook_InvalidTickRange();
        // Ticks must be aligned to pool's tickSpacing (60)
        if (newTickLower % poolKey.tickSpacing != 0) revert CuratedVaultHook_InvalidTickRange();
        if (newTickUpper % poolKey.tickSpacing != 0) revert CuratedVaultHook_InvalidTickRange();

        // ── Check 4: Valid fee ───────────────────────────────────────
        if (newFee > MAX_FEE) revert CuratedVaultHook_InvalidFee();
        if (newFee == 0) revert CuratedVaultHook_InvalidFee();

        // ── Step 1: Remove ALL current liquidity ─────────────────────
        // Only rebalance if there is existing liquidity.
        if (totalLiquidity > 0) {
            _modifyPoolLiquidity(currentTickLower, currentTickUpper, -int256(uint256(totalLiquidity)));

            // After removal, the hook holds the withdrawn tokens in its balance.
            // We don't transfer them anywhere — they stay in the hook for re-deposit.
        }

        // ── Step 2: Update state ─────────────────────────────────────
        uint24 oldFee = curator.recommendedFee;
        currentTickLower = newTickLower;
        currentTickUpper = newTickUpper;
        curator.recommendedFee = newFee;
        curator.lastRebalanceBlock = uint64(block.number);

        // ── Step 3: Re-add ALL liquidity at new range ────────────────
        if (totalLiquidity > 0) {
            // Recalculate how much liquidity we can provide with our
            // current token balances at the new tick range.
            (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

            IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
            IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));

            uint256 balance0 = token0.balanceOf(address(this));
            uint256 balance1 = token1.balanceOf(address(this));

            uint128 newLiquidity = _getLiquidityForAmounts(
                sqrtPriceX96,
                TickMath.getSqrtPriceAtTick(newTickLower),
                TickMath.getSqrtPriceAtTick(newTickUpper),
                balance0,
                balance1
            );

            if (newLiquidity > 0) {
                _modifyPoolLiquidity(newTickLower, newTickUpper, int256(uint256(newLiquidity)));

                // Update totalLiquidity to reflect the new position.
                // Note: newLiquidity may differ from old totalLiquidity because
                // the tick range changed. This is expected.
                totalLiquidity = newLiquidity;
            } else {
                totalLiquidity = 0;
            }

            // ── Idle balance check ───────────────────────────────────
            // Reverts if more tokens remain undeployed than the caller allows.
            // Sandwich attacks that move the price outside the new tick range
            // leave one token entirely idle; this check catches that.
            _checkIdleBalance(maxIdleToken0, maxIdleToken1);
        }

        emit FeeUpdated(oldFee, newFee);
        emit Rebalanced(curatorId, newTickLower, newTickUpper, newFee);
        emit LiquidityModified(newTickLower, newTickUpper, int128(uint128(totalLiquidity)));
    }

    // ═════════════════════════════════════════════════════════════════════
    //                      CURATOR REGISTRATION
    // ═════════════════════════════════════════════════════════════════════
    /// @notice Register as a curator for this vault.
    /// @param performanceFeeBps Performance fee in basis points (max 2000 = 20%).
    /// @param erc8004IdentityId The caller's ERC-8004 identity NFT token ID.
    /// @return curatorId The assigned curator ID.
    function registerCurator(uint256 performanceFeeBps, uint256 erc8004IdentityId)
        external
        returns (uint256 curatorId)
    {
        // ── Check 1: Not already registered ──────────────────────────
        if (curatorByWallet[msg.sender] != 0) revert CuratedVaultHook_CuratorAlreadyRegistered();

        // ── Check 2: Performance fee within bounds ───────────────────
        if (performanceFeeBps > MAX_PERFORMANCE_FEE_BPS) revert CuratedVaultHook_InvalidPerformanceFee();

        // ── Check 3: Caller owns the ERC-8004 identity NFT ──────────
        // This is a REAL on-chain call to the live IdentityRegistry
        // at 0x8004A818BFB912233c491871b3d84c89A494BD9e on Base Sepolia.
        // If the caller doesn't own this identity, the call reverts.
        //
        // NOTE: If the ERC-8004 contract's ownerOf() reverts for
        // non-existent tokens (standard ERC-721 behavior), this
        // will also revert, which is the correct behavior.
        address identityOwner = IDENTITY_REGISTRY.ownerOf(erc8004IdentityId);
        if (identityOwner != msg.sender) revert CuratedVaultHook_IdentityNotOwned();

        // ── Store the curator ────────────────────────────────────────
        curatorId = nextCuratorId++;

        curators[curatorId] = Curator({
            wallet: msg.sender,
            erc8004IdentityId: erc8004IdentityId,
            recommendedFee: DEFAULT_FEE, // Start at 0.30%
            performanceFeeBps: performanceFeeBps,
            lastRebalanceBlock: 0,
            active: true
        });

        curatorByWallet[msg.sender] = curatorId;

        // If this is the first curator, make them active automatically.
        if (activeCuratorId == 0) {
            activeCuratorId = curatorId;
        }

        emit CuratorRegistered(curatorId, msg.sender, erc8004IdentityId);
    }

    // ═════════════════════════════════════════════════════════════════════
    //                      INTERNAL HELPERS
    // ═════════════════════════════════════════════════════════════════════

    /// @dev Reverts if the hook's idle token balances exceed caller-specified maximums.
    ///      Extracted to avoid stack-too-deep in rebalance().
    function _checkIdleBalance(uint256 maxIdleToken0, uint256 maxIdleToken1) internal view {
        if (IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this)) > maxIdleToken0) {
            revert CuratedVaultHook_ExcessiveIdleBalance();
        }
        if (IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this)) > maxIdleToken1) {
            revert CuratedVaultHook_ExcessiveIdleBalance();
        }
    }

    /// @dev Calls poolManager.unlock() with encoded callback data.
    ///      Returns the actual token amounts consumed/returned.
    function _modifyPoolLiquidity(int24 tickLower, int24 tickUpper, int256 liquidityDelta)
        internal
        returns (int256 amount0, int256 amount1)
    {
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    action: liquidityDelta > 0 ? CallbackAction.ADD_LIQUIDITY : CallbackAction.REMOVE_LIQUIDITY,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    liquidityDelta: liquidityDelta,
                    sender: msg.sender
                })
            )
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
            IERC20(Currency.unwrap(currency)).safeTransfer(address(poolManager), amount);
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

    function _getLiquidityForAmount0(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint256 amount0)
        internal
        pure
        returns (uint128)
    {
        uint256 intermediate = uint256(sqrtPriceAX96) * uint256(sqrtPriceBX96) / (1 << 96);
        return uint128(amount0 * intermediate / (uint256(sqrtPriceBX96) - uint256(sqrtPriceAX96)));
    }

    function _getLiquidityForAmount1(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, uint256 amount1)
        internal
        pure
        returns (uint128)
    {
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
        amount0 = IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
        amount1 = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
    }

    /// @notice Token addresses in the pool (sorted).
    function getTokens() external view returns (address token0, address token1) {
        token0 = Currency.unwrap(poolKey.currency0);
        token1 = Currency.unwrap(poolKey.currency1);
    }

    /// @notice Get full curator data.
    function getCurator(uint256 curatorId) external view returns (Curator memory) {
        return curators[curatorId];
    }

    /// @notice Get the active curator's current recommended fee.
    function getCurrentFee() external view returns (uint24) {
        if (activeCuratorId == 0) return DEFAULT_FEE;
        return curators[activeCuratorId].recommendedFee;
    }

    /// @notice Get vault performance metrics.
    function getPerformanceMetrics()
        external
        view
        returns (
            uint256 volume,
            uint256 feeRevenue,
            uint256 swapCount,
            uint128 liquidity,
            int24 tickLower,
            int24 tickUpper,
            uint24 currentFee
        )
    {
        volume = cumulativeVolume;
        feeRevenue = cumulativeFeeRevenue;
        swapCount = totalSwaps;
        liquidity = totalLiquidity;
        tickLower = currentTickLower;
        tickUpper = currentTickUpper;
        currentFee = activeCuratorId != 0 ? curators[activeCuratorId].recommendedFee : DEFAULT_FEE;
    }
}
