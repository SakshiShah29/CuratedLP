# 🔐 Security Review — CuratedVaultHook

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)

---

## Scope

|                                  |                          |
| -------------------------------- | ------------------------ |
| **Mode**                         | single file              |
| **Files reviewed**               | `src/CuratedVaultHook.sol` |
| **Confidence threshold (1-100)** | 75                       |

---

## Findings

| # | Confidence | Title |
|---|---|---|
| 1 | [90] | Reentrancy in `deposit()` Enables Share Inflation via Refund Hook |
| 2 | [85] | First-Caller Auto-Activation Lets Attacker Seize Active Curator Role |
| 3 | [85] | `rebalance()` Exposes All Vault Liquidity to Sandwich Attack |
| 4 | [85] | Missing Deadline Parameter Enables Stale Transaction Execution |
| 5 | [85] | Cross-Function Reentrancy Between `rebalance()` and `deposit()` |
| 6 | [85] | Missing `minShares` Parameter Allows Silent Share Dilution |
| 7 | [85] | Unsafe ERC-20 Transfers — Missing `SafeERC20` |
| 8 | [82] | Fee-on-Transfer Token Accounting Mismatch Drains Hook Balance |
| 9 | [80] | Spot-Price Sandwich Attack Skews Share Issuance on Deposit |
| 10 | [80] | `totalLiquidity` Reset After Rebalance Dilutes Existing LP Shares |
| 11 | [80] | Hardcoded Registry Addresses Break Deployment on Non-Sepolia Chains |
| | | **Below Confidence Threshold** |
| 12 | [65] | Precision Loss in `_getLiquidityForAmount0()` Due to Intermediate Division |
| 13 | [60] | Blacklisted Token Recipient Permanently Locks Their Vault Funds |

---

[90] **1. Reentrancy in `deposit()` Enables Share Inflation via Refund Hook**

`CuratedVaultHook.deposit` · Confidence: 90

**Description**
`deposit()` sends the unused-token refunds (Step 5) before updating `totalLiquidity` and minting shares (Step 6) with no reentrancy guard; an ERC-777 token's `tokensReceived` callback re-enters `deposit()` at a moment when `totalLiquidity` has been incremented but `vaultShares.totalSupply()` has not, causing the share formula `liquidity * currentTotalShares / totalLiquidity` to yield inflated shares for the attacker at the expense of existing LPs.

**Fix**

```diff
+    bool private _locked;
+    modifier nonReentrant() {
+        require(!_locked, "reentrant");
+        _locked = true;
+        _;
+        _locked = false;
+    }

-    function deposit(...) external returns (uint256 shares) {
+    function deposit(...) external nonReentrant returns (uint256 shares) {

-    function withdraw(...) external returns (uint256 amount0, uint256 amount1) {
+    function withdraw(...) external nonReentrant returns (uint256 amount0, uint256 amount1) {

-    function rebalance(...) external {
+    function rebalance(...) external nonReentrant {

     // Also move Step 6 (state update + mint) BEFORE Step 5 (refund transfers):
-    // Step 5: Refund unused tokens
-    if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
-    if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
-    // Step 6: Compute and mint shares
     totalLiquidity += liquidity;
     vaultShares.mint(msg.sender, shares);
+    // Step 5 (now after state update): Refund unused tokens
+    if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
+    if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
```

---

[85] **2. First-Caller Auto-Activation Lets Attacker Seize Active Curator Role**

`CuratedVaultHook.registerCurator` · Confidence: 85

**Description**
`registerCurator()` automatically promotes the first registrant to `activeCuratorId` with no owner or governance approval, so any attacker who acquires any valid ERC-8004 identity NFT and front-runs the legitimate curator becomes the permanent active curator with unrestricted power to call `rebalance()` — after just 30 blocks, they can redirect all vault liquidity to an adversarial or out-of-range tick, bricking LP withdrawals or causing maximum impermanent loss.

**Fix**

```diff
-        if (activeCuratorId == 0) {
-            activeCuratorId = curatorId;
-        }
+        // Do NOT auto-activate. Owner must call setActiveCurator() explicitly.
+        emit CuratorRegistered(curatorId, msg.sender, erc8004IdentityId);
     }
+
+    address public owner;
+    function setActiveCurator(uint256 curatorId) external {
+        require(msg.sender == owner, "not owner");
+        require(curators[curatorId].active, "inactive curator");
+        activeCuratorId = curatorId;
+    }
```

---

[85] **3. `rebalance()` Exposes All Vault Liquidity to Sandwich Attack Without Slippage Protection**

`CuratedVaultHook.rebalance` · Confidence: 85

