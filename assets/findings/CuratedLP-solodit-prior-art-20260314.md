# Solodit Prior Art — CuratedVaultHook

> Real-world audit findings from Solodit that map directly to vulnerabilities in `CuratedVaultHook.sol`.
> Cross-referenced against `CuratedLP-pashov-ai-audit-report-20260314-000000.md`.

---

## Summary Table

| Solodit Finding | Severity | Firm | CuratedVaultHook Audit Finding | Impact |
|---|---|---|---|---|
| Missing slippage on remove liquidity | MEDIUM | Cyfrin | Finding #3, #6 | LP funds lost to sandwich on `rebalance()` and `withdraw()` |
| Missing `afterSwapReturnDelta` permission | MEDIUM | Cyfrin | Latent (not in audit report) | Future `afterSwap` fee logic will brick all swaps |
| Dynamic fee poke — arbitrary caller | MEDIUM | OpenZeppelin | Finding #2 | Attacker seizes curator role, manipulates fees |
| Reentrancy via LP transfers (v4 PoolManager) | LOW | Cyfrin | Finding #1, #5 | Share inflation, stolen LP deposits |

---

## Finding 1 — Missing Slippage Protection When Removing Liquidity

**Severity:** MEDIUM
**Firm:** Cyfrin
**Protocol:** Paladin Valkyrie
**Finders:** Draiakoo, Giovanni Di Siena (2)
→ https://solodit.cyfrin.io/issues/missing-slippage-protection-when-removing-liquidity-cyfrin-none-paladin-valkyrie-markdown

### What the finding says

When a user removes liquidity from a concentrated range, the token amounts returned depend on where the current price sits relative to the range. If an attacker front-runs the removal by moving the price out of range, the user receives entirely single-sided liquidity — all token0 and zero token1 (or vice versa) — instead of the expected balanced split. The Paladin hooks had no `amount0Min`/`amount1Min` parameters on `removeLiquidity()`.

**Proof of Concept (from audit):**
```solidity
// Attacker front-runs with a large swap to push price below tickLower
IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
    zeroForOne: true,
    amountSpecified: -1000 ether,
    sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(lowerTick - 60)
});
router.swap(key2, params, settings, ZERO_BYTES);

// Victim removes liquidity — receives ALL token0, ZERO token1
BalanceDelta delta = multiRange.removeLiquidity(removeLiquidityParams);
// Token 0 received: 205337358362575417542
// Token 1 received: 0
```

**Paladin fix:**
```diff
struct RemoveLiquidityParams {
    PoolKey key;
    RangeKey range;
    uint256 liquidity;
    uint256 deadline;
+   uint256 token0Min;
+   uint256 token1Min;
}

+if (uint128(delta.amount0()) < params.token0Min || uint128(delta.amount1()) < params.token1Min) revert();
```

### How it applies to CuratedVaultHook

`CuratedVaultHook.withdraw()` does include `amount0Min`/`amount1Min`, but `rebalance()` removes **all vault liquidity** with zero slippage protection. This is more severe than the Paladin case:

- Paladin: only one user's position is affected per attack
- CuratedVaultHook: an attacker sandwiches `rebalance()` to affect **all depositors simultaneously**

Additionally, audit Finding #6 identified that `deposit()` has no `minShares` guard — an attacker who front-runs with a large deposit inflates `totalLiquidity`, causing the victim to receive near-zero shares for their full token deposit.

**Fix for CuratedVaultHook:**
```diff
-function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee) external {
+function rebalance(int24 newTickLower, int24 newTickUpper, uint24 newFee, uint128 minLiquidityOut) external {
     ...
+    require(newLiquidity >= minLiquidityOut, "rebalance: slippage");
```

---

## Finding 2 — Missing `afterSwapReturnDelta` Permission Causes All Swaps to Revert

**Severity:** MEDIUM
**Firm:** Cyfrin
**Protocol:** Sorella L2 Angstrom
**Finders:** Giovanni Di Siena, Alexzoid, 100proof (3)
→ https://solodit.cyfrin.io/issues/all-swaps-will-revert-if-the-dynamic-protocol-fee-is-enabled-since-hook-configsol-does-not-encode-the-afterswapreturndelta-permission-cyfrin-none-sorella-l2-angstrom-markdown

### What the finding says

The Angstrom hook had `afterSwap: true` but `afterSwapReturnDelta: false`. When the owner enabled a dynamic protocol fee, the hook's `afterSwap()` attempted to return a non-zero delta to collect the fee. However, because `afterSwapReturnDelta` was not set in the hook permissions, the PoolManager's `callHookWithReturnDelta` called it with `parseReturn = false` and discarded the returned delta:

```solidity
function callHookWithReturnDelta(IHooks self, bytes memory data, bool parseReturn) internal returns (int256) {
    bytes memory result = callHook(self, data);
    // If this hook wasn't meant to return something, default to 0 delta
    if (!parseReturn) return 0;  // Delta silently dropped
    ...
}
```

