# PHASE 1: VAULT CORE — COMPLETE IMPLEMENTATION GUIDE

## What You Are Building

By the end of this phase, you will have three deployed contracts on Base Sepolia:

1. **CuratedVaultHook.sol** — The Uniswap v4 hook that owns and manages all liquidity. Exposes `deposit()`, `withdraw()`, and blocks direct LP additions/removals.
2. **VaultShares.sol** — An ERC-20 token that represents proportional ownership of the vault's assets. Only the hook can mint/burn.
3. **Deploy.s.sol** — Foundry script that mines the hook address, deploys both contracts, and initializes the pool.

Plus a complete Foundry test suite that proves deposit → swap → withdraw works end-to-end.

---

## PREREQUISITES (Must Be Done Before Starting)

### 1. Clone and set up v4-template

```bash
git clone https://github.com/uniswapfoundation/v4-template.git curatedlp
cd curatedlp
forge install
forge test  # Verify Counter example passes
```

### 2. Install OpenZeppelin uniswap-hooks library

This gives us `BaseHook`, `BaseCustomAccounting`, and `CurrencySettler` — all audited.

```bash
forge install OpenZeppelin/uniswap-hooks
```

Add to `remappings.txt`:
```
@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/src/
@openzeppelin/contracts/=lib/uniswap-hooks/lib/openzeppelin-contracts/contracts/
```

### 3. Install OpenZeppelin Contracts (for ERC20)

```bash
forge install OpenZeppelin/openzeppelin-contracts
```

### 4. Verify remappings.txt

Your final `remappings.txt` should contain at minimum:
```
v4-core/=lib/v4-core/
v4-periphery/=lib/v4-periphery/
@openzeppelin/uniswap-hooks/=lib/uniswap-hooks/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
forge-std/=lib/forge-std/src/
solmate/=lib/solmate/
```

### 5. Set up .env

```bash
# Base Sepolia RPC
BASE_SEPOLIA_RPC=https://sepolia.base.org
# Your deployer private key (NEVER commit this)
PRIVATE_KEY=0x...
# Etherscan API key for verification (optional)
ETHERSCAN_API_KEY=...
```

### 6. foundry.toml

Ensure your `foundry.toml` has:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.26"
evm_version = "cancun"
ffi = true

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC}"
```

The `evm_version = "cancun"` is REQUIRED — Uniswap v4 uses transient storage (EIP-1153) which is only available in Cancun.

---

## FILE 1: VaultShares.sol

This is the simplest contract. It is a standard ERC-20 token where only the hook contract (set as `owner` at deployment) can mint and burn shares.

**Create `src/VaultShares.sol`:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title VaultShares
/// @notice ERC-20 token representing proportional ownership of the CuratedLP vault.
/// @dev Only the owner (the CuratedVaultHook contract) can mint and burn shares.
contract VaultShares is ERC20 {
    address public immutable owner;

    error OnlyOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    /// @param _owner The CuratedVaultHook contract address.
    constructor(address _owner) ERC20("CuratedLP Vault Shares", "cvLP") {
        owner = _owner;
    }

    /// @notice Mint shares to a depositor. Only callable by the hook.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn shares from a withdrawer. Only callable by the hook.
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
```

**Why a separate contract instead of making the hook itself ERC-20?**

The hook's address is determined by its permission flags (the last 14 bits). If we made the hook inherit ERC-20, any change to the ERC-20 constructor or code would change the bytecode, which changes the CREATE2-mined address, which could invalidate the permission flags. Keeping the share token separate decouples the hook address from the token implementation.

---

## FILE 2: CuratedVaultHook.sol

This is the main contract. It inherits from OpenZeppelin's `BaseHook` and implements `IUnlockCallback` to interact with the PoolManager.

**Create `src/CuratedVaultHook.sol`:**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// ─── v4-core imports ─────────────────────────────────────────────────────────
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

// ─── v4-core types ───────────────────────────────────────────────────────────
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";

