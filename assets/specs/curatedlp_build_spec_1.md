# CURATED LP: PHASE-WISE BUILD SPECIFICATION
## AI Agent-Managed Liquidity Vault on Uniswap v4

**Project name:** CuratedLP (working title)
**Chain:** Base Sepolia (primary — all ERC-8004 contracts live here) / Base mainnet (stretch goal)
**Hackathon:** Synthesis, March 13–22, 2026
**Targeted bounties:** Venice AI, Uniswap, MetaMask, Merit/x402, Locus, Self Protocol, ENS, Olas
**Total addressable prize pool:** ~$33,250

---

## PROJECT SUMMARY

CuratedLP is a Uniswap v4 hook on Base that turns a standard liquidity pool into a managed vault. Human liquidity providers deposit tokens and choose an AI agent curator. The curator uses Venice AI's private inference to analyze market conditions and decide when to rebalance the concentrated liquidity position. The human retains full withdrawal rights at all times. The curator's permissions are scoped via MetaMask's Delegation Framework — it can rebalance but never withdraw LP funds. The curator pays for its market data and inference costs through x402 micropayments via Locus, creating a closed economic loop where the agent earns performance fees and spends on operational costs autonomously.

---

## VERIFIED CONTRACT ADDRESSES ON BASE

These are confirmed live and callable. Every address below was verified against official documentation or block explorer data.

| Contract | Address | Source |
|---|---|---|
| Uniswap v4 PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` | docs.uniswap.org/contracts/v4/deployments |
| Uniswap v4 PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` | docs.uniswap.org/contracts/v4/deployments |
| Universal Router | `0x6ff5693b99212da76ad316178a184ab56d299b43` | docs.uniswap.org/contracts/v4/deployments |
| Quoter | `0x0d5e0f971ed27fbff6c2837bf31316121532048d` | docs.uniswap.org/contracts/v4/deployments |
| StateView | `0xa3c0c9b65bad0b08107aa264b0f3db444b867a71` | docs.uniswap.org/contracts/v4/deployments |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | canonical address, same on all chains |
| wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | basescan.org verified, ~39,775 wstETH, ~457K holders |
| Chainlink wstETH/stETH Rate | `0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061` | data.chain.link (exchange rate feed, NOT USD price) |
| Chainlink ETH/USD | `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70` | data.chain.link |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | canonical Base USDC |

**Contracts on Base Sepolia (live, no mocks needed):**

| Contract | Address | Source |
|---|---|---|
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Base Sepolia — live |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Base Sepolia — live |

**Notes on other identity contracts:**
- Talent Protocol BuilderScore at `0xBBFeDA7c4d8d9Df752542b03CdD715F790B32D0B` — Live on Base mainnet but only returns scores for Builder+ members who snapshotted on-chain. For the hackathon, use the Talent Protocol REST API as the primary score source, with the on-chain contract as a bonus check.

---

## PHASE 0: FOUNDATION (Day 1 — March 13)

**Goal:** Working development environment with the v4-template scaffold, hook address mined, and pool initialized on Base Sepolia.

### Step 0.1: Clone v4-template and install dependencies

The official scaffold is at github.com/uniswapfoundation/v4-template. It ships with Foundry configured, v4-core and v4-periphery imports, and a Counter hook example.

Action items:
- Clone v4-template
- Run `forge install` to pull all dependencies
- Verify `forge test` passes on the Counter example
- Create `src/CuratedVaultHook.sol` as the main hook contract

### Step 0.2: Define hook permissions

The CuratedVaultHook needs these hook flags:

- `afterInitialize: true` — Store the pool key when the pool is created
- `beforeAddLiquidity: true` — REVERT all direct LP additions except from the hook itself. Forces deposits through the vault's deposit() function
- `beforeRemoveLiquidity: true` — REVERT all direct LP removals except from the hook itself. Forces withdrawals through the vault's withdraw() function
- `beforeSwap: true` — Return the curator's recommended dynamic fee via OVERRIDE_FEE_FLAG
- `afterSwap: true` — Track cumulative fee revenue for performance accounting

All other flags: false. No delta-returning flags needed — the hook doesn't modify swap amounts.

### Step 0.3: Mine the hook address

Hook permissions are encoded in the last 14 bits of the contract's deployment address. Use HookMiner (from v4-template's test/utils/) to find a CREATE2 salt that produces an address whose last 14 bits match the required permission flags.