The unaccounted delta caused `CurrencyNotSettled()` to revert on every swap.

### How it applies to CuratedVaultHook

`CuratedVaultHook` currently has:
```solidity
afterSwap: true,
afterSwapReturnDelta: false,  // ← latent footgun
```

`_afterSwap` currently returns `(selector, 0)` — safe for now. However, the README explicitly describes `claimPerformanceFee()` and the curator earning fees. If anyone adds performance fee collection inside `_afterSwap` without first enabling `afterSwapReturnDelta: true`, **every swap will revert** — bricking the entire pool.

This is a latent vulnerability not caught in the existing audit report.

**Fix:**
```diff
// In getHookPermissions():
afterSwap: true,
-afterSwapReturnDelta: false,
+// WARNING: If _afterSwap ever returns a non-zero delta, this MUST be set to true
+// or CurrencyNotSettled() will revert every swap.
+afterSwapReturnDelta: false,
```

If performance fees are ever collected in `afterSwap`:
```diff
+afterSwapReturnDelta: true,
```

---

## Finding 3 — Dynamic Fee Can Be Manipulated by Arbitrary Caller

**Severity:** MEDIUM
**Firm:** OpenZeppelin
**Protocol:** Uniswap Hooks Library Milestone 1 Audit
**Finders:** OpenZeppelin (1)
→ https://solodit.cyfrin.io/issues/basedynamicfee-hook-can-be-poked-arbitrarily-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

### What the finding says

The `BaseDynamicFee` hook exposed an external `poke()` function that allowed anyone to update the pool's LP fee at any time. If `_getFee()` depended on external state (e.g. a Uniswap V3 pool balance), an attacker could:

1. Flash loan → deposit into V3 pool → call `poke()` → fee drops on V4 pool
2. Swap at artificially low fee
3. Withdraw from V3 pool and repay flash loan

OpenZeppelin fixed this by making `poke()` `internal` and adding access control documentation.

### How it applies to CuratedVaultHook

The attack surface is structurally identical — the curator's `recommendedFee` is returned on every `_beforeSwap()` via:

```solidity
function _beforeSwap(...) internal view override returns (bytes4, BeforeSwapDelta, uint24) {
    uint24 fee = curators[activeCuratorId].recommendedFee;
    return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
}
```

And the `registerCurator()` function auto-activates the first caller:

```solidity
if (activeCuratorId == 0) {
    activeCuratorId = curatorId;  // ← attacker front-runs this
}
```

**Attack path:**
1. Attacker acquires any valid ERC-8004 identity NFT
2. Front-runs the legitimate curator's `registerCurator()` transaction
3. Becomes `activeCuratorId`
4. Sets `recommendedFee = 1` (minimum) → all swappers pay near-zero fees, destroying LP revenue
5. Or sets `recommendedFee = MAX_FEE (100000 = 10%)` → all swappers pay 10%, draining value from users

This maps to audit **Finding #2 [85]**.

**Fix:**
```diff
-if (activeCuratorId == 0) {
-    activeCuratorId = curatorId;
-}

+address public owner;

+function setActiveCurator(uint256 curatorId) external {
+    require(msg.sender == owner, "not owner");
+    require(curators[curatorId].active, "inactive curator");
+    activeCuratorId = curatorId;
+}
```

---

## Finding 4 — Reentrancy via External Calls During LP Token Transfers

**Severity:** LOW
**Firm:** Cyfrin
**Protocol:** Vii
**Finders:** Giovanni Di Siena, Stalin (2)
→ https://solodit.cyfrin.io/issues/unsafe-external-calls-made-during-proportional-lp-fee-transfers-can-be-used-to-reenter-wrapper-contracts-cyfrin-none-vii-markdown

### What the finding says

The Vii `UniswapV4Wrapper.unwrap()` called `_unwrap()` (which transfers tokens from the PoolManager) **before** burning the caller's ERC-6909 balance. For pools containing native ETH or ERC-777 tokens, the transfer triggers a `receive()`/`tokensReceived()` callback on the recipient, creating a reentrancy window where the attacker can re-enter `unwrap()` with the old (inflated) balance still intact.

```solidity
function unwrap(address from, uint256 tokenId, address to, uint256 amount, bytes calldata extraData)
    external callThroughEVC
{
    _unwrap(to, tokenId, amount, extraData);  // ← token transfer fires callback here
    _burnFrom(from, tokenId, amount);          // ← balance update happens AFTER
}
```

The PoC demonstrated the attacker could enter `eVault.borrow()` inside the callback with the pre-burn balance as collateral, bypassing the EVC's checks.

**Vii fix:** Moved all token transfers to after the ERC-6909 burn.

