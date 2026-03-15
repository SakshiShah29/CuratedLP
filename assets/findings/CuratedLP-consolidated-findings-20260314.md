# CuratedVaultHook — Consolidated Security Findings

> Findings common to **at least 2 of 3** independent audit sources:
> - **[A]** `CuratedLP-pashov-ai-audit-report-20260314-000000.md` — AI vector-scan audit (13 findings)
> - **[B]** `CuratedLP-v4-security-checklist-20260314.md` — v4 Hook Security Foundations checklist (13 findings)
> - **[C]** `CuratedLP-solodit-prior-art-20260314.md` — Real-world Solodit prior art (4 directly applicable findings)
>
> All 13 findings below appear in sources **[A] + [B]**. Those marked ⭐ are additionally confirmed by real-world audits in **[C]**.

---

## Summary

| # | Severity | Title | Sources | Location |
|---|---|---|---|---|
| 1 | 🔴 HIGH [90] | Reentrancy in `deposit()` — CEI violation | A · B · C ⭐ | `deposit()` lines 330–349 |
| 2 | 🟠 HIGH [85] | First-caller auto-activation lets attacker seize curator | A · B · C ⭐ | `registerCurator()` lines 588–590 |
| 3 | 🟠 HIGH [85] | `rebalance()` exposes all liquidity to sandwich attack | A · B · C ⭐ | `rebalance()` lines 494–538 |
| 4 | 🟠 HIGH [85] | Missing `deadline` enables stale transaction execution | A · B | `deposit()` / `withdraw()` |
| 5 | 🟠 HIGH [85] | Cross-function reentrancy between `rebalance()` and `deposit()` | A · B · C ⭐ | `rebalance()` Steps 1–3 |
| 6 | 🟠 HIGH [85] | Missing `minShares` allows silent share dilution | A · B · C ⭐ | `deposit()` line 349 |
| 7 | 🟠 HIGH [85] | Unsafe ERC-20 transfers — missing `SafeERC20` | A · B | All token transfers |
| 8 | 🟡 MEDIUM [82] | Fee-on-transfer token accounting mismatch | A · B | `deposit()` lines 292–293 |
| 9 | 🟡 MEDIUM [80] | Spot-price sandwich skews share issuance on deposit | A · B | `deposit()` line 299 |
| 10 | 🟡 MEDIUM [80] | `totalLiquidity` reset after rebalance dilutes existing LPs | A · B | `rebalance()` line 534 |
| 11 | 🟡 MEDIUM [80] | Hardcoded registry addresses break non-Sepolia deployment | A · B | Lines 84–86 |
| 12 | 🔵 LOW [65] | Precision loss in `_getLiquidityForAmount0()` | A · B | Line 673 |
| 13 | 🔵 LOW [60] | Blacklisted recipient permanently locks vault funds | A · B | `withdraw()` lines 400–401 |

---

## HIGH Findings

---

### 1. ⭐ Reentrancy in `deposit()` — CEI Violation Enables Share Inflation

**Sources:** [A] Finding #1 [90] · [B] Checklist item #4 FAIL · [C] Solodit Vii prior art
**Location:** `CuratedVaultHook.deposit` · lines 330–331 (refund) vs 348–349 (state update)
**Solodit reference:** https://solodit.cyfrin.io/issues/unsafe-external-calls-made-during-proportional-lp-fee-transfers-can-be-used-to-reenter-wrapper-contracts-cyfrin-none-vii-markdown

**Description**
`deposit()` sends refunds (Step 5, lines 330–331) before updating `totalLiquidity` and minting shares (Step 6, lines 348–349) with no reentrancy guard. An ERC-777 token's `tokensReceived` callback re-enters `deposit()` while `vaultShares.totalSupply()` is still the pre-mint value, causing `shares = liquidity * currentTotalShares / totalLiquidity` to yield inflated shares for the attacker at the expense of existing LPs. Real-world confirmation: the Cyfrin/Vii audit found this exact pattern in `UniswapV4Wrapper.unwrap()` and demonstrated it allows undercollateralized borrow exploits.

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

     // Fix CEI — move state update + mint BEFORE refund transfers:
     totalLiquidity += liquidity;
     vaultShares.mint(msg.sender, shares);