The specific bit pattern needed for our flags:
- Bit 0 (beforeInitialize): 0
- Bit 1 (afterInitialize): 1
- Bit 2 (beforeAddLiquidity): 1
- Bit 3 (afterAddLiquidity): 0
- Bit 4 (beforeRemoveLiquidity): 1
- Bit 5 (afterRemoveLiquidity): 0
- Bit 6 (beforeSwap): 1
- Bit 7 (afterSwap): 1
- Bits 8-13 (delta flags): all 0

This means the last 14 bits of the address must be: `0000 0011 0100 0110` = `0x0346` (last two bytes must end in a pattern where bits 1,2,4,6,7 are set).

Use `HookMiner.find(deployer, flags, creationCode, constructorArgs)` in a test script to compute the salt. On a modern machine this takes seconds to minutes.

### Step 0.4: Deploy hook and initialize pool on fork

Write a Foundry script that:
1. Deploys CuratedVaultHook to the mined address using CREATE2
2. Calls `PoolManager.initialize()` with:
   - token0: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
   - token1: wstETH (0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452)
   - fee: DYNAMIC_FEE_FLAG (0x800000) — enables dynamic fees from the hook
   - tickSpacing: 60 (standard for volatile pairs)
   - hooks: CuratedVaultHook address
   - sqrtPriceX96: computed from current wstETH/USDC price

Run this on Base Sepolia using `forge script --rpc-url <base-sepolia-rpc> --broadcast`. All ERC-8004 contracts are live on Sepolia, so the full identity flow works end-to-end without mocks.

### Step 0.5: Get Uniswap API key

Go to developers.uniswap.org/dashboard, create an account, and generate an API key. Store it as `UNISWAP_API_KEY` in `.env`. This key is REQUIRED for the Uniswap bounty — no exceptions.

Test it works:
```
curl -X POST https://trade-api.gateway.uniswap.org/v1/quote \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -H "x-universal-router-version: 2.0" \
  -d '{"type":"EXACT_INPUT","amount":"1000000","tokenInChainId":"8453","tokenOutChainId":"8453","tokenIn":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","tokenOut":"0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452","swapper":"0x0000000000000000000000000000000000000001"}'
```

**End of Day 1 deliverable:** Hook deployed on Base Sepolia, pool initialized, Uniswap API key working, `forge test` passes.

---

## PHASE 1: VAULT CORE (Day 2 — March 14)

**Goal:** Working deposit/withdraw/share accounting. LPs can deposit tokens and receive shares. The hook manages a single concentrated liquidity position.

### Step 1.1: Vault share token

Deploy a simple ERC-20 token (VaultShares) that the hook mints to depositors. This is a separate contract, not inside the hook, because the hook's address is fixed by its permissions.

The VaultShares contract is owned by the hook. Only the hook can mint/burn shares.

### Step 1.2: Deposit function

The hook exposes `deposit(uint256 amount0Desired, uint256 amount1Desired, uint256 curatorId)`:

1. Verify the chosen curator is active
2. Transfer USDC and wstETH from the caller to the hook
3. Calculate shares: if totalShares == 0, shares = sqrt(amount0 * amount1). Otherwise, shares = min(amount0/totalAssets0, amount1/totalAssets1) * totalShares
4. Mint VaultShare tokens to the depositor
5. Call the hook's internal function to add liquidity to the pool

### Step 1.3: Adding liquidity to the pool

This is the most technically nuanced part. The hook must inherit `SafeCallback` from v4-periphery to interact with the PoolManager via the unlock pattern.

The flow:
1. Hook calls `poolManager.unlock(encodedData)`
2. PoolManager calls back to hook's `_unlockCallback(data)`
3. Inside the callback, hook calls `poolManager.modifyLiquidity(poolKey, params, "")`
4. modifyLiquidity returns `BalanceDelta` — the actual token amounts needed
5. Hook settles the deltas by calling `currency0.settle(poolManager, ...)` and `currency1.settle(poolManager, ...)`
6. Callback returns

CRITICAL: Use the actual delta amounts from modifyLiquidity for settlement, NOT pre-calculated amounts. As the Uniswap docs warn: "Never assume getAmountsForLiquidity() == modifyLiquidity() deltas" due to rounding and tick crossings.

### Step 1.4: Withdraw function

The hook exposes `withdraw(uint256 sharesToBurn)`:

1. Calculate the proportional claim: proportion = sharesToBurn / totalShares
2. Remove liquidity from the pool (same unlock/callback pattern as deposit, but with negative liquidityDelta)
3. Transfer the proportional tokens back to the caller
4. Burn the VaultShare tokens

### Step 1.5: Access control on liquidity hooks

In `_beforeAddLiquidity`: Revert unless `sender == address(this)`. This prevents anyone from adding liquidity directly to the pool, bypassing the vault.

In `_beforeRemoveLiquidity`: Revert unless `sender == address(this)`. Same principle for removals.

**End of Day 2 deliverable:** Working deposit and withdraw on Base Sepolia. Test: deposit 1000 USDC + 0.4 wstETH → receive shares → withdraw shares → receive tokens back.

---

## PHASE 2: CURATOR SYSTEM AND DYNAMIC FEES (Day 3 — March 15)

**Goal:** Curator registration with identity checks, rebalance function, and dynamic fee override in beforeSwap.

### Step 2.1: Curator registration

The hook stores a mapping of curators:
```
struct Curator {
    address wallet;
    uint256 erc8004IdentityId;       // ERC-8004 identity token ID
    uint24 recommendedFee;
    uint256 performanceFeeBps;
    uint64 lastRebalanceBlock;
    bool active;
}
mapping(uint256 => Curator) public curators;

// ERC-8004 contracts on Base Sepolia (live)
IIdentityRegistry public constant IDENTITY_REGISTRY = IIdentityRegistry(0x8004A818BFB912233c491871b3d84c89A494BD9e);
IReputationRegistry public constant REPUTATION_REGISTRY = IReputationRegistry(0x8004B663056A597Dffe9eCcC1965A193B7388713);
```

`registerCurator(uint256 performanceFeeBps, uint256 erc8004IdentityId)`:

1. Verify `IDENTITY_REGISTRY.ownerOf(erc8004IdentityId) == msg.sender` — the caller must own the ERC-8004 identity NFT. This is a real on-chain check against the live IdentityRegistry at `0x8004A818BFB912233c491871b3d84c89A494BD9e`. If the caller does not hold a registered identity, the transaction reverts.
2. Verify performanceFeeBps <= 2000 (max 20%)
3. Store the curator with the verified identity ID
4. Emit `CuratorRegistered(curatorId, msg.sender, erc8004IdentityId)`

This means curators MUST have an ERC-8004 identity to register — identity is load-bearing, not decorative. Additional identity checks (Self Agent ID, Talent Protocol) will be layered on in Phase 5 for additional bounties.

### Step 2.2: Rebalance function

`rebalance(uint256 curatorId, int24 newTickLower, int24 newTickUpper, uint24 newFee)`:

1. Verify `msg.sender == curators[curatorId].wallet`
2. Remove ALL current liquidity from the pool (via unlock/modifyLiquidity with negative delta)
3. Update stored tick range and fee
4. Re-add ALL liquidity at the new tick range (via unlock/modifyLiquidity with positive delta)
5. Update `lastRebalanceBlock`

This is atomic — if any step fails, the entire tx reverts.

### Step 2.3: Dynamic fee in beforeSwap

The pool was initialized with DYNAMIC_FEE_FLAG. In `_beforeSwap`:

1. Read the active curator's `recommendedFee` from storage (warm SLOAD, ~100 gas)
2. Return: `(BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG)`

This costs approximately 200 gas on top of the normal swap — negligible on Base.

### Step 2.4: Fee tracking in afterSwap

In `_afterSwap`, record cumulative swap volume and approximate fee revenue. Store:
```
uint256 public cumulativeVolume;
uint256 public cumulativeFeeRevenue;
```

Update after each swap based on the swap delta amounts and the current fee rate.

**End of Day 3 deliverable:** Curator registers, rebalances position, fee changes visible on swaps. Full test: register curator → deposit → swap (fee = 0.3%) → curator rebalances with new fee → swap again (fee = 0.5%).

---

## PHASE 3: METAMASK DELEGATION (Day 4 — March 16)

**Goal:** The LP depositor creates a MetaMask smart account, delegates rebalance authority to the AI curator agent with custom caveats.

### Step 3.1: Install MetaMask Smart Accounts Kit

```
npm install @metamask/delegation-toolkit viem viem/account-abstraction
```

### Step 3.2: Create delegator and delegate accounts