### How it applies to CuratedVaultHook

This is the production v4 hook confirmation of audit **Finding #1 [90]** and **Finding #5 [85]**.

`CuratedVaultHook.deposit()` has the same CEI violation — refund transfers (Step 5) fire before share minting (Step 6):

```solidity
// Step 5: Refund unused tokens — ERC-777 tokensReceived fires here
if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);

// Step 6: State update + mint — AFTER the external call
totalLiquidity += liquidity;
vaultShares.mint(msg.sender, shares);  // ← attacker already re-entered here with old totalSupply
```

When the attacker re-enters `deposit()` at the refund step, `vaultShares.totalSupply()` is still the pre-mint value, so the share formula `liquidity * currentTotalShares / totalLiquidity` assigns more shares than deserved.

The Vii finding also confirms that even access control modifiers (like `callThroughEVC`) do **not** protect against this — reentrancy guards applied at the wrong level are bypassed when checks are deferred within the execution context.

**Fix for CuratedVaultHook:**
```diff
+bool private _locked;
+modifier nonReentrant() {
+    require(!_locked, "reentrant");
+    _locked = true;
+    _;
+    _locked = false;
+}

-function deposit(...) external returns (uint256 shares) {
+function deposit(...) external nonReentrant returns (uint256 shares) {

-function withdraw(...) external returns (uint256 amount0, uint256 amount1) {
+function withdraw(...) external nonReentrant returns (uint256 amount0, uint256 amount1) {

-function rebalance(...) external {
+function rebalance(...) external nonReentrant {

 // Also fix CEI order in deposit():
-// Step 5: Refund (fires external call)
-if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
-if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
-// Step 6: State update + mint
 totalLiquidity += liquidity;
 vaultShares.mint(msg.sender, shares);
+// Step 5 (now after state update): Refund unused tokens
+if (amount0Desired > amount0Used) token0.transfer(msg.sender, amount0Desired - amount0Used);
+if (amount1Desired > amount1Used) token1.transfer(msg.sender, amount1Desired - amount1Used);
```

---

## All 23 Solodit Findings (Full List)

### HIGH

1. **Chat points manipulation by adding liquidity to custom pools via SVFHook**
   Spearbit (Semantic Layer) · Finders: 3
   → https://solodit.cyfrin.io/issues/chat-points-manipulation-by-adding-liquidity-to-custom-pools-via-svfhook-contract-spearbit-none-semantic-layer-pdf

2. **Hooks Do Not Support Native Tokens**
   OpenZeppelin (Uniswap Hooks Library) · Finders: 1
   → https://solodit.cyfrin.io/issues/hooks-do-not-support-native-tokens-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

3. **JIT Liquidity Penalty Can Be Bypassed**
   OpenZeppelin (OpenZeppelin Uniswap Hooks v1.1.0) · Finders: 1
   → https://solodit.cyfrin.io/issues/jit-liquidity-penalty-can-be-bypassed-openzeppelin-none-openzeppelin-uniswap-hooks-v110-rc-1-audit-markdown

4. **Rewards stolen when `IncentivizedERC20` tokens are recursively provided as liquidity**
   Cyfrin (Paladin Valkyrie) · Finders: 2
   → https://solodit.cyfrin.io/issues/rewards-can-be-stolen-when-incentivizederc20-tokens-are-recursively-provided-as-liquidity-cyfrin-none-paladin-valkyrie-markdown

5. **Attackers steal rewards by making duplicate pools for listed token**
   Sherlock (Super DCA Liquidity Network) · Finders: 24
   → https://solodit.cyfrin.io/issues/h-2-attackers-will-steal-rewards-from-legitimate-pools-by-making-duplicate-pools-for-listed-token-sherlock-super-dca-liquidity-network-git

6. **Donation fees are sandwichable in one transaction**
   Sherlock (Flayer) · Finders: 6
   → https://solodit.cyfrin.io/issues/h-20-donation-fees-are-sandwichable-in-one-transaction-sherlock-flayer-git

### MEDIUM

7. **ERC-20 tokens without `symbol()` incompatible despite being accepted by Uniswap v4**
   Cyfrin (Paladin Valkyrie) · Finders: 2
   → https://solodit.cyfrin.io/issues/erc-20-tokens-that-do-not-implement-symbol-are-incompatible-despite-being-accepted-by-uniswap-v4-cyfrin-none-paladin-valkyrie-markdown

8. **Donations can be made directly to the Uniswap v4 pool due to missing overrides**
   Cyfrin (Paladin Valkyrie) · Finders: 2
   → https://solodit.cyfrin.io/issues/donations-can-be-made-directly-to-the-uniswap-v4-pool-due-to-missing-overrides-cyfrin-none-paladin-valkyrie-markdown