**Description**
`rebalance()` atomically removes ALL vault liquidity and re-adds it using live `balanceOf` with no minimum output assertion; a sandwich attacker front-runs the rebalance to push the pool price, causing the re-deposited liquidity to receive a worse token ratio at the new range, then profits by reversing the price movement — all LP depositors bear the loss. Compounded by Finding 2: an attacker who seized the curator role can weaponize this deliberately.

**Fix**

```diff
-    function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee) external {
+    function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee, uint128 minLiquidityOut) external {
         ...
         if (newLiquidity > 0) {
             _modifyPoolLiquidity(newTickLower, newTickUpper, int256(uint256(newLiquidity)));
+            require(newLiquidity >= minLiquidityOut, "rebalance: slippage");
             totalLiquidity = newLiquidity;
```

---

[85] **4. Missing Deadline Parameter Enables Stale Transaction Execution**

`CuratedVaultHook.deposit` · `CuratedVaultHook.withdraw` · Confidence: 85

**Description**
Neither `deposit()` nor `withdraw()` accepts a `deadline` parameter; a transaction that stalls in the mempool can be mined in a future block after a curator rebalance has changed the active tick range, resulting in the user's liquidity being added to or removed from a completely different range than intended — even if the `amount0Min`/`amount1Min` slippage checks pass, the position economics may be highly unfavorable.

**Fix**

```diff
-    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min)
+    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
         external returns (uint256 shares)
     {
+        require(block.timestamp <= deadline, "deposit: expired");

-    function withdraw(uint256 sharesToBurn, uint256 amount0Min, uint256 amount1Min)
+    function withdraw(uint256 sharesToBurn, uint256 amount0Min, uint256 amount1Min, uint256 deadline)
         external returns (uint256 amount0, uint256 amount1)
     {
+        require(block.timestamp <= deadline, "withdraw: expired");
```

---

[85] **5. Cross-Function Reentrancy Between `rebalance()` and `deposit()`**

`CuratedVaultHook.rebalance` · Confidence: 85

**Description**
`rebalance()` updates `currentTickLower`/`currentTickUpper` (Step 2) before re-adding liquidity and updating `totalLiquidity` (Step 3) with no reentrancy lock; a token callback triggered during the Step 1 `poolManager.unlock()` window can invoke `deposit()`, which computes liquidity against the new tick range but calculates shares against the still-old `totalLiquidity` — minting shares worth more than the deposited capital at the expense of existing holders. Compounds directly with Finding 1.

**Fix**

Apply the `nonReentrant` modifier to all three external state-changing functions as shown in Finding 1's fix.

---

[85] **6. Missing `minShares` Parameter Allows Silent Share Dilution**

`CuratedVaultHook.deposit` · Confidence: 85

**Description**
`deposit()` enforces slippage only on token amounts (`amount0Min`, `amount1Min`) but provides no `minShares` output guard; an attacker who front-runs the deposit with a large deposit of their own inflates `totalLiquidity`, causing the victim's `shares = liquidity * totalShares / totalLiquidity` to compute near-zero shares — the transaction does not revert and the victim loses most of their deposited capital.

**Fix**

```diff
-    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min)
+    function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 minShares)
         external returns (uint256 shares)
     {
         ...
         vaultShares.mint(msg.sender, shares);
+        if (shares < minShares) revert CuratedVaultHook_SlippageExceeded();
```

---

[85] **7. Unsafe ERC-20 Transfers — Missing `SafeERC20` Wrapper**

`CuratedVaultHook.deposit` · `CuratedVaultHook.withdraw` · `CuratedVaultHook._settleDelta` · Confidence: 85

**Description**
All token interactions use bare `IERC20Minimal.transfer()` / `transferFrom()` without `SafeERC20`; tokens like USDT that return no bool cause an ABI-decode revert on every call, while tokens that return `false` on failure (non-reverting) silently continue — in `deposit()` a silent `transferFrom` failure mints shares against tokens never received, and in `withdraw()` a silent `transfer` failure burns shares while delivering no tokens.

**Fix**

```diff
-import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
+import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
+import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
+using SafeERC20 for IERC20;

-token0.transferFrom(msg.sender, address(this), amount0Desired);
+IERC20(Currency.unwrap(poolKey.currency0)).safeTransferFrom(msg.sender, address(this), amount0Desired);

-token0.transfer(msg.sender, amount0);
+IERC20(Currency.unwrap(poolKey.currency0)).safeTransfer(msg.sender, amount0);
```

---

[82] **8. Fee-on-Transfer Token Accounting Mismatch Drains Hook Balance**

`CuratedVaultHook.deposit` · Confidence: 82

**Description**
`deposit()` pulls `amount0Desired` from the user then uses that same value for all downstream liquidity calculations and the `_settleDelta` transfer to the PoolManager; with fee-on-transfer tokens the hook receives `amount0Desired − fee` but attempts to settle the full `amount0Desired`, either reverting (DoS) or, if the hook holds any residual prior balance, silently consuming other depositors' funds to cover the shortfall.