The depositor (human) creates a MetaMask smart account (DeleGator) using `toMetaMaskSmartAccount()` with `Implementation.Hybrid`. The curator agent creates a separate MetaMask smart account as the delegate.

### Step 3.3: Create a custom caveat enforcer

This is where we earn the MetaMask bounty. We build a **CuratedVaultCaveatEnforcer** — a Solidity contract that:

1. Checks the execution target is the CuratedVaultHook contract address
2. Checks the function selector is either `rebalance()` or `claimPerformanceFee()`
3. Checks the fee parameter in rebalance is within bounds (e.g., 100-10000 bps)
4. Checks block.number > lastRebalanceBlock + MIN_BLOCKS_BETWEEN_REBALANCES (rate limiting)

Deploy this enforcer on Base. Then create a delegation from the depositor to the curator with this caveat:

```javascript
const caveats = caveatBuilder
  .addCaveat({
    enforcer: curatedVaultCaveatEnforcerAddress,
    terms: encodedTerms  // hook address, allowed selectors, fee bounds
  });
```

### Step 3.4: Agent redeems delegation to rebalance

When the AI agent decides to rebalance, it constructs the rebalance calldata, wraps it in a `redeemDelegations` call to the DelegationManager, and submits it as a UserOperation via a bundler (Pimlico on Base).

The DelegationManager:
1. Validates the delegation signature
2. Calls beforeHook on the CuratedVaultCaveatEnforcer
3. Enforcer checks all conditions (correct target, correct function, fee in bounds, rate limit)
4. If all pass, executes the rebalance on behalf of the delegator
5. Calls afterHook

This is the "intent-based delegation" pattern the MetaMask bounty rewards — the depositor expresses intent ("optimize my LP within these bounds") and the agent operates freely within the caveats.

**End of Day 4 deliverable:** Delegation created, agent redeems delegation to call rebalance(), caveat enforcer correctly blocks unauthorized actions.

---

## PHASE 4: VENICE AI + x402 + LOCUS (Day 5–6 — March 17–18)

**Goal:** The AI curator agent goes live — it reads pool data, calls Venice AI for market analysis, pays for data via x402, and manages its budget through Locus.

### Step 4.1: Set up Locus wallet for the agent

1. Create account at app.paywithlocus.com
2. Deploy a Locus wallet on Base (USDC only)
3. Set spending controls: per-transaction max ($0.50 for API calls), daily cap ($5.00)
4. Generate a Locus API key (format: `locus_xxxx`)
5. Fund the wallet with $10 USDC for the hackathon

The agent's MCP config connects to Locus at `https://mcp.paywithlocus.com/mcp` with Bearer auth.

### Step 4.2: Set up x402 payment for market data

Install the x402 client: `npm install @x402/axios`

The agent uses AgentCash (Merit Systems) to consume market data APIs. AgentCash routes payments through x402 — each API call costs USDC microcents, auto-paid from the Locus wallet.