// ─── Hook base ───────────────────────────────────────────────────────────────
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {BaseHook} from "v4-periphery/src/utils/BaseHook.sol";

// ─── Our contracts ───────────────────────────────────────────────────────────
import {VaultShares} from "./VaultShares.sol";

/// @title CuratedVaultHook
/// @notice Uniswap v4 hook that manages a concentrated liquidity vault.
///         LPs deposit tokens and receive vault shares. A curator agent
///         manages the tick range and fee. All liquidity is owned by this hook.
contract CuratedVaultHook is BaseHook, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // ─── Errors ──────────────────────────────────────────────────────────
    error PoolNotInitialized();
    error DirectLiquidityNotAllowed();
    error OnlyHookCanModifyLiquidity();
    error ZeroShares();
    error InsufficientShares();
    error ZeroDeposit();
    error CallbackNotFromPoolManager();
    error SlippageExceeded();

    // ─── Events ──────────────────────────────────────────────────────────
    event Deposited(address indexed depositor, uint256 amount0, uint256 amount1, uint256 shares);
    event Withdrawn(address indexed withdrawer, uint256 shares, uint256 amount0, uint256 amount1);
    event LiquidityModified(int24 tickLower, int24 tickUpper, int128 liquidityDelta);

    // ─── Constants ───────────────────────────────────────────────────────
    /// @dev Dead shares minted to address(1) on first deposit to prevent
    ///      share inflation attacks. See: ERC-4626 inflation attack.
    uint256 public constant MINIMUM_SHARES = 1000;

    // ─── Immutables ──────────────────────────────────────────────────────
    VaultShares public immutable vaultShares;

    // ─── Pool state ──────────────────────────────────────────────────────
    PoolKey public poolKey;
    PoolId public poolId;
    bool public poolInitialized;

    // ─── Position state ──────────────────────────────────────────────────
    /// @dev The current concentrated liquidity position boundaries.
    int24 public currentTickLower;
    int24 public currentTickUpper;

    /// @dev Total liquidity units owned by this hook in the PoolManager.
    uint128 public totalLiquidity;

    /// @dev Salt for the hook's position in the PoolManager.
    ///      v4 uses salt to distinguish positions owned by the same address.
    bytes32 public constant POSITION_SALT = bytes32(uint256(0xCDAB));

    // ─── Callback action enum ────────────────────────────────────────────
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
            beforeSwap: true,               // Dynamic fee (Phase 2)
            afterSwap: true,                // Fee tracking (Phase 2)
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
            revert DirectLiquidityNotAllowed();
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
            revert DirectLiquidityNotAllowed();
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
        if (!poolInitialized) revert PoolNotInitialized();
        if (amount0Desired == 0 && amount1Desired == 0) revert ZeroDeposit();

        // ── Step 1: Transfer tokens from depositor to this hook ──────
        // The hook holds the tokens. It will use them to settle deltas
        // with the PoolManager during the unlock callback.
        IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
        IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));

        if (amount0Desired > 0) {
            token0.transferFrom(msg.sender, address(this), amount0Desired);
        }
        if (amount1Desired > 0) {
            token1.transferFrom(msg.sender, address(this), amount1Desired);
        }

        // ── Step 2: Calculate liquidity from deposited amounts ───────
        // We use the current pool sqrtPrice and our tick range to compute
        // how much liquidity these tokens can provide.
        (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);

        uint128 liquidity = _getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(currentTickLower),
            TickMath.getSqrtPriceAtTick(currentTickUpper),
            amount0Desired,
            amount1Desired
        );

        if (liquidity == 0) revert ZeroDeposit();

        // ── Step 3: Add liquidity to the pool via unlock callback ────
        // This calls poolManager.unlock() → _unlockCallback() →
        //   poolManager.modifyLiquidity() → settle deltas.
        // The actual amounts used may differ from desired due to rounding.
        (int256 delta0, int256 delta1) = _modifyPoolLiquidity(
            currentTickLower,
            currentTickUpper,
            int256(uint256(liquidity))
        );

        // delta0 and delta1 are NEGATIVE when we owe tokens to the pool.
        uint256 amount0Used = uint256(-delta0);
        uint256 amount1Used = uint256(-delta1);

        // ── Step 4: Slippage check ──────────────────────────────────
        if (amount0Used < amount0Min || amount1Used < amount1Min) {
            revert SlippageExceeded();
        }

        // ── Step 5: Refund unused tokens ────────────────────────────
        if (amount0Desired > amount0Used) {
            token0.transfer(msg.sender, amount0Desired - amount0Used);
        }
        if (amount1Desired > amount1Used) {
            token1.transfer(msg.sender, amount1Desired - amount1Used);
        }

        // ── Step 6: Compute and mint shares ─────────────────────────
        uint256 currentTotalShares = vaultShares.totalSupply();

        if (currentTotalShares == 0) {
            // First deposit: use geometric mean to set initial share price.
            // Mint MINIMUM_SHARES to dead address to prevent inflation attack.
            shares = _sqrt(amount0Used * amount1Used);
            if (shares <= MINIMUM_SHARES) revert ZeroShares();
            vaultShares.mint(address(1), MINIMUM_SHARES);
            shares -= MINIMUM_SHARES;
        } else {
            // Subsequent deposits: shares proportional to liquidity added.
            // This ensures fair pricing regardless of current tick position.
            shares = (uint256(liquidity) * currentTotalShares) / uint256(totalLiquidity);
        }

        if (shares == 0) revert ZeroShares();

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
        if (!poolInitialized) revert PoolNotInitialized();
        if (sharesToBurn == 0) revert InsufficientShares();
        if (vaultShares.balanceOf(msg.sender) < sharesToBurn) revert InsufficientShares();

        // ── Step 1: Calculate proportional liquidity to remove ───────
        uint256 currentTotalShares = vaultShares.totalSupply();
        uint128 liquidityToRemove = uint128(
            (uint256(totalLiquidity) * sharesToBurn) / currentTotalShares
        );

        if (liquidityToRemove == 0) revert ZeroShares();

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
            revert SlippageExceeded();
        }

        // ── Step 4: Update state ────────────────────────────────────
        totalLiquidity -= liquidityToRemove;
        vaultShares.burn(msg.sender, sharesToBurn);

        // ── Step 5: Transfer tokens to withdrawer ───────────────────
        IERC20 token0 = IERC20(Currency.unwrap(poolKey.currency0));
        IERC20 token1 = IERC20(Currency.unwrap(poolKey.currency1));

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
            revert CallbackNotFromPoolManager();
        }

        CallbackData memory cbData = abi.decode(data, (CallbackData));

        // Perform the liquidity modification
        (BalanceDelta callerDelta, ) = poolManager.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({
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
            IERC20(Currency.unwrap(currency)).transfer(
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
        amount0 = IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
        amount1 = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
    }

    /// @notice Token addresses in the pool (sorted).
    function getTokens() external view returns (address token0, address token1) {
        token0 = Currency.unwrap(poolKey.currency0);
        token1 = Currency.unwrap(poolKey.currency1);
    }
}
```

---

## CRITICAL DETAILS — READ THIS BEFORE PROCEEDING

### 1. The unlock/callback pattern explained

When the hook wants to add or remove liquidity, it CANNOT just call `poolManager.modifyLiquidity()` directly. The PoolManager requires all operations to happen inside an `unlock()` callback. The sequence is:

```
deposit() called by user
  └─► hook calls poolManager.unlock(encodedData)
        └─► PoolManager calls back to hook.unlockCallback(encodedData)
              └─► hook calls poolManager.modifyLiquidity(...)
              └─► hook settles all token deltas (transfer/take)
              └─► callback returns
        └─► PoolManager checks NonzeroDeltaCount == 0
        └─► If any deltas unsettled, ENTIRE transaction reverts
```

If the hook fails to settle even 1 wei of delta, the PoolManager reverts everything.

### 2. Delta settlement explained

When adding liquidity:
- `callerDelta.amount0()` returns a **negative** number (e.g., -1000000) meaning "you owe 1,000,000 units of token0 to the pool"
- To settle: call `poolManager.sync(currency)`, then `token.transfer(address(poolManager), amount)`, then `poolManager.settle()`

When removing liquidity:
- `callerDelta.amount0()` returns a **positive** number (e.g., 500000) meaning "the pool owes you 500,000 units of token0"
- To take: call `poolManager.take(currency, recipient, amount)`

### 3. The `sender` in beforeAddLiquidity

When our hook calls `poolManager.modifyLiquidity()` inside the unlock callback, the PoolManager triggers `beforeAddLiquidity(sender, ...)`. The `sender` parameter is `address(this)` (the hook itself) because the hook is the one calling `modifyLiquidity`. This is how our access control works — we check `sender != address(this)` to block everyone else.

### 4. Position salt

Uniswap v4 uses a `salt` parameter to distinguish between multiple positions owned by the same address at the same tick range. Our hook always uses `POSITION_SALT = bytes32(uint256(0xCDAB))` for its single managed position. This is important because if the salt is wrong, the hook would create a NEW position instead of modifying the existing one.

### 5. Share inflation attack protection

The first depositor could try a classic ERC-4626 inflation attack: deposit 1 wei, then donate a large amount directly to inflate the share price, causing subsequent depositors to receive 0 shares. We prevent this by:
- Minting `MINIMUM_SHARES` (1000) to the dead address `address(1)` on first deposit
- Requiring `shares > MINIMUM_SHARES` on first deposit

---

## FILE 3: Deploy.s.sol

**Create `script/Deploy.s.sol`:**

```solidity
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
import {HookMiner} from "../test/utils/HookMiner.sol";

contract DeployScript is Script {
    // ─── Base Sepolia addresses ──────────────────────────────────────
    // Uniswap v4 PoolManager on Base Sepolia
    // IMPORTANT: Verify this address on Base Sepolia before running.
    // The mainnet address is 0x498581ff718922c3f8e6a244956af099b2652b2b.
    // The Sepolia address may differ — check docs.uniswap.org/contracts/v4/deployments.
    address constant POOL_MANAGER = 0x498581ff718922c3f8e6a244956af099b2652b2b;

    // For Base Sepolia, use test tokens (deploy MockERC20s or use faucet tokens)
    // These are placeholders — replace with your actual test token addresses.
    address constant TOKEN_0 = address(0); // REPLACE: lower address token
    address constant TOKEN_1 = address(0); // REPLACE: higher address token

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // ── Step 1: Compute hook flags ──────────────────────────────
        uint160 flags = uint160(
            Hooks.AFTER_INITIALIZE_FLAG |
            Hooks.BEFORE_ADD_LIQUIDITY_FLAG |
            Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG |
            Hooks.BEFORE_SWAP_FLAG |
            Hooks.AFTER_SWAP_FLAG
        );

        // ── Step 2: Mine the hook address ───────────────────────────
        // HookMiner finds a CREATE2 salt where the deployed address
        // has the correct permission flags in its last 14 bits.
        bytes memory creationCode = type(CuratedVaultHook).creationCode;
        bytes memory constructorArgs = abi.encode(IPoolManager(POOL_MANAGER));

        (address hookAddress, bytes32 salt) = HookMiner.find(
            vm.addr(deployerPrivateKey),  // deployer
            flags,
            creationCode,
            constructorArgs
        );

        console.log("Hook address:", hookAddress);
        console.log("Salt:", vm.toString(salt));

        // ── Step 3: Deploy ──────────────────────────────────────────
        vm.startBroadcast(deployerPrivateKey);

        CuratedVaultHook hook = new CuratedVaultHook{salt: salt}(
            IPoolManager(POOL_MANAGER)
        );

        require(address(hook) == hookAddress, "Hook address mismatch");
        console.log("Hook deployed at:", address(hook));
        console.log("VaultShares at:", address(hook.vaultShares()));

        // ── Step 4: Initialize the pool ─────────────────────────────
        // token0 MUST have a lower address than token1.
        require(TOKEN_0 < TOKEN_1, "Token0 must be lower address");
        require(TOKEN_0 != address(0) && TOKEN_1 != address(0), "Set token addresses");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(TOKEN_0),
            currency1: Currency.wrap(TOKEN_1),
            fee: 0x800000,  // DYNAMIC_FEE_FLAG — enables dynamic fees
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        // Initialize at current market price.
        // For wstETH/USDC at ~$3000: sqrtPriceX96 ≈ sqrt(3000 * 1e6 / 1e18) * 2^96
        // Adjust this based on actual token decimals and current price.
        uint160 sqrtPriceX96 = 4339505291508368600;  // placeholder — calculate properly

        IPoolManager(POOL_MANAGER).initialize(key, sqrtPriceX96);
        console.log("Pool initialized");

        vm.stopBroadcast();
    }
}
```

---

## FILE 4: CuratedVaultHook.t.sol — Full Test Suite

**Create `test/CuratedVaultHook.t.sol`:**

```solidity
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
    PoolKey key;
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

        vm.expectRevert(CuratedVaultHook.DirectLiquidityNotAllowed.selector);
        lpRouter.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
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
            IPoolManager.SwapParams({
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
        vm.expectRevert(CuratedVaultHook.ZeroDeposit.selector);
        hook.deposit(0, 0, 0, 0);
    }

    // ─── Test: Withdraw more than balance reverts ────────────────────

    function test_withdrawMoreThanBalanceReverts() public {
        vm.prank(alice);
        vm.expectRevert(CuratedVaultHook.InsufficientShares.selector);
        hook.withdraw(1 ether, 0, 0);
    }
}
```

---

## HOW TO RUN

### Run tests locally:
```bash
forge test -vvv
```

### Run a specific test:
```bash
forge test --match-test test_depositWithdrawRoundtrip -vvvv
```

### Deploy to Base Sepolia:

First, update `Deploy.s.sol` with your actual test token addresses (or deploy MockERC20s first). Then:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify
```