**Fix**

```diff
+    uint256 before0 = IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this));
+    uint256 before1 = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this));
     if (amount0Desired > 0) token0.transferFrom(msg.sender, address(this), amount0Desired);
     if (amount1Desired > 0) token1.transferFrom(msg.sender, address(this), amount1Desired);
+    amount0Desired = IERC20(Currency.unwrap(poolKey.currency0)).balanceOf(address(this)) - before0;
+    amount1Desired = IERC20(Currency.unwrap(poolKey.currency1)).balanceOf(address(this)) - before1;
```

---

[80] **9. Spot-Price Sandwich Attack Skews Share Issuance on Deposit**

`CuratedVaultHook.deposit` · Confidence: 80

**Description**
`deposit()` reads `sqrtPriceX96` directly from `poolManager.getSlot0()` (the spot price) to compute the `liquidity` used for share issuance; an attacker can flash-swap the pool to an extreme price before the deposit, causing `_getLiquidityForAmounts()` to return a drastically lower liquidity value for the same token amounts, minting far fewer shares than the deposited capital deserves.

**Fix**

```diff
 (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
+// Caller supplies acceptable price bounds to guard against manipulation:
+if (minSqrtPriceX96 > 0 && sqrtPriceX96 < minSqrtPriceX96) revert CuratedVaultHook_SlippageExceeded();
+if (maxSqrtPriceX96 > 0 && sqrtPriceX96 > maxSqrtPriceX96) revert CuratedVaultHook_SlippageExceeded();
 liquidity = _getLiquidityForAmounts(sqrtPriceX96, currentTickLower, currentTickUpper, amount0Desired, amount1Desired);
```

---

[80] **10. `totalLiquidity` Reset After Rebalance Dilutes Existing LP Shares**

`CuratedVaultHook.rebalance` · Confidence: 80

**Description**
After rebalancing, `totalLiquidity` is overwritten with `newLiquidity` (which is lower when the tick range narrows or price moves away) while `vaultShares.totalSupply()` remains unchanged; subsequent depositors receive shares calculated against the lower `totalLiquidity` denominator, inflating their share count relative to existing holders whose shares now represent proportionally less of the pool.

**Fix**

Denominate vault shares in token-equivalent value (NAV) rather than raw liquidity units, so that a reduction in `totalLiquidity` from a rebalance is reflected proportionally in *all* shares rather than distorting the share/liquidity ratio only for future depositors.

---

[80] **11. Hardcoded Registry Addresses Break Deployment on Non-Sepolia Chains**

`CuratedVaultHook` (constants `IDENTITY_REGISTRY`, `REPUTATION_REGISTRY`) · Confidence: 80

**Description**
`IDENTITY_REGISTRY` and `REPUTATION_REGISTRY` are hardcoded as `constant` with literal Base Sepolia addresses; if the contract is deployed on any other chain those addresses hold a different or nonexistent contract, causing `registerCurator()` to either pass the identity check with any ID (if the address holds an unrelated token) or revert permanently — leaving the vault permanently without an active curator and all depositor funds irrecoverable without withdrawal.

**Fix**

```diff
-    IIdentityRegistry public constant IDENTITY_REGISTRY = IIdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
-    IReputationRegistry public constant REPUTATION_REGISTRY = IReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);
+    IIdentityRegistry public immutable IDENTITY_REGISTRY;
+    IReputationRegistry public immutable REPUTATION_REGISTRY;

-    constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
+    constructor(IPoolManager _poolManager, IIdentityRegistry _identityRegistry, IReputationRegistry _reputationRegistry) BaseHook(_poolManager) {
         vaultShares = new VaultShares(address(this));
+        IDENTITY_REGISTRY = _identityRegistry;
+        REPUTATION_REGISTRY = _reputationRegistry;
     }
```

---

**Below Confidence Threshold**

---

[65] **12. Precision Loss in `_getLiquidityForAmount0()` Due to Intermediate Division**

`CuratedVaultHook._getLiquidityForAmount0` · Confidence: 65

**Description**
`intermediate = sqrtPriceAX96 * sqrtPriceBX96 / (1 << 96)` truncates before being multiplied by `amount0`, slightly underestimating the depositor's liquidity contribution and causing them to receive marginally fewer shares per deposit than their true contribution warrants.

---

[60] **13. Blacklisted Token Recipient Permanently Locks Their Vault Funds**

`CuratedVaultHook.withdraw` · Confidence: 60

**Description**
`withdraw()` uses a push-transfer pattern (`token.transfer(msg.sender, amount)`) with no fallback; if the vault operates on a blacklistable token (USDC, USDT) and a depositor is subsequently blacklisted, every withdrawal attempt reverts and their vault shares become permanently irrecoverable.