Specific APIs the agent will consume via x402:
- Price data for wstETH and USDC (via AgentCash's bundled routes)
- Social sentiment (via AgentCash's Twitter/X Grok endpoint)
- Market volatility indicators

### Step 4.3: Venice AI integration

Get a Venice API key from venice.ai/settings/api. Use the OpenAI-compatible endpoint:

Base URL: `https://api.venice.ai/api/v1`
Auth: `Authorization: Bearer VENICE_API_KEY`

The agent's analysis prompt structure:
```
System: You are an AI agent managing concentrated liquidity for a wstETH/USDC pool 
on Uniswap v4 on Base. Analyze the market data and recommend:
1. Optimal tick range [tickLower, tickUpper] for the current conditions
2. Recommended swap fee in basis points (100 = 0.01%)
3. Confidence score 0-100
4. Brief reasoning

Respond ONLY in JSON format.

User: {current pool state + price data + sentiment data from x402 APIs}
```

Model: `zai-org-glm-4.7` (function calling capable, 128k context) or `qwen3-235b` (strongest reasoning).

Enable `venice_parameters.enable_web_search: "auto"` for real-time market data enrichment.

### Step 4.4: Agent loop

The agent runs as a Node.js process (or Python, depending on preference):

```
every 5 minutes:
  1. Read pool state from Base RPC (current tick, liquidity, recent swap volume)
  2. Call Uniswap Trading API for price quotes (satisfies Uniswap bounty requirement)
  3. Call x402 APIs via AgentCash for market data (satisfies Merit bounty)
  4. All payments routed through Locus wallet (satisfies Locus bounty)
  5. Send all data to Venice AI for analysis (satisfies Venice bounty)
  6. If recommendation differs significantly from current position:
     - Construct rebalance calldata
     - Redeem MetaMask delegation to execute (satisfies MetaMask bounty)
  7. Log all actions with timestamps
```

### Step 4.5: Uniswap API integration (REQUIRED for bounty)

The agent must make real API calls with a real API key and produce real TxIDs:

1. Use `POST /v1/quote` to get price quotes for wstETH/USDC as market data input
2. Use `POST /v1/swap` to execute any swaps needed during rebalancing (e.g., if the vault holds excess of one token after rebalancing)
3. Log all TxIDs in a file for the bounty submission

Additionally, install the Uniswap AI Skills:
```
npx skills add uniswap/uniswap-ai --skill swap-integration
npx skills add uniswap/uniswap-ai --skill liquidity-planner
```

These provide agent-compatible tools for the AI to use when reasoning about LP strategy.

**End of Day 6 deliverable:** Agent running, calling Venice AI, paying via x402/Locus, executing rebalances via MetaMask delegation. Real Uniswap API TxIDs logged.

---

## PHASE 5: REPUTATION FEEDBACK + ADDITIONAL IDENTITY LAYERS (Day 7 — March 19)

**Goal:** Write real reputation feedback to ERC-8004 ReputationRegistry after each rebalance cycle. Layer on Self Protocol Agent ID and ENS/Basenames for additional bounties.

### Step 5.1: ERC-8004 ReputationRegistry integration (agent REPORT state)

After each rebalance cycle, the agent writes a reputation entry to the live ReputationRegistry at `0x8004B663056A597Dffe9eCcC1965A193B7388713` on Base Sepolia.

The agent's REPORT state (after EXECUTE in the FSM loop) does the following:

1. Compute performance delta: compare vault value before and after the rebalance window
2. Encode a reputation payload: `{ rebalanceCount, avgFeeRevenue, tickAccuracy, timestamp }`
3. Call `REPUTATION_REGISTRY.submitFeedback(curatorIdentityId, payload)` on-chain
4. This creates a permanent, verifiable reputation trail — anyone can query the ReputationRegistry to see how well a curator has performed historically

This makes ERC-8004 deeply load-bearing in TWO directions:
- **IdentityRegistry** gates curator registration (Phase 2, Step 2.1)
- **ReputationRegistry** records curator performance after every rebalance cycle (this step)

The combination means curators build verifiable on-chain reputation that LPs can inspect before choosing a curator.

### Step 5.2: Self Protocol Agent ID (additional identity layer)

Go to app.ai.self.xyz and register the curator agent. Five modes available:
- Wallet-based (connect existing wallet)
- Agent keypair (generate new keypair)
- Wallet-free (email/social)
- Passkey smart wallet
- Social login via Privy

For the hackathon, use wallet-based registration with the curator's MetaMask smart account address. The agent receives a soulbound NFT as its identity credential.

Integrate via the Self Agent SDK:
```
npm install @selfxyz/agent-sdk
```

Or via the MCP server:
```
npm install @selfxyz/mcp-server
```

Add an OPTIONAL secondary check in `registerCurator()` that verifies the caller also has a Self Agent ID NFT. This is additive — ERC-8004 is the primary identity gate, Self is a bonus layer that qualifies for the Self Protocol bounty.

### Step 5.3: ENS/Basenames

Register a Basename for the curator agent at base.org/names (e.g., `vault-curator.base.eth`).

In the frontend, resolve all addresses to their Basenames using the L2 resolver. This means:
- Curator displayed as `vault-curator.base.eth` instead of `0x1234...`
- Depositors displayed by their Basenames if they have one
- All transaction logs show names, not hex addresses

For on-chain ENS resolution within the hook, this is optional — the primary integration is in the frontend.

### Step 5.4: Olas Mech Marketplace integration

Install mech-client:
```
pip install mech-client
```

Integrate the mech-client into the agent's analysis pipeline. Instead of calling Venice AI directly for one of the analysis steps, the agent hires an Olas Mech:

```
mechx request \
  --prompts "Analyze wstETH/USDC concentrated LP: current tick -201840, liquidity 5M, 24h volume 150K. Recommend optimal tick range and fee." \
  --priority-mech <mech-address> \
  --tools openai-gpt4o \
  --chain-config base
```

Make at least 10 requests over the hackathon period to qualify for the "Hire an Agent" bounty ($1,000).

**End of Day 7 deliverable:** ReputationRegistry receiving real feedback entries after each rebalance. Agent has Self Agent ID NFT, Basename registered, Olas Mech requests logged (count tracked).

---

## PHASE 6: FRONTEND (Day 8 — March 20)

**Goal:** React dashboard showing the complete vault experience.

### Step 6.1: Pages

**Home / Vault Overview:**
- Pool stats: TVL, current tick range, fee rate, 24h volume
- Curator info: Basename, Self Agent ID status, performance metrics
- Deposit/Withdraw interface with MetaMask connection

**Curator Dashboard:**
- Agent status: online/offline, last rebalance time
- Venice AI analysis log: recent recommendations with reasoning
- Payment log: x402 API costs, Locus wallet balance
- Delegation status: active delegations, caveat parameters

**Performance:**
- Charts: vault APY vs passive LP benchmark
- Fee revenue breakdown
- Rebalance history with before/after tick ranges

### Step 6.2: Key integrations in frontend

- Wagmi/Viem for wallet connections and contract reads
- Uniswap Trading API for price display (uses the same API key)
- ENS/Basenames resolution for all addresses
- Venice AI response display (show the agent's reasoning to users)
- Locus spending dashboard (embed or link to Locus UI)

### Step 6.3: Open source and README

The Uniswap bounty REQUIRES:
- Public GitHub repository
- README with setup instructions, architecture diagram, deployed addresses
- Documentation of all API integrations with real TxIDs

**End of Day 8 deliverable:** Working frontend on localhost, all pages functional, README drafted.

---

## PHASE 7: TESTING AND DEMO (Day 9 — March 21)

**Goal:** Full integration test on Base Sepolia, demo recording, and submission.

### Step 7.1: Integration test on Base Sepolia

1. Deploy project contracts (hook, vault shares, caveat enforcer) to Base Sepolia — ERC-8004 IdentityRegistry and ReputationRegistry are already live there
2. Initialize pool with test wstETH and USDC
3. Register curator — verify IdentityRegistry.ownerOf() check passes with real ERC-8004 identity
4. Depositor creates MetaMask delegation to curator
5. Run agent loop — verify it calls Venice, pays via x402/Locus, rebalances via delegation
6. After rebalance, verify ReputationRegistry receives feedback entry for the curator's identity ID
7. Execute several swaps — verify dynamic fees work
8. Withdraw — verify shares burn correctly and tokens return
9. Verify all TxIDs are real (Uniswap bounty requirement)

### Step 7.2: Demo recording (60 seconds)

Script:
1. "I'm an AI curator managing a wstETH/USDC vault on Uniswap v4." Show the frontend with pool stats.
2. "Alice connects MetaMask and deposits 1000 USDC + 0.4 wstETH." Show the deposit flow with MetaMask delegation setup.
3. "The AI analyzes the market via Venice AI — here's its reasoning." Show the Venice response with recommendation.
4. "It decides to rebalance — widening the range because volatility is rising." Show the rebalance tx via MetaMask delegation.
5. "The fee adjusts from 0.3% to 0.5%. Swaps now earn more for LPs." Show a swap at the new fee.
6. "Alice can withdraw anytime — the human stays in control." Show the withdraw button.
7. "All the agent's costs — Venice inference, market data — are paid via x402 through Locus." Show the payment log.

### Step 7.3: Submission

Submit on Devfolio (the Synthesis hackathon platform). Apply for all targeted bounties:
- Venice AI: "Private Agents, Trusted Actions"
- Uniswap: "Agentic Finance (Best Uniswap API Integration)"
- MetaMask: "Best Use of Delegations"
- Merit Systems: "Build with x402" (all three sub-bounties if allowed)
- Locus: "Best Use of Locus"
- Self: "Best Self Agent ID Integration"
- ENS: "ENS Identity"
- Olas: "Hire an Agent on Olas Marketplace"

---

## RISK REGISTER

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Hook address mining takes too long | Blocks deployment | Low | Use GPU for mining; in tests use vm.etch() to bypass |
| Venice AI rate-limited or down | Agent can't analyze | Medium | Cache last recommendation; use fallback model (llama-3.3-70b) |
| MetaMask delegation framework not deployed on Base | Blocks delegation | Low | Confirmed deployed on Base; fallback: use direct EOA signing |
| ERC-8004 ReputationRegistry.submitFeedback() interface differs from expected | Breaks reputation writes | Medium | Read the contract ABI from Sepolia block explorer on Day 1; write an interface adapter |
| Uniswap LP API "Coming Soon" | Can't LP via API | Certain | Use direct PositionManager contract calls; API for swaps/quotes only |
| Locus API changes during hackathon | Breaks payment flow | Low | Use MCP server (stable interface); pin to specific API version |
| x402 facilitator has 1000 free tx/month limit | Runs out during demo | Low | 1000 is plenty for a hackathon; monitor usage |
| Pool has no volume for performance tracking | Can't show APY | High | Self-generate test swaps; compare against a non-hook pool |
| Gas costs on Base spike | Makes demos expensive | Very Low | Base gas is typically <$0.01; budget $5 for all testing |

---

## FILES AND DIRECTORY STRUCTURE

```
curatedlp/
├── contracts/
│   ├── src/
│   │   ├── CuratedVaultHook.sol          # Main hook contract
│   │   ├── VaultShares.sol               # ERC-20 share token
│   │   ├── CuratedVaultCaveatEnforcer.sol # MetaMask delegation caveat
│   │   └── interfaces/
│   │       ├── IIdentityRegistry.sol     # ERC-8004 IdentityRegistry interface (0x8004A818...)
│   │       └── IReputationRegistry.sol   # ERC-8004 ReputationRegistry interface (0x8004B663...)
│   ├── test/
│   │   ├── CuratedVaultHook.t.sol        # Foundry tests
│   │   └── utils/
│   │       └── HookMiner.sol             # Address mining utility
│   ├── script/
│   │   └── Deploy.s.sol                  # Deployment script
│   ├── foundry.toml
│   └── .env
├── agent/
│   ├── src/
│   │   ├── index.ts                      # Agent entry point
│   │   ├── venice.ts                     # Venice AI client
│   │   ├── uniswap-api.ts               # Uniswap Trading API client
│   │   ├── x402-client.ts               # AgentCash/x402 payment client
│   │   ├── locus.ts                      # Locus wallet management
│   │   ├── delegation.ts                 # MetaMask delegation redemption
│   │   ├── mech-client.ts               # Olas Mech Marketplace client
│   │   └── rebalancer.ts                # Core rebalance decision logic
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── VaultOverview.tsx
│   │   │   ├── CuratorDashboard.tsx
│   │   │   └── Performance.tsx
│   │   ├── hooks/
│   │   │   ├── useVaultData.ts
│   │   │   ├── useUniswapAPI.ts
│   │   │   └── useBasename.ts
│   │   └── components/
│   ├── package.json
│   └── .env
├── README.md
└── .gitignore
```

---

## BOUNTY CHECKLIST — VERIFY BEFORE SUBMISSION

| Bounty | Hard Requirement | Verification |
|---|---|---|
| Uniswap | Real API key from developers.uniswap.org | Check API key works in curl |
| Uniswap | Functional swaps with real TxIDs | Log all TxIDs to file, include in README |
| Uniswap | Open source, public GitHub, README | Push to public repo before submission |
| MetaMask | Uses MetaMask Delegation Framework | Show delegation creation + redemption in demo |
| MetaMask | "Standard patterns without meaningful innovation will not place" | Custom CuratedVaultCaveatEnforcer is the innovation |
| Venice | Uses Venice API for private cognition | Show Venice API calls in agent logs |
| Venice | Outputs feed into public/on-chain action | Venice recommendation → on-chain rebalance tx |
| Merit/x402 | x402 payment layer is "load-bearing, not decorative" | Agent cannot function without x402 API data |
| Locus | "Working Locus integration" or auto-DQ | Test Locus wallet tx before submission |
| Locus | "On Base chain, USDC only" | All Locus txs on Base with USDC |
| Self | "Agent identity is load-bearing, not decorative" | Curator registration requires Self Agent ID |
| ENS | "ENS names establish identity onchain" | All addresses display as Basenames in frontend |
| Olas | "At least 10 requests" on Mech Marketplace | Track request count, verify on marketplace.olas.network |
| ERC-8004 | IdentityRegistry gates curator registration | Verify registerCurator() reverts without valid identity NFT |
| ERC-8004 | ReputationRegistry receives feedback after rebalance | Query ReputationRegistry on Sepolia block explorer to confirm entries |
