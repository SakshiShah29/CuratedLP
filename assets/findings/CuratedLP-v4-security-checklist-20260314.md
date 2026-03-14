# v4 Hook Security Audit — CuratedVaultHook

> Audit performed using the v4 Hook Security Foundations guide.

---

## Scope

| | |
|---|---|
| **File** | `src/CuratedVaultHook.sol` |
| **Framework** | v4 Hook Security Foundations checklist |
| **Date** | 2026-03-14 |

---

## v4 Security Checklist Results

| # | Check | Status | Notes |
|---|---|---|---|
| 1 | Hook callbacks verify `msg.sender == poolManager` | ✅ PASS | `unlockCallback` checks `msg.sender != address(poolManager)`. `_beforeAddLiquidity`/`_beforeRemoveLiquidity` correctly use `sender` param. `_beforeSwap`/`_afterSwap` are `internal override` — called by BaseHook which verifies caller. |
| 2 | Router allowlisting | N/A | Hook doesn't need user identity from the router `sender` param |
| 3 | No unbounded loops | ✅ PASS | Only `_sqrt()` with deterministic convergence |
| 4 | Reentrancy guards on external calls | ❌ FAIL | No `nonReentrant` modifier. `deposit()` refunds tokens (Step 5, lines 330–331) before minting shares (Step 6, lines 348–349) — CEI violation enables share inflation via ERC-777 callbacks. Cross-function reentrancy also possible between `rebalance()` and `deposit()`. |
| 5 | Delta accounting sums to zero | ✅ PASS | Uses actual `callerDelta` from `modifyLiquidity()`, settles via `_settleDelta` correctly with sync→transfer→settle pattern |
| 6 | Fee-on-transfer tokens handled | ❌ FAIL | `deposit()` uses `amount0Desired` directly after `transferFrom` without measuring actual received balance |
| 7 | No hardcoded addresses | ❌ FAIL | `IDENTITY_REGISTRY` and `REPUTATION_REGISTRY` are `constant` with literal Base Sepolia addresses — breaks on any other chain |
| 8 | Slippage parameters respected | ⚠️ PARTIAL | `deposit()`/`withdraw()` have `amount0Min`/`amount1Min` but no `minShares` output guard, no `deadline` parameter, and `rebalance()` has zero slippage protection |
| 9 | No sensitive data stored on-chain | ✅ PASS | No passwords, keys, or PII stored |
| 10 | Upgrade mechanisms secured | N/A | No proxy or upgrade pattern used |
| 11 | `beforeSwapReturnDelta` justified if enabled | ✅ PASS | Set to `false` — not enabled |
| 12 | Fuzz testing completed | ⚠️ PARTIAL | Test file exists but no fuzz tests observed |
| 13 | Invariant testing completed | ❌ FAIL | No invariant tests present |

---

## Risk Score: 17 / 33 → HIGH

| Category | Points | Rationale |
|---|---|---|
| **Permissions** | 7 | `beforeAddLiquidity` (MEDIUM) + `beforeRemoveLiquidity` (HIGH) + `beforeSwap` (HIGH) + `afterSwap` (MEDIUM). No `returnDelta` flags enabled. |
| **External Calls** | 4 | ERC-20 `transferFrom`/`transfer`, `poolManager.unlock()`, `IDENTITY_REGISTRY.ownerOf()`, `REPUTATION_REGISTRY` write |
| **State Complexity** | 4 | Curator mappings, `totalLiquidity`, tick range, cumulative fee tracking, share accounting |
| **Upgrade Mechanism** | 0 | None |
| **Token Handling** | 2 | Bare `IERC20Minimal` without `SafeERC20`; no fee-on-transfer handling |

**Recommendation: Professional audit required** (score 13–20 threshold).

---

## Findings Summary