+    // Refunds after state is settled:
     if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
     if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
```

---

### 2. ⭐ First-Caller Auto-Activation Lets Attacker Seize Active Curator Role ⚠️ DISCUSSION PENDING

**Sources:** [A] Finding #2 [85] · [B] Checklist item #8 PARTIAL · [C] Solodit OZ `BaseDynamicFee` prior art
**Location:** `CuratedVaultHook.registerCurator` · lines 588–590
**Solodit reference:** https://solodit.cyfrin.io/issues/basedynamicfee-hook-can-be-poked-arbitrarily-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

**Description**
`registerCurator()` auto-promotes the first registrant to `activeCuratorId` with no owner approval. An attacker who acquires any ERC-8004 identity NFT and front-runs the legitimate curator becomes the permanent active curator. After 30 blocks they can call `rebalance()` to redirect all vault liquidity to an adversarial tick or set `recommendedFee = MAX_FEE (10%)` to drain LP revenue. Structurally identical to the OZ `BaseDynamicFee` finding where anyone could call `poke()` to manipulate fees via flash loan.

**Fix**
```diff
-        if (activeCuratorId == 0) {
-            activeCuratorId = curatorId;
-        }
+        // Do NOT auto-activate. Owner must explicitly call setActiveCurator().

+    address public owner;
+    function setActiveCurator(uint256 curatorId) external {
+        require(msg.sender == owner, "not owner");
+        require(curators[curatorId].active, "inactive curator");
+        activeCuratorId = curatorId;
+    }
```

---

### 3. ⭐ `rebalance()` Exposes All Vault Liquidity to Sandwich Attack

**Sources:** [A] Finding #3 [85] · [B] Checklist item #8 PARTIAL · [C] Solodit Paladin Valkyrie prior art
**Location:** `CuratedVaultHook.rebalance` · lines 494–538
**Solodit reference:** https://solodit.cyfrin.io/issues/missing-slippage-protection-when-removing-liquidity-cyfrin-none-paladin-valkyrie-markdown

**Description**
`rebalance()` atomically removes **all** vault liquidity and re-adds it with no minimum output assertion. A sandwich attacker front-runs the rebalance to push the pool price, causing the re-deposited liquidity to land at a worse token ratio at the new range. The Paladin/Cyfrin audit proved this with a PoC: after a front-run swap, `removeLiquidity` returned 100% token0 and 0 token1. For CuratedVaultHook this is worse than Paladin — here all depositors' funds are affected in a single `rebalance()` call, not just one user's position. Compounds with Finding #2: an attacker who seized the curator role can trigger this deliberately.

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

### 4. Missing `deadline` Parameter Enables Stale Transaction Execution

**Sources:** [A] Finding #4 [85] · [B] Checklist item #8 PARTIAL
**Location:** `CuratedVaultHook.deposit` · `CuratedVaultHook.withdraw`

**Description**
Neither `deposit()` nor `withdraw()` accepts a `deadline` parameter. A transaction stalled in the mempool can be mined in a future block after a curator rebalance has changed the active tick range, adding or removing liquidity in a completely different range than intended. Even if `amount0Min`/`amount1Min` pass, the position economics can be highly unfavorable.

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

### 5. ⭐ Cross-Function Reentrancy Between `rebalance()` and `deposit()`

**Sources:** [A] Finding #5 [85] · [B] Checklist item #4 FAIL · [C] Solodit Vii prior art
**Location:** `CuratedVaultHook.rebalance` · Steps 1–3
**Solodit reference:** https://solodit.cyfrin.io/issues/unsafe-external-calls-made-during-proportional-lp-fee-transfers-can-be-used-to-reenter-wrapper-contracts-cyfrin-none-vii-markdown

**Description**
`rebalance()` updates `currentTickLower`/`currentTickUpper` (Step 2) before re-adding liquidity and updating `totalLiquidity` (Step 3) with no reentrancy lock. A token callback triggered during the Step 1 `poolManager.unlock()` window can invoke `deposit()`, which computes liquidity against the new tick range but calculates shares against the still-old `totalLiquidity`, minting shares worth more than deposited capital. Compounds with Finding #1.

**Fix**
Apply the `nonReentrant` modifier to all three external state-changing functions as shown in Finding #1's fix.

---

### 6. ⭐ Missing `minShares` Parameter Allows Silent Share Dilution

**Sources:** [A] Finding #6 [85] · [B] Checklist item #8 PARTIAL · [C] Solodit Paladin Valkyrie prior art
**Location:** `CuratedVaultHook.deposit` · line 349
**Solodit reference:** https://solodit.cyfrin.io/issues/missing-slippage-protection-when-removing-liquidity-cyfrin-none-paladin-valkyrie-markdown

**Description**
`deposit()` enforces slippage on token amounts (`amount0Min`, `amount1Min`) but has no `minShares` output guard. An attacker front-runs the deposit with a large deposit of their own, inflating `totalLiquidity`. The victim's `shares = liquidity * totalShares / totalLiquidity` computes near-zero shares — the transaction does not revert and the victim loses most of their deposited capital. The Paladin Valkyrie audit confirmed this exact attack vector with a passing PoC test.

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

### 7. Unsafe ERC-20 Transfers — Missing `SafeERC20` Wrapper

**Sources:** [A] Finding #7 [85] · [B] Checklist item #6 FAIL (token handling, 2/4 points)
**Location:** `CuratedVaultHook.deposit` · `CuratedVaultHook.withdraw` · `CuratedVaultHook._settleDelta`

**Description**
All token interactions use bare `IERC20Minimal.transfer()` / `transferFrom()` without `SafeERC20`. Tokens like USDT return no bool, causing ABI-decode reverts on every call. Tokens that return `false` on failure silently continue — in `deposit()` a silent `transferFrom` failure mints shares against tokens never received; in `withdraw()` a silent `transfer` failure burns shares while delivering no tokens.

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

## MEDIUM Findings

---

### 8. Fee-on-Transfer Token Accounting Mismatch Drains Hook Balance

**Sources:** [A] Finding #8 [82] · [B] Checklist item #6 FAIL
**Location:** `CuratedVaultHook.deposit` · lines 292–293

**Description**
`deposit()` uses `amount0Desired` directly after `transferFrom` without measuring the actual received balance. With fee-on-transfer tokens the hook receives `amount0Desired − fee` but attempts to settle the full `amount0Desired` with the PoolManager — either reverting (DoS) or, if the hook holds prior balance, silently consuming other depositors' funds to cover the shortfall.

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

### 9. Spot-Price Sandwich Attack Skews Share Issuance on Deposit

**Sources:** [A] Finding #9 [80] · [B] Checklist item #8 PARTIAL
**Location:** `CuratedVaultHook.deposit` · line 299

**Description**
`deposit()` reads `sqrtPriceX96` directly from `poolManager.getSlot0()` (spot price) to compute `liquidity` for share issuance. An attacker can flash-swap the pool to an extreme price before the deposit, causing `_getLiquidityForAmounts()` to return a drastically lower liquidity value for the same token amounts, minting far fewer shares than the deposited capital deserves.

**Fix**
```diff
 (uint160 sqrtPriceX96,,,) = poolManager.getSlot0(poolId);