9. **Quotes can be frontrun by replaying them through the router**
   Spearbit (Uniswap Foundation) · Finders: 4
   → https://solodit.cyfrin.io/issues/quotes-can-be-frontrun-by-replaying-them-through-the-router-spearbit-none-uniswap-foundation-pdf

10. **Missing slippage protection when removing liquidity** ⭐ *Directly applicable*
    Cyfrin (Paladin Valkyrie) · Finders: 2
    → https://solodit.cyfrin.io/issues/missing-slippage-protection-when-removing-liquidity-cyfrin-none-paladin-valkyrie-markdown

11. **All swaps revert if dynamic protocol fee enabled — missing `afterSwapReturnDelta` permission** ⭐ *Directly applicable*
    Cyfrin (Sorella L2 Angstrom) · Finders: 3
    → https://solodit.cyfrin.io/issues/all-swaps-will-revert-if-the-dynamic-protocol-fee-is-enabled-since-hook-configsol-does-not-encode-the-afterswapreturndelta-permission-cyfrin-none-sorella-l2-angstrom-markdown

12. **`IncentivizedERC20` hardcoded to 18 decimals**
    Cyfrin (Paladin Valkyrie) · Finders: 2
    → https://solodit.cyfrin.io/issues/incentivizederc20-should-not-be-hardcoded-to-18-decimals-cyfrin-none-paladin-valkyrie-markdown

13. **BaseDynamicFee Hook Can Be Poked Arbitrarily** ⭐ *Directly applicable*
    OpenZeppelin (Uniswap Hooks Library) · Finders: 1
    → https://solodit.cyfrin.io/issues/basedynamicfee-hook-can-be-poked-arbitrarily-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

14. **Misleading Comments**
    OpenZeppelin (Uniswap Hooks Library) · Finders: 1
    → https://solodit.cyfrin.io/issues/misleading-comments-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

### LOW

15. **Similar-looking pool IDs brute-forced through PoolKey hooks fields**
    Trail of Bits (Uniswap v4 Core) · Finders: 7
    → https://solodit.cyfrin.io/issues/similar-looking-pool-ids-can-be-brute-forced-through-the-poolkey-hooks-fields-trailofbits-none-uniswap-v4-core-pdf

16. **Unsafe external calls during LP fee transfers enable reentrancy** ⭐ *Directly applicable*
    Cyfrin (Vii) · Finders: 2
    → https://solodit.cyfrin.io/issues/unsafe-external-calls-made-during-proportional-lp-fee-transfers-can-be-used-to-reenter-wrapper-contracts-cyfrin-none-vii-markdown

17. **Hooklet validation recommended upon deploying new Bunni tokens**
    Cyfrin (Bunni) · Finders: 3
    → https://solodit.cyfrin.io/issues/hooklet-validation-is-recommended-upon-deploying-new-bunni-tokens-cyfrin-none-bunni-markdown

18. **Pool initialization permanently blocked by 48-bit hash collisions**
    Cantina (Panoptic) · Finders: 1
    → https://solodit.cyfrin.io/issues/pool-initialization-can-be-permanently-blocked-by-weaponising-48-bit-hash-collisions-cantina-none-panoptic-pdf

19. **Slippage parameter `tickLimitLow/High` insufficient for Mint/Burn options**
    Cantina (Panoptic) · Finders: 1
    → https://solodit.cyfrin.io/issues/slippage-parameter-ticklimitlowticklimithigh-is-not-enough-for-mintburn-options-in-panopticpool-cantina-none-panoptic-pdf

20. **`rewardGrowthOutsideX128` not correctly initialized in `updateAfterLiquidityAdd`**
    Cyfrin (Sorella L2 Angstrom) · Finders: 3
    → https://solodit.cyfrin.io/issues/rewardgrowthoutsidex128-is-not-correctly-initialized-in-poolrewardsupdateafterliquidityadd-cyfrin-none-sorella-l2-angstrom-markdown

21. **Incorrect return value in `getAssetModule`**
    Pashov Audit Group (Arcadia-October) · Finders: 1
    → https://solodit.cyfrin.io/issues/l-01-incorrect-return-value-in-getassetmodule-pashov-audit-group-none-arcadia-october-markdown

22. **Redundant `virtual` function modifier**
    OpenZeppelin (Uniswap Hooks Library) · Finders: 1
    → https://solodit.cyfrin.io/issues/redundant-virtual-function-modifier-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

23. **Insufficient documentation**
    OpenZeppelin (Uniswap Hooks Library) · Finders: 1
    → https://solodit.cyfrin.io/issues/insufficient-documentation-openzeppelin-none-uniswap-hooks-library-milestone-1-audit-markdown

---

> ⭐ = Directly applicable to `CuratedVaultHook.sol`
>
> Related reports: `CuratedLP-pashov-ai-audit-report-20260314-000000.md` · `CuratedLP-v4-security-checklist-20260314.md`