| # | Severity | Title | Location |
|---|---|---|---|
| 1 | 🔴 HIGH [90] | Reentrancy in `deposit()` — CEI violation enables share inflation | `deposit()` lines 330–331 vs 348–349 |
| 2 | 🟠 HIGH [85] | First-caller auto-activation lets attacker seize curator role | `registerCurator()` lines 588–590 |
| 3 | 🟠 HIGH [85] | `rebalance()` exposes all liquidity to sandwich attack | `rebalance()` lines 528–534 |
| 4 | 🟠 HIGH [85] | Missing `deadline` enables stale transaction execution | `deposit()` / `withdraw()` signatures |
| 5 | 🟠 HIGH [85] | Cross-function reentrancy between `rebalance()` and `deposit()` | `rebalance()` Steps 1–3 |
| 6 | 🟠 HIGH [85] | Missing `minShares` allows silent share dilution on deposit | `deposit()` line 349 |
| 7 | 🟠 HIGH [85] | Unsafe ERC-20 transfers — missing `SafeERC20` | All token transfers |
| 8 | 🟡 MEDIUM [82] | Fee-on-transfer token accounting mismatch | `deposit()` lines 292–293 |
| 9 | 🟡 MEDIUM [80] | Spot-price sandwich attack skews share issuance | `deposit()` line 299 |
| 10 | 🟡 MEDIUM [80] | `totalLiquidity` reset after rebalance dilutes existing LPs | `rebalance()` line 534 |
| 11 | 🟡 MEDIUM [80] | Hardcoded registry addresses break non-Sepolia deployment | Lines 84–86 |
| 12 | 🔵 LOW [65] | Precision loss in `_getLiquidityForAmount0()` | Line 673 |
| 13 | 🔵 LOW [60] | Blacklisted recipient permanently locks vault funds | `withdraw()` lines 400–401 |

---

## Priority Fixes

### 1. Add reentrancy guard + fix CEI order (Findings 1, 5)

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

     // Move Step 6 (state + mint) BEFORE Step 5 (refund):
     totalLiquidity += liquidity;
     vaultShares.mint(msg.sender, shares);
     // THEN refund unused tokens
```

### 2. Gate active curator via owner (Finding 2)

```diff
-    if (activeCuratorId == 0) {
-        activeCuratorId = curatorId;
-    }
+    // Removed auto-activation — owner calls setActiveCurator() explicitly
+
+address public owner;
+function setActiveCurator(uint256 curatorId) external {
+    require(msg.sender == owner, "not owner");
+    require(curators[curatorId].active, "not active");
+    activeCuratorId = curatorId;
+}
```

### 3. Add slippage to `rebalance()` (Finding 3)

```diff
-function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee) external {
+function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee, uint128 minLiquidityOut) external {
     ...
+    require(newLiquidity >= minLiquidityOut, "rebalance: slippage");
```

### 4. Replace `IERC20Minimal` with `SafeERC20` (Finding 7)

```diff
-import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
+import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
+import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
```

### 5. Add `minShares` + `deadline` to `deposit()`/`withdraw()` (Findings 4, 6)

```diff
-function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min)
+function deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 minShares, uint256 deadline)
     external returns (uint256 shares)
 {
+    require(block.timestamp <= deadline, "expired");
     ...
+    if (shares < minShares) revert CuratedVaultHook_SlippageExceeded();
```

### 6. Make registry addresses `immutable` (Finding 11)

```diff
-IIdentityRegistry public constant IDENTITY_REGISTRY = IIdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
-IReputationRegistry public constant REPUTATION_REGISTRY = IReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);
+IIdentityRegistry public immutable IDENTITY_REGISTRY;
+IReputationRegistry public immutable REPUTATION_REGISTRY;

-constructor(IPoolManager _poolManager) BaseHook(_poolManager) {
+constructor(IPoolManager _poolManager, IIdentityRegistry _identityRegistry, IReputationRegistry _reputationRegistry) BaseHook(_poolManager) {
     vaultShares = new VaultShares(address(this));
+    IDENTITY_REGISTRY = _identityRegistry;
+    REPUTATION_REGISTRY = _reputationRegistry;
 }
```

---

> Full detailed audit report: `assets/findings/CuratedLP-pashov-ai-audit-report-20260314-000000.md`