---

## WHAT TO VERIFY BEFORE MOVING TO PHASE 2

Run these checks manually:

1. **`forge test` passes all 7 tests** — deposit, withdraw, roundtrip, two depositors, swap, zero revert, insufficient revert
2. **Direct liquidity blocked** — the `test_directAddLiquidityReverts` test proves that nobody can bypass the vault
3. **Shares are non-zero** — first depositor gets shares > MINIMUM_SHARES
4. **Roundtrip works** — deposit → withdraw returns ~100% of tokens (minus rounding dust)
5. **Swaps work** — after deposit, swaps route through the vault's liquidity and produce output
6. **VaultShares.owner() == hook address** — only the hook can mint/burn

If all 6 checks pass, Phase 1 is complete. Move to Phase 2: Curator System and Dynamic Fees.

---

## KNOWN EDGE CASES AND HOW THEY'RE HANDLED

| Edge Case | How Handled |
|---|---|
| First deposit inflation attack | Dead shares (1000) minted to address(1) |
| Depositor sends 0 amounts | Reverts with `ZeroDeposit` |
| Rounding in modifyLiquidity | We use actual deltas, never pre-calculated amounts |
| Price moves between deposit call and execution | Slippage params (`amount0Min`, `amount1Min`) protect depositor |
| Someone calls modifyLiquidity directly | beforeAddLiquidity/beforeRemoveLiquidity revert unless sender is hook |
| Pool not yet initialized | deposit/withdraw revert with `PoolNotInitialized` |
| Withdraw more shares than owned | Reverts with `InsufficientShares` |
| Position salt collision | We use a constant unique salt (`0xCDAB`) |
| Fee accrual during liquidity modification | Handled by v4 core — fees accrue to the hook's position and are captured on next modification |