+if (minSqrtPriceX96 > 0 && sqrtPriceX96 < minSqrtPriceX96) revert CuratedVaultHook_SlippageExceeded();
+if (maxSqrtPriceX96 > 0 && sqrtPriceX96 > maxSqrtPriceX96) revert CuratedVaultHook_SlippageExceeded();
 liquidity = _getLiquidityForAmounts(sqrtPriceX96, ...);
```

---

### 10. `totalLiquidity` Reset After Rebalance Dilutes Existing LP Shares

**Sources:** [A] Finding #10 [80] · [B] Checklist item #8 PARTIAL
**Location:** `CuratedVaultHook.rebalance` · line 534

**Description**
After rebalancing, `totalLiquidity` is overwritten with `newLiquidity` (which is lower when the tick range narrows or price moves away from range) while `vaultShares.totalSupply()` remains unchanged. Subsequent depositors receive shares calculated against the lower `totalLiquidity` denominator, inflating their share count relative to existing holders whose shares now represent proportionally less of the pool.

**Fix**
Denominate vault shares in token-equivalent value (NAV) rather than raw liquidity units, so a reduction in `totalLiquidity` from a rebalance is reflected proportionally across all shares rather than distorting the share/liquidity ratio only for future depositors.

---

### 11. Hardcoded Registry Addresses Break Deployment on Non-Sepolia Chains

**Sources:** [A] Finding #11 [80] · [B] Checklist item #7 FAIL
**Location:** `CuratedVaultHook` · lines 84–86

**Description**
`IDENTITY_REGISTRY` and `REPUTATION_REGISTRY` are hardcoded as `constant` with literal Base Sepolia addresses. On any other chain those addresses hold a different or nonexistent contract — `registerCurator()` either passes the identity check with any ID (silent security bypass) or reverts permanently, leaving the vault without an active curator and LP funds trapped with no rebalancing possible.

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

## LOW Findings

---

### 12. Precision Loss in `_getLiquidityForAmount0()` Due to Intermediate Division

**Sources:** [A] Finding #12 [65] · [B] Risk score token handling (2/4)
**Location:** `CuratedVaultHook._getLiquidityForAmount0` · line 673

**Description**
`intermediate = sqrtPriceAX96 * sqrtPriceBX96 / (1 << 96)` truncates before being multiplied by `amount0`, slightly underestimating depositor liquidity contribution and causing marginally fewer shares per deposit than the true contribution warrants.

---

### 13. Blacklisted Token Recipient Permanently Locks Vault Funds

**Sources:** [A] Finding #13 [60] · [B] Risk score token handling (2/4)
**Location:** `CuratedVaultHook.withdraw` · lines 400–401

**Description**
`withdraw()` uses a push-transfer pattern (`token.transfer(msg.sender, amount)`) with no fallback. If the vault operates on a blacklistable token (USDC, USDT) and a depositor is subsequently blacklisted, every withdrawal attempt reverts and their vault shares become permanently irrecoverable.

---

## Priority Action Plan

| Priority | Action | Findings Addressed |
|---|---|---|
| 🔴 P0 | Add `nonReentrant` to `deposit()`, `withdraw()`, `rebalance()` + fix CEI order in `deposit()` | #1, #5 |
| 🔴 P0 | Remove auto-activation in `registerCurator()`, add owner-gated `setActiveCurator()` | #2 |
| 🟠 P1 | Add `minLiquidityOut` slippage param to `rebalance()` | #3 |
| 🟠 P1 | Replace `IERC20Minimal` with `SafeERC20` across all token transfers | #7, #8 |
| 🟠 P1 | Add `minShares` + `deadline` to `deposit()` and `deadline` to `withdraw()` | #4, #6 |
| 🟡 P2 | Make registry addresses `immutable` constructor params | #11 |
| 🟡 P2 | Add `minSqrtPriceX96`/`maxSqrtPriceX96` bounds to `deposit()` | #9 |
| 🟡 P2 | Redesign share accounting to use NAV rather than raw liquidity | #10 |

---

> ⭐ = Confirmed by real-world Solodit audits (Cyfrin / OpenZeppelin)
> Sources: `CuratedLP-pashov-ai-audit-report-20260314-000000.md` · `CuratedLP-v4-security-checklist-20260314.md` · `CuratedLP-solodit-prior-art-20260314.md`
