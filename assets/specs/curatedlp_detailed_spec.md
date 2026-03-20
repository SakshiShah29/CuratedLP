# CuratedLP — Detailed Technical Specification

*Last updated: 2026-03-20*

*Related specs: curator-agent-identity-spec.md, openclaw-agent-spec.md*

---

## 1. What is CuratedLP?

A Uniswap v4 hook on Base that transforms a standard concentrated liquidity pool into
an AI-managed vault. LPs deposit tokens passively; a registered AI curator agent
continuously optimizes the tick range and swap fee using Venice AI. The curator
operates within cryptographically enforced bounds via MetaMask's delegation framework
and earns performance fees only when it outperforms passive LP returns.

---

## 2. Actors

The curator IS the AI agent. "Curator" is a role the agent holds in
the vault. The agent has two on-chain addresses — one for identity and
execution, one for triggering actions and spending on data. For the full
identity model, see curator-agent-identity-spec.md.

```
 +-----------------+     +---------------------------+     +-------------------+
 |   Human LP      |     |   The Agent               |     |    Swapper        |
 |   ("Alice")     |     |   (curator = AI agent)    |     |    ("Bob")        |
 |                 |     |                           |     |                   |
 |  - Regular EOA  |     |  Two on-chain addresses:  |     |  - Any trader     |
 |  - Deposits     |     |                           |     |  - Swaps through  |
 |  - Withdraws    |     |  Agent Smart Account:     |     |    the pool       |
 |  - Holds shares |     |   - MetaMask DeleGator    |     |  - Pays dynamic   |
 |                 |     |   - Registered curator     |     |    fee set by     |
 |  NO delegation  |     |   - Holds ERC-8004 NFT    |     |    curator        |
 |  involvement    |     |   - Pays gas (ETH)        |     |                   |
 |                 |     |   - DELEGATOR              |     |                   |
 +-----------------+     |                           |     +-------------------+
                          |  Locus Wallet:            |
                          |   - ERC-4337 smart wallet |
                          |   - Triggers delegation   |
                          |   - Pays for data (USDC)  |
                          |   - DELEGATE              |
                          +---------------------------+
                                     |
                                     | OpenClaw runtime reasons
                                     | about what to do each
                                     | heartbeat (every 5 min)
                                     v
                          +-------------------+          +---------------------+
                          |  OpenClaw Agent   |          |  Volatility Agent   |
                          |  (reasoning)      |          |  ("Charlie")        |
                          |                   |          |                     |
                          | - Reads SKILL.md  |  sub-    | - Specialized agent |
                          | - Invokes tools   | ------> | - Handles high-vol  |
                          | - Makes decisions | delegate | - Redeems 2-hop     |
                          | - Autonomous      |          |   delegation chain  |
                          +-------------------+          +---------------------+
```

### Actor Responsibilities

| Actor | On-Chain Addresses | Role |
|---|---|---|
| Human LP (Alice) | EOA | Deposits, withdraws. No delegation involvement. |
| The Agent | Agent Smart Account (identity, curator, gas) + Locus Wallet (trigger, data spending) | Registered curator. OpenClaw reasons, Locus triggers delegation, Smart Account executes on hook. |
| Human Operator | EOA (controls Smart Account) | One-time setup: creates SA, signs delegation bounds. Emergency recovery. |
| Volatility Agent | Locus Wallet (sub-redeemer) | Optional specialist for extreme conditions. Redeems 2-hop chain. |
| Swapper (Bob) | Any address | Trades through pool normally. Pays dynamic fee. |

---

## 3. Smart Contract Architecture

```
                    +------------------------------------------+
                    |         Uniswap v4 PoolManager           |
                    |  (Base Sepolia: 0x4985...2b2b)           |
                    +------------------------------------------+
                         |             |              |
                   afterInitialize  beforeSwap    afterSwap
                   beforeAddLiq    beforeRemoveLiq
                         |             |              |
                    +------------------------------------------+
                    |        CuratedVaultHook                  |
                    |  (Solidity 0.8.26)                       |
                    |                                          |
                    |  Vault:                                  |
                    |    deposit()  withdraw()                 |
                    |    VaultShares (ERC-20)                  |
                    |                                          |
                    |  Curator:                                |
                    |    registerCurator()                     |
                    |    rebalance()                           |
                    |    claimPerformanceFee()                 |
                    |                                          |
                    |  Fee Engine:                             |
                    |    beforeSwap  -> returns dynamic fee    |
                    |    afterSwap   -> accrues perf fee       |
                    +------------------------------------------+
                         |                        |
                    uses ownerOf()          validates delegation
                         |                        |
              +---------------------+    +-----------------------------+
              | ERC-8004            |    | CuratedVaultCaveatEnforcer  |
              | IdentityRegistry    |    | (Solidity 0.8.23)           |
              | (0x8004...BD9e)     |    |                             |
              +---------------------+    | Allows:                     |
              | ReputationRegistry  |    |   rebalance() w/ fee bounds |
              | (0x8004...8713)     |    |   claimPerformanceFee()     |
              +---------------------+    +-----------------------------+
                                                  |
                                           called by
                                                  |
                                    +-----------------------------+
                                    | MetaMask                    |
                                    | DelegationManager           |
                                    | (Base Sepolia)              |
                                    +-----------------------------+
```

---

## 4. Delegation Model — Detailed Flow

This is the most critical architectural decision in the project. The MetaMask
delegation framework provides scoped permissions without exposing private keys.

### 4.1 Why Delegation?

The agent's Smart Account is registered as the curator. But the OpenClaw
runtime needs a way to trigger on-chain actions without holding the Smart
Account's signing key directly. The delegation separates identity from
execution — the Smart Account (identity) delegates to the Locus Wallet
(trigger) with enforced bounds.

This also enables key rotation (if the Locus wallet key is compromised,
revoke delegation and assign a new wallet — identity and reputation are
unaffected) and on-chain guardrails (the enforcer validates every action
even if the OpenClaw LLM hallucinates bad parameters).

### 4.2 Setup Phase (One-Time, Human Operator)

```
    Human Operator
         |
         | (1) Creates Agent Smart Account (MetaMask DeleGator)
         |     This becomes the agent's on-chain identity.
         v
    +----------------------------+
    | Agent Smart Account        |
    | (DeleGator)                |
    +----------------------------+
         |
         | (2) Funds Smart Account with ETH (for gas)
         |
         | (3) Registers ERC-8004 identity NFT
         |     Smart Account calls IdentityRegistry.register()
         |     Receives identity NFT — the agent's on-chain identity
         v
    +----------------------------+
    | ERC-8004 IdentityRegistry  |   ownerOf(tokenId) == Agent Smart Account
    +----------------------------+
         |
         | (4) Registers as curator in the hook
         |     Smart Account calls hook.registerCurator(feeBps, tokenId)
         |     Hook verifies: IdentityRegistry.ownerOf(tokenId) == msg.sender
         |     Stores: curatorByWallet[AgentSmartAcct] = curatorId
         |     First curator auto-becomes activeCuratorId
         v
    +----------------------------+
    | CuratedVaultHook           |   curatorByWallet[SA] = 1, activeCuratorId = 1
    +----------------------------+
         |
         | (5) Sets up Locus wallet (ERC-4337, USDC, spending limits)
         |
         | (6) Signs delegation: Agent Smart Account → Locus Wallet
         |     "Locus Wallet may trigger rebalance() and
         |     claimPerformanceFee() on hook address, with fee between
         |     minFee and maxFee, no more than once per N blocks"
         |     Human operator defines these bounds — the agent's mandate.
         |     EIP-712 typed signature — no on-chain tx.
         v
    +----------------------------+
    | Locus Wallet               |   Holds signed delegation bytes
    | (agent's trigger + wallet) |   OpenClaw runtime controls this wallet
    +----------------------------+
```

### 4.3 Runtime — Rebalance Execution

```
    OpenClaw Runtime (reasoning)
         |
         | Heartbeat fires. Agent reads pool state, analyzes data,
         | decides to rebalance with Venice AI's recommended params.
         |
         | Invokes execute-rebalance tool:
         v
    Locus Wallet (trigger)
         |
         | (1) Calls DelegationManager.redeemDelegations(
         |         signedDelegation,        <-- signed by human during setup
         |         rebalanceCalldata         <-- built by OpenClaw this heartbeat
         |     )
         v
    +----------------------------------------------+
    | MetaMask DelegationManager                   |
    |                                              |
    |  (2) Validates Smart Account's signature     |
    |      on the delegation                       |
    |                                              |
    |  (3) Calls CuratedVaultCaveatEnforcer        |
    |      .beforeHook(terms, execCalldata)        |
    |      Enforcer checks:                        |
    |        - target == hook address?         YES |
    |        - selector == rebalance()?        YES |
    |        - fee within [minFee, maxFee]?    YES |
    |        - rate limit respected?           YES |
    |                                              |
    |  (4) Calls AgentSmartAccount.execute(        |
    |         hook,                                |
    |         0,                                   |
    |         rebalanceCalldata                    |
    |      )                                       |
    +----------------------------------------------+
                         |
                         | Regular CALL (not delegatecall)
                         | msg.sender = Agent Smart Account
                         | Smart Account pays gas (ETH)
                         v
    +----------------------------------------------+
    | CuratedVaultHook.rebalance(...)              |
    |                                              |
    |  curatorByWallet[msg.sender]                 |
    |    == curatorByWallet[AgentSmartAcct]         |
    |    == activeCuratorId                         |
    |    == 1                                  YES |
    |                                              |
    |  Removes all liquidity                       |
    |  Updates tick range + fee                    |
    |  Re-adds liquidity at new range              |
    +----------------------------------------------+
```

**Critical distinction**: The Smart Account makes a regular `CALL` to the hook.
The hook reads its own storage. There is no `DELEGATECALL` — the word "delegation"
refers to the permission system, not the EVM opcode.

### 4.4 What the Human Operator Signs vs. What the Agent Constructs

```
  +----------------------------------------------------------+
  |                                                          |
  |  HUMAN OPERATOR SIGNS (once, at setup):                  |
  |                                                          |
  |    "Locus Wallet may trigger rebalance() or              |
  |     claimPerformanceFee() on hook 0xHOOK, with fee       |
  |     between 500 and 10000, no more than once every       |
  |     10 blocks"                                           |
  |                                                          |
  |    This is the BOUNDS — the agent's mandate.             |
  |    The delegation remains valid until explicitly revoked. |
  |                                                          |
  +----------------------------------------------------------+
  |                                                          |
  |  OPENCLAW AGENT CONSTRUCTS (fresh each heartbeat):       |
  |                                                          |
  |    rebalance(-120, 120, 3000, 0, 0)                      |
  |              ^^^^  ^^^  ^^^^                              |
  |              tick   tick  fee = 0.30% (within bounds)     |
  |                                                          |
  |    This is the SPECIFIC ACTION — chosen by Venice AI     |
  |    via the OpenClaw reasoning layer.                     |
  |    The enforcer verifies it falls within the bounds.     |
  |                                                          |
  +----------------------------------------------------------+
```

### 4.5 What Happens if the Delegation Is Missing?

| Scenario | Result | Recovery |
|---|---|---|
| Setup phase never ran | Agent cannot rebalance | Run setup.ts + delegation.ts |
| Human revokes delegation | Agent frozen | Human signs new delegation |
| Fee exceeds signed bounds | Enforcer reverts | Human signs new delegation with wider bounds |
| Locus wallet key compromised | Attacker can only rebalance within bounds | Revoke delegation, assign new Locus wallet. Identity + reputation unaffected. |

---

## 5. Sub-Delegation Chain (MetaMask Bounty Differentiator)

The naming "Alice -> Bob -> Charlie" in the MetaMask bounty refers to roles
**within the delegation chain**, not the LP.

```
  "Alice" = Agent Smart Account    (the top-level delegator, agent's identity)
  "Bob"   = Locus Wallet           (primary agent trigger, delegate)
  "Charlie" = Volatility Agent     (specialist, sub-redeemer)
```

### 5.1 Chain Structure

```
  +---------------------------+
  | Curator Smart Account     |
  | ("Alice")                 |
  +---------------------------+
              |
              | Delegation #1
              | terms: hook=0xHOOK, minFee=100, maxFee=50000, interval=10
              | (wide bounds — trusts the agent)
              v
  +---------------------------+
  | Locus Wallet              |
  | ("Bob" — primary trigger) |
  +---------------------------+
              |
              | Delegation #2 (sub-delegation)
              | authority = hash(Delegation #1)  <-- cryptographic chain link
              | terms: hook=0xHOOK, minFee=500, maxFee=20000, interval=60
              | (tighter bounds — limits volatility agent)
              v
  +---------------------------+
  | Volatility Agent          |
  | ("Charlie")               |
  +---------------------------+
```

### 5.2 Redemption Flow

```
  Volatility Agent (Charlie)
       |
       | redeemDelegations([Delegation #1, Delegation #2], rebalanceCalldata)
       v
  +----------------------------------------------------+
  | DelegationManager                                  |
  |                                                    |
  | (1) Validates Curator SA's signature on Deleg #1   |
  | (2) Validates Locus Wallet's signature on Deleg #2  |
  | (3) Verifies chain: Deleg#2.authority == hash(#1)  |
  |                                                    |
  | (4) Runs enforcer for Delegation #1:               |
  |     - fee within [100, 50000]?              YES    |
  |     - rate limit (10 blocks)?               YES    |
  |                                                    |
  | (5) Runs enforcer for Delegation #2:               |
  |     - fee within [500, 20000]?              YES    |
  |     - rate limit (60 blocks)?               YES    |
  |                                                    |
  |     Effective bounds = INTERSECTION:               |
  |       fee: [500, 20000]                            |
  |       interval: 60 blocks                          |
  |                                                    |
  | (6) Executes rebalance() via Curator SA            |
  |     msg.sender in hook = Curator Smart Account     |
  +----------------------------------------------------+
```

### 5.3 Zero New Solidity Required

Sub-delegation requires no contract changes. The same `CuratedVaultCaveatEnforcer`
runs at each level with different `_terms`. The `DelegationManager` handles chain
validation, signature verification, and cascading enforcer calls automatically.

The only new code needed is TypeScript (`sub-delegation.ts`) to construct and
sign the second delegation off-chain.

---

## 6. Complete User Flows

### 6.1 Deposit Flow

```
  Alice (EOA)
       |
       | deposit(1 ETH, 1000 USDC, minAmounts, minShares, deadline)
       v
  +--------------------------------------------------+
  | CuratedVaultHook                                 |
  |                                                  |
  | (1) Transfer tokens from Alice to hook           |
  |     (SafeERC20, fee-on-transfer safe)            |
  |                                                  |
  | (2) Calculate liquidity from amounts + price     |
  |                                                  |
  | (3) Add liquidity to PoolManager via unlock      |
  |     callback (hook is the only allowed LP)       |
  |                                                  |
  | (4) Slippage check on amounts used               |
  |                                                  |
  | (5) Mint vault shares to Alice                   |
  |     First deposit: shares = sqrt(amt0 * amt1)    |
  |                    minus 1000 dead shares         |
  |     Subsequent:    shares proportional to         |
  |                    liquidity / totalLiquidity     |
  |                                                  |
  | (6) Refund unused tokens to Alice                |
  +--------------------------------------------------+
```

### 6.2 Withdraw Flow

```
  Alice (EOA)
       |
       | withdraw(shares, minAmount0, minAmount1, deadline)
       v
  +--------------------------------------------------+
  | CuratedVaultHook                                 |
  |                                                  |
  | (1) Calculate proportional liquidity to remove   |
  |     liquidityToRemove = totalLiquidity            |
  |                         * shares / totalShares   |
  |                                                  |
  | (2) Remove liquidity from PoolManager via        |
  |     unlock callback                              |
  |                                                  |
  | (3) Slippage check                               |
  |                                                  |
  | (4) Burn shares, update totalLiquidity           |
  |                                                  |
  | (5) Transfer tokens to Alice                     |
  +--------------------------------------------------+
```

### 6.3 Rebalance Flow

```
  OpenClaw Agent (via Locus Wallet trigger)
       |
       | (Locus Wallet -> DelegationManager -> Smart Account -> hook)
       | rebalance(newTickLower, newTickUpper, newFee, maxIdle0, maxIdle1)
       v
  +--------------------------------------------------+
  | CuratedVaultHook                                 |
  |                                                  |
  | (1) Auth: msg.sender == registered curator       |
  |                                                  |
  | (2) Rate limit: 30+ blocks since last rebalance  |
  |                                                  |
  | (3) Validate tick range (aligned to spacing=60)  |
  |                                                  |
  | (4) Validate fee (0 < fee <= 10%)                |
  |                                                  |
  | (5) Remove ALL current liquidity                 |
  |     (tokens return to hook balance)              |
  |                                                  |
  | (6) Update tick range + fee in storage           |
  |                                                  |
  | (7) Re-add ALL liquidity at new range            |
  |     (recalculate from hook's token balances)     |
  |                                                  |
  | (8) Idle balance check                           |
  |     Reverts if undeployed tokens > maxIdle       |
  |     (sandwich attack protection)                 |
  +--------------------------------------------------+
```

### 6.4 Swap Flow (Background, Continuous)

```
  Swapper (Bob)
       |
       | swap(zeroForOne, amountSpecified)
       v
  +--------------------------------------------------+
  | PoolManager                                      |
  |                                                  |
  | calls beforeSwap on hook:                        |
  |   Hook returns curator's recommendedFee          |
  |   with OVERRIDE_FEE_FLAG set                     |
  |   (no pool state write needed)                   |
  |                                                  |
  | executes swap at that fee                        |
  |                                                  |
  | calls afterSwap on hook:                         |
  |   Hook tracks:                                   |
  |     cumulativeVolume += |delta.amount0|           |
  |     feeRevenue = volume * fee / 1,000,000        |
  |     cumulativeFeeRevenue += feeRevenue           |
  |     accruedPerformanceFee +=                     |
  |       feeRevenue * performanceFeeBps / 10,000    |
  |     totalSwaps++                                 |
  +--------------------------------------------------+
```

### 6.5 Claim Performance Fee

```
  OpenClaw Agent (via Locus Wallet trigger)
       |
       | (Locus Wallet -> DelegationManager -> Smart Account -> hook)
       | claimPerformanceFee()
       v
  +--------------------------------------------------+
  | CuratedVaultHook                                 |
  |                                                  |
  | (1) Auth: msg.sender == active curator           |
  |                                                  |
  | (2) Read accruedPerformanceFee                   |
  |     Revert if zero                               |
  |                                                  |
  | (3) Set accruedPerformanceFee = 0                |
  |                                                  |
  | (4) Transfer token0 to msg.sender                |
  |     (from hook's idle balance)                   |
  +--------------------------------------------------+
```

---

## 7. Fee Economics

### 7.1 Fee Layers

```
  Swapper pays fee per swap
       |
       v
  +--------------------------------------------------+
  |  LP Swap Fee (dynamic, 0.01% - 10%)              |
  |  Set by curator via rebalance()                  |
  |  Returned by beforeSwap with OVERRIDE_FEE_FLAG   |
  |  Collected by PoolManager, distributed to         |
  |  liquidity position (i.e., the hook's position)  |
  +--------------------------------------------------+
       |
       | On each swap, afterSwap calculates:
       | feeRevenue = volume * fee / 1,000,000
       v
  +--------------------------------------------------+
  |  Performance Fee (0% - 20% of LP fee revenue)    |
  |  Set at registration (performanceFeeBps)         |
  |  Accrued per swap in accruedPerformanceFee       |
  |  Claimed by curator via claimPerformanceFee()    |
  |  Paid from hook's idle token0 balance            |
  +--------------------------------------------------+
```

### 7.2 Example

```
  Swap: 10 ETH volume at 0.30% fee
  LP fee revenue:       10 * 3000 / 1,000,000 = 0.03 ETH
  Performance fee (10%): 0.03 * 1000 / 10,000 = 0.000003 ETH accrued for curator
```

### 7.3 Where the Fees Live

```
  +--------------------------------------------------+
  |  Hook's token balances                            |
  |                                                  |
  |  Idle token0 = tokens not deployed as liquidity  |
  |  Idle token1 = tokens not deployed as liquidity  |
  |                                                  |
  |  These accumulate from:                          |
  |    - LP fee revenue collected during rebalances  |
  |    - Rounding differences on rebalance           |
  |    - One-sided idle when price moves outside     |
  |      the tick range                              |
  |                                                  |
  |  accruedPerformanceFee is paid FROM this balance |
  |  (token0 only)                                   |
  +--------------------------------------------------+
```

---

## 8. Caveat Enforcer — Dual Selector Design

```
  +------------------------------------------------------------------+
  |  CuratedVaultCaveatEnforcer                                      |
  |                                                                  |
  |  Terms (set by delegator, signed once):                          |
  |    abi.encode(hookAddress, minFee, maxFee, minBlockInterval)     |
  |                                                                  |
  |  Execution payload (built by redeemer each call):                |
  |    abi.encodePacked(target, value, calldata)                     |
  |    [20 bytes] [32 bytes] [4+ bytes]                              |
  |                                                                  |
  |  beforeHook logic:                                               |
  |                                                                  |
  |    target == hookAddress?  ----NO----> revert InvalidTarget      |
  |         |                                                        |
  |        YES                                                       |
  |         |                                                        |
  |    selector == claimPerformanceFee()?                             |
  |         |              |                                         |
  |        YES            NO                                         |
  |         |              |                                         |
  |      RETURN OK     selector == rebalance()?                      |
  |    (no further         |              |                          |
  |     checks)           YES            NO                          |
  |                        |              |                          |
  |                   extract fee    revert InvalidFunction          |
  |                        |                                         |
  |                   minFee <= fee <= maxFee?                       |
  |                        |              |                          |
  |                       YES            NO                          |
  |                        |              |                          |
  |                   rate limit ok?  revert FeeOutOfBounds          |
  |                   (skip if first use)                            |
  |                        |              |                          |
  |                       YES            NO                          |
  |                        |              |                          |
  |                   record block   revert RebalanceTooFrequent     |
  |                   RETURN OK                                      |
  +------------------------------------------------------------------+
```

---

## 9. Agent Architecture (OpenClaw + TypeScript Tools)

The agent runs on OpenClaw — an LLM-based runtime that reads a SKILL.md
and autonomously decides what to do each heartbeat. TypeScript CLI tools
handle deterministic execution (RPC reads, API calls, delegation
redemption). OpenClaw handles reasoning (tradeoffs, adaptation, context).
For full details, see openclaw-agent-spec.md.

```
  Heartbeat fires (every 5 min)
       |
       v
  OBSERVE
       |  Tools: pool-reader + check-budget
       |  Agent now knows pool state + spending budget
       |
       v
  REASON ABOUT DATA NEEDS
       |  OpenClaw LLM decides which sources to fetch
       |  based on budget, cache freshness, conditions
       |
       v
  ANALYZE
       |  Tools (as budget allows):
       |    uniswap-quote  (free)
       |    market-data    (paid via Locus)
       |    olas-analyze   (paid via Locus)
       |    venice-analyze (all data → recommendation)
       |
       v
  DECIDE
       |  OpenClaw LLM reasons holistically:
       |    Is change meaningful? Confidence high enough?
       |    Gas justified? Claim fees first?
       |
       |  Possible outcomes:
       |    A) Rebalance
       |    B) Claim fees only
       |    C) Claim fees then rebalance
       |    D) Do nothing
       |    E) Sub-delegate (extreme conditions)
       |
       v
  ACT
       |  Tools: execute-rebalance and/or claim-fees
       |  Locus Wallet triggers DelegationManager
       |  → Enforcer validates → Smart Account executes on hook
       |
       v
  REFLECT
       |  Log: data gathered, Venice reasoning, decision,
       |  tx hashes, budget spent, running totals
       |
       v
  DONE — wait for next heartbeat
```

---

## 10. Partner Integration Map

```
  +-------------------------------------------------------------------------+
  |                        CuratedLP System                                 |
  |                                                                         |
  |   +---------------+                                                     |
  |   | Uniswap v4    | <-- Core infrastructure                            |
  |   | PoolManager   |     Pool, hook, LP mechanics, swap execution        |
  |   | + Trading API |     Price quotes for agent analysis                 |
  |   +---------------+                                                     |
  |          |                                                              |
  |          | hook callbacks                                               |
  |          v                                                              |
  |   +---------------+          +-------------------+                      |
  |   | CuratedVault  | <-----  | MetaMask           |                     |
  |   | Hook          |  auth   | Delegation          | <-- Permission      |
  |   +---------------+  via    | Framework           |     layer           |
  |          |           DM     |                     |     Agent acts       |
  |          |                  | DelegationManager   |     within bounds    |
  |          |                  | Smart Account       |     without keys     |
  |          |                  | CaveatEnforcer      |                     |
  |          |                  +-------------------+                       |
  |          |                                                              |
  |   +------+------+                                                       |
  |   | ERC-8004    | <-- Identity + reputation layer                       |
  |   | Identity    |     Curator must own identity NFT to register         |
  |   | Registry +  |     Agent writes performance data after each cycle    |
  |   | Reputation  |                                                       |
  |   +-------------+                                                       |
  |                                                                         |
  |   +------------------------------------------------------------------+  |
  |   |              OpenClaw Agent (SKILL.md + reasoning)              |  |
  |   |                                                                  |  |
  |   |  Invokes CLI tools:                                              |  |
  |   |                                                                  |  |
  |   |   +-------------+    +-------------+    +-------------+          |  |
  |   |   | Venice AI   |    | x402/Merit  |    | Olas Mech   |          |  |
  |   |   | (venice-    |    | AgentCash   |    | Marketplace |          |  |
  |   |   |  analyze)   |    | (market-    |    | (olas-      |          |  |
  |   |   |             |    |  data)      |    |  analyze)   |          |  |
  |   |   | Brain:      |    | Data:       |    | Secondary:  |          |  |
  |   |   | tick range  |    | price feeds |    | cross-check |          |  |
  |   |   | + fee       |    | sentiment   |    | Venice      |          |  |
  |   |   | recommend-  |    | volatility  |    | recommend-  |          |  |
  |   |   | ation       |    +------+------+    | ations      |          |  |
  |   |   +-------------+          |            +-------------+          |  |
  |   |                       pays via                                   |  |
  |   |                            |                                     |  |
  |   |                     +------+------+                              |  |
  |   |                     | Locus       |                              |  |
  |   |                     | Wallet      | <-- also the DELEGATE        |  |
  |   |                     | (check-     |     in the MetaMask          |  |
  |   |                     |  budget)    |     delegation               |  |
  |   |                     | per-tx +    |                              |  |
  |   |                     | daily limits|                              |  |
  |   |                     +-------------+                              |  |
  |   +------------------------------------------------------------------+  |
  |                                                                         |
  |   +-------------+    +-------------+                                    |
  |   | Self        |    | ENS /       |                                    |
  |   | Protocol    |    | Basenames   |                                    |
  |   |             |    |             |                                    |
  |   | Optional:   |    | UX:         |                                    |
  |   | soulbound   |    | human-      |                                    |
  |   | agent NFT   |    | readable    |                                    |
  |   | identity    |    | addresses   |                                    |
  |   +-------------+    +-------------+                                    |
  +-------------------------------------------------------------------------+
```

### Partner Roles

| Partner | Layer | Load-Bearing? | What It Does |
|---|---|---|---|
| Uniswap v4 | Infrastructure | Yes | Pool, hook system, swap execution, Trading API |
| MetaMask | Permission | Yes | Scoped delegation from Agent Smart Account to Locus Wallet |
| Venice AI | Intelligence | Yes | Analyzes data, outputs rebalance recommendation |
| Merit/x402 | Data Access | Yes | Agent pays for real-time market data via micropayments |
| Locus | Payment | Yes | Agent wallet with autonomous spending controls |
| ERC-8004 | Identity | Yes | Gates curator registration, stores reputation |
| Olas | Intelligence | No | Secondary cross-check, 10+ Mech requests |
| Self Protocol | Identity | No | Optional soulbound agent NFT |
| ENS/Basenames | UX | No | Human-readable names in frontend |

---

## 11. Security Model

### 11.1 Audited Findings (8 Fixed)

| # | Finding | Fix |
|---|---|---|
| 1 | Reentrancy in deposit() via ERC-777 refund | `nonReentrant` modifier + CEI ordering |
| 3 | Rebalance sandwich attack | `maxIdleToken0/1` parameters + idle balance check |
| 4 | Missing deadline on deposit/withdraw | `deadline` parameter, reverts if expired |
| 6 | First depositor share inflation | `minShares` parameter + 1000 dead shares |
| 7 | Unsafe ERC-20 transfers (USDT) | SafeERC20 `safeTransfer` / `safeTransferFrom` |
| 8 | Fee-on-transfer token accounting | Before/after balance measurement in deposit |

### 11.2 Access Control

```
  +---------------------------------------------------------------+
  |  Function              | Who Can Call                          |
  |------------------------+---------------------------------------|
  |  deposit()             | Anyone with tokens                    |
  |  withdraw()            | Anyone with vault shares              |
  |  registerCurator()     | Anyone with ERC-8004 identity NFT     |
  |  rebalance()           | Active curator only (msg.sender)      |
  |  claimPerformanceFee() | Active curator only (msg.sender)      |
  |  beforeSwap            | PoolManager only (internal callback)  |
  |  afterSwap             | PoolManager only (internal callback)  |
  |  unlockCallback        | PoolManager only                      |
  +---------------------------------------------------------------+
```

### 11.3 Blast Radius of Compromised Keys

```
  +---------------------------------------------------------------------+
  | Key Compromised          | Impact                                    |
  |--------------------------|-------------------------------------------|
  | LP Alice's EOA           | Attacker can withdraw Alice's shares.     |
  |                          | Cannot rebalance or claim fees.           |
  |--------------------------|-------------------------------------------|
  | Locus Wallet key         | Attacker can rebalance WITHIN caveat     |
  |                          | bounds (fee range, rate limit).           |
  |                          | Cannot steal LP funds.                    |
  |                          | Cannot exceed fee bounds.                 |
  |                          | Fix: revoke delegation, assign new Locus  |
  |                          | wallet. Identity + reputation unaffected. |
  |--------------------------|-------------------------------------------|
  | Agent Smart Account      | Attacker becomes the curator.            |
  |                          | Can rebalance to bad tick ranges.        |
  |                          | Can claim performance fees.              |
  |                          | Cannot steal LP principal.               |
  |                          | Fix: governance, multi-sig on SA.        |
  +---------------------------------------------------------------------+
```

---

## 12. Key Contract Addresses (Base Sepolia)

| Contract | Address |
|---|---|
| Uniswap v4 PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| Uniswap v4 PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## 13. Build Status

### Solidity — 100% Complete

| Component | Status |
|---|---|
| Hook: deposit, withdraw, beforeSwap, afterSwap | Done |
| Hook: registerCurator with ERC-8004 check | Done |
| Hook: rebalance() (5-param, curator-only auth) | Done |
| Hook: claimPerformanceFee() | Done |
| CuratedVaultCaveatEnforcer (dual selector) | Done |
| Security findings (8 fixes) | Done |
| CuratedVaultHook.t.sol (20 tests) | Done |
| SecurityFindings.t.sol (13 tests) | Done |
| CuratedVaultCaveatEnforcer.t.sol (19 tests) | Done |
| **Total: 52/52 tests passing** | |

### Phase 3 Agent (Delegation + OpenClaw Base) — Complete

| Component | Status |
|---|---|
| setup.ts (SA creation, ERC-8004, registerCurator) | Done |
| delegation.ts (single delegation lifecycle) | Done |
| sub-delegation.ts (3-party chain) | Done |
| workspace/SKILL.md (Phase 3 — simple heuristic) | Done |
| tools/pool-reader.ts | Done |
| tools/execute-rebalance.ts | Done |
| tools/claim-fees.ts | Done |

### Phase 4 Agent (Intelligence + Data) — Not Started

| Component | Bounty |
|---|---|
| tools/check-budget.ts (Locus wallet) | Locus |
| tools/uniswap-quote.ts (Trading API) | Uniswap |
| tools/market-data.ts (AgentCash x402) | Merit |
| tools/olas-analyze.ts (Mech requests) | Olas |
| tools/venice-analyze.ts (Venice AI) | Venice |
| SKILL.md update (full autonomous framework) | All |

### Frontend — Not Started

| Component | Bounty |
|---|---|
| Vault dashboard + deposit/withdraw | Uniswap |
| Curator performance + Venice logs | Venice |
| ENS/Basenames resolution | ENS |

---

## 14. Phase-by-Phase Development Plan

### Phase 0: Foundation — COMPLETE

**Goal:** Working dev environment, hook address mined, pool initialized.

```
  Clone v4-template  -->  Mine hook address  -->  Initialize pool
  forge install           CREATE2 salt for       on Base Sepolia
  forge test passes       permission bits        DYNAMIC_FEE_FLAG
```

**What was built:**
- Cloned Uniswap v4-template scaffold with Foundry, v4-core, v4-periphery
- Mined hook address matching required permission bits
  (afterInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, afterSwap)
- Pool initialized with tickSpacing=60, DYNAMIC_FEE_FLAG
- Uniswap API key obtained from developers.uniswap.org

**Deliverable:** Hook deployed, pool initialized, `forge test` passes.

**How to verify before moving on:**
- `forge build` compiles with no errors
- `forge test` passes on the scaffold's Counter hook example
- Pool is initialized on Base Sepolia fork — call `poolManager.getSlot0(poolId)`
  and confirm sqrtPriceX96 is non-zero
- Hook permissions match expected flags — call `hook.getHookPermissions()` and
  verify afterInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap,
  afterSwap are all true
- Uniswap API key returns a valid quote response (curl test)

---

### Phase 1: Vault Core — COMPLETE

**Goal:** Working deposit/withdraw with share accounting.

```
  Alice                    CuratedVaultHook              PoolManager
    |                            |                            |
    | deposit(amt0, amt1, ...)   |                            |
    |--------------------------->|                            |
    |                            | transferFrom(Alice, hook)  |
    |                            |                            |
    |                            | unlock() ----------------->|
    |                            |<-- unlockCallback() -------|
    |                            |    modifyLiquidity()        |
    |                            |    settle deltas            |
    |                            |                            |
    |                            | mint shares to Alice       |
    |<-- shares ------------------|                            |
    |                            | refund unused tokens       |
    |<-- refund ------------------|                            |
```

**What was built:**
- VaultShares ERC-20 token (separate contract, only hook can mint/burn)
- `deposit()` — transfers tokens, calculates liquidity, adds via unlock callback,
  mints shares (first deposit: sqrt formula + 1000 dead shares)
- `withdraw()` — burns shares, removes proportional liquidity, transfers tokens
- `beforeAddLiquidity` / `beforeRemoveLiquidity` — blocks direct LP, only hook allowed
- Unlock callback — settles deltas with PoolManager using actual return values

**Security measures applied:**
- `nonReentrant` on deposit, withdraw, rebalance (Finding #1)
- CEI ordering: state updates before external calls (Finding #1)
- `deadline` parameter on deposit/withdraw (Finding #4)
- `minShares` parameter + 1000 dead shares (Finding #6)
- SafeERC20 for all transfers (Finding #7)
- Fee-on-transfer safe via before/after balance measurement (Finding #8)

**Deliverable:** Deposit tokens, receive shares, withdraw shares, receive tokens.

**How to verify before moving on:**
- `forge test` — all vault tests pass (deposit, withdraw, roundtrip, two depositors)
- Deposit 1 ETH + 1 ETH worth of token1 as Alice -> confirm shares > 0
  and `hook.totalLiquidity()` > 0
- Withdraw all shares -> confirm Alice receives tokens back and
  `hook.totalLiquidity()` returns to 0
- Direct `modifyLiquidity()` via PoolModifyLiquidityTest reverts with
  `CuratedVaultHook_DirectLiquidityNotAllowed`
- Deposit with `amount0 = 0, amount1 = 0` reverts with `ZeroDeposit`
- Deposit with expired deadline reverts with `DeadlineExpired`
- First deposit mints dead shares to `address(1)` — verify
  `vaultShares.balanceOf(address(1)) == 1000`

---

### Phase 2: Curator System and Dynamic Fees — COMPLETE

**Goal:** Curator registration, rebalance, dynamic fee, performance fee.

```
  Curator SA                 CuratedVaultHook              ERC-8004
    |                              |                       IdentityRegistry
    | registerCurator(feeBps, id)  |                            |
    |----------------------------->|                            |
    |                              | ownerOf(id) ------------->|
    |                              |<-- owner == msg.sender ----|
    |                              |                            |
    |                              | store curator              |
    |                              | activeCuratorId = 1        |
    |<-- curatorId = 1 ------------|                            |


  Every swap:

  Swapper                  PoolManager               CuratedVaultHook
    |                            |                          |
    | swap() ------------------>|                          |
    |                            | beforeSwap() ---------->|
    |                            |<-- recommendedFee ------|
    |                            |    (with OVERRIDE flag) |
    |                            |                         |
    |                            | [execute swap at fee]   |
    |                            |                         |
    |                            | afterSwap() ----------->|
    |                            |                         | track volume
    |                            |                         | accrue perf fee
```

**What was built:**
- Curator struct: wallet, erc8004IdentityId, recommendedFee, performanceFeeBps,
  lastRebalanceBlock, active flag
- `registerCurator()` — verifies ERC-8004 identity NFT ownership via live
  IdentityRegistry at 0x8004...BD9e, auto-activates first curator
- `rebalance()` — 5 parameters (newTickLower, newTickUpper, newFee, maxIdleToken0,
  maxIdleToken1), curator-only auth, rate-limited (30 blocks), removes all
  liquidity, updates range+fee, re-adds liquidity, idle balance check
- `beforeSwap` — returns active curator's fee with OVERRIDE_FEE_FLAG
- `afterSwap` — tracks cumulativeVolume, cumulativeFeeRevenue, accruedPerformanceFee
- `claimPerformanceFee()` — curator-only, transfers accrued token0 from hook balance

**Deliverable:** Register curator, rebalance position, dynamic fee on swaps,
performance fees accrue and claimable.

**How to verify before moving on:**
- `forge test` — all curator + rebalance + fee tests pass
- Register curator with valid ERC-8004 identity -> confirm
  `hook.activeCuratorId() == 1` and `hook.curatorByWallet(curatorAddr) == 1`
- Register with wrong identity owner reverts with `IdentityNotOwned`
- Register with performanceFeeBps > 2000 reverts with `InvalidPerformanceFee`
- Double registration reverts with `CuratorAlreadyRegistered`
- Rebalance from curator: tick range changes, fee changes, liquidity re-deployed
- Rebalance from non-curator reverts with `OnlyCurator`
- Rebalance too frequently reverts with `RebalanceTooFrequent`
- Execute a swap -> confirm `hook.cumulativeVolume()` > 0 and
  `hook.cumulativeFeeRevenue()` > 0
- Execute swap -> change curator fee -> swap again -> confirm fee changed
  (compare swap output amounts)
- After swaps, confirm `hook.accruedPerformanceFee()` > 0
- Call `claimPerformanceFee()` from curator -> confirm accrued resets to 0
  and curator received token0
- Call `claimPerformanceFee()` with zero accrued reverts with `NoFeesToClaim`

---

### Phase 3: MetaMask Delegation + Enforcer + OpenClaw Base — COMPLETE

**Goal:** Agent Smart Account delegates scoped authority to Locus Wallet via
custom caveat enforcer. TypeScript delegation scripts + OpenClaw agent base
with CLI tools.

```
  ONE-TIME SETUP:

  Curator Operator (human)
       |
       | (1) Create MetaMask Smart Account
       | (2) Register ERC-8004 identity from Smart Account
       | (3) Smart Account calls registerCurator() on hook
       | (4) Sets up Locus Wallet (ERC-4337, USDC, spending limits)
       |
       | (5) Signs delegation: Agent Smart Account → Locus Wallet
       |       terms = (hookAddr, minFee, maxFee, interval)
       |       allowed: rebalance(), claimPerformanceFee()
       | (6) Configures OpenClaw agent with delegation bytes + keys
       v
  Agent operational. Locus Wallet holds signed delegation.


  RUNTIME (every heartbeat):

  Locus Wallet      DelegationMgr         Enforcer          Smart Account
    |                    |                    |                    |
    | redeemDelegations  |                    |                    |
    |    (signedDeleg,   |                    |                    |
    |     calldata)      |                    |                    |
    |------------------->|                    |                    |
    |                    | validate sig       |                    |
    |                    | beforeHook() ----->|                    |
    |                    |                    | target ok?         |
    |                    |                    | selector ok?       |
    |                    |                    | fee in bounds?     |
    |                    |                    | rate limit ok?     |
    |                    |<-- OK -------------|                    |
    |                    |                    |                    |
    |                    | execute() -------->|------------------->|
    |                    |                    |  hook.rebalance()  |
    |                    |                    |  msg.sender = SA   |


  SUB-DELEGATION (2-hop chain):

  Curator SA ("Alice")
       | Delegation #1: fee [100, 50000], interval 10
       v
  Locus Wallet ("Bob")
       | Delegation #2: fee [500, 20000], interval 60
       | authority = hash(Delegation #1)
       v
  Volatility Agent ("Charlie")
       | Redeems [#1, #2]
       | Enforcer runs twice
       | Effective bounds = INTERSECTION: fee [500, 20000], interval 60
       | msg.sender in hook = Curator SA
```

**What was built (Solidity):**
- `CuratedVaultCaveatEnforcer.sol` (Solidity 0.8.23)
  - `REBALANCE_SELECTOR` and `CLAIM_FEE_SELECTOR` constants
  - `beforeHook()` validates: target, selector, fee bounds, rate limit
  - claimPerformanceFee() path: target check only, no rate limit
  - First-use fix: `lastRebalanceBlock == 0` skips rate limit
  - `afterHook()` no-op
- `rebalance()` auth: curator-only check (depositor path removed)
- 19 enforcer unit tests, 52/52 total tests passing

**What was built (TypeScript):**
- setup.ts — one-time: create SA, register ERC-8004, register curator
- delegation.ts — single delegation lifecycle: sign + redeem for rebalance + claim
- sub-delegation.ts — 3-party chain (SA → Locus Wallet → Volatility Agent)

**What was built (OpenClaw base):**
- workspace/SKILL.md — Phase 3 skill with simple on-chain heuristic, 3 tools
- tools/pool-reader.ts — reads hook state via viem multicall
- tools/execute-rebalance.ts — triggers rebalance via delegation redemption
- tools/claim-fees.ts — triggers fee claim via delegation redemption

**Deliverable:** Enforcer deployed, delegation signed, agent triggers rebalance
within bounds via OpenClaw heartbeat. Sub-delegation chain demonstrated.

**How to verify before moving on:**
- `forge test` — all 52 tests pass (hook + security + enforcer)
- Enforcer: valid rebalance calldata with fee in bounds passes `beforeHook()`
- Enforcer: wrong target reverts `InvalidTarget`
- Enforcer: unknown selector reverts `InvalidFunction`
- Enforcer: fee below minFee reverts `FeeOutOfBounds`
- Enforcer: fee above maxFee reverts `FeeOutOfBounds`
- Enforcer: second call in same block reverts `RebalanceTooFrequent`
- Enforcer: first call always succeeds (lastRebalanceBlock == 0 bypass)
- Enforcer: call succeeds after advancing past minBlockInterval
- Enforcer: rate limit is per delegation hash (different hashes independent)
- Enforcer: `claimPerformanceFee()` selector passes with target-only check
- Enforcer: `claimPerformanceFee()` has no rate limiting (can call repeatedly)
- TypeScript delegation (delegation.ts):
  - Run on Base Sepolia — SA created, delegation signed, rebalance redeemed
  - Verify hook state changed (tick range, fee)
  - Redeem with fee outside bounds -> reverts at enforcer level
- TypeScript sub-delegation (sub-delegation.ts):
  - 3-party chain redeemed, bound intersection enforced
  - Fee outside sub-delegation bounds -> correctly reverts
- OpenClaw agent base:
  - pool-reader outputs valid JSON with correct hook state
  - execute-rebalance triggers successful rebalance via delegation
  - claim-fees works (success if fees exist, correct error if none)
  - OpenClaw loads SKILL.md, invokes pool-reader on first heartbeat
  - Agent reasons about pool state and makes autonomous decision
  - Agent correctly does nothing when pool is healthy
  - Agent correctly rebalances when position needs adjustment
- See phase3-testing.md for full test plan with pass/fail checklist

---

### Phase 4: Venice AI + x402 + Locus + Olas — NOT STARTED

**Goal:** Add intelligence to the OpenClaw agent base. Replace Phase 3's
simple on-chain heuristic with Venice AI analysis, paid market data via
x402/AgentCash, Locus budget management, and Olas Mech cross-checking.
See phase4-implementation-plan.md for full details.

```
  +-------------------------------------------------------------------+
  |                     Agent Loop (every 5 min)                      |
  |                                                                   |
  |   MONITOR                                                         |
  |     Read Base RPC: tick, liquidity, swap volume                   |
  |         |                                                         |
  |         v                                                         |
  |   ANALYZE                                                         |
  |     +------------------+    +------------------+                  |
  |     | Uniswap Trading  |    | x402/AgentCash   |                  |
  |     | API: price quotes|    | market data      |                  |
  |     +--------+---------+    +--------+---------+                  |
  |              |                       |                            |
  |              |    paid via Locus wallet (per-tx + daily limits)   |
  |              |                       |                            |
  |              v                       v                            |
  |     +------------------+    +------------------+                  |
  |     | Venice AI        |    | Olas Mech        |                  |
  |     | (primary brain)  |    | (cross-check)    |                  |
  |     | -> tick range    |    | 10+ requests     |                  |
  |     | -> fee           |    |                  |                  |
  |     | -> confidence    |    |                  |                  |
  |     +--------+---------+    +------------------+                  |
  |              |                                                    |
  |              v                                                    |
  |   DECIDE                                                          |
  |     Different enough from current? --- NO --> IDLE (wait 5 min)   |
  |              | YES                                                |
  |              v                                                    |
  |   EXECUTE                                                         |
  |     Build rebalance calldata with Venice's params                 |
  |     Redeem delegation via DelegationManager                       |
  |              |                                                    |
  |              v                                                    |
  |   REPORT                                                          |
  |     Write performance to ERC-8004 ReputationRegistry              |
  +-------------------------------------------------------------------+
```

**Files to build:**

| File | Purpose | Bounty |
|---|---|---|
| `agent/src/venice.ts` | Venice AI client, prompt engineering, response parsing | Venice |
| `agent/src/uniswap-api.ts` | Uniswap Trading API quotes with real API key | Uniswap |
| `agent/src/x402-client.ts` | AgentCash/x402 micropayment client | Merit |
| `agent/src/locus.ts` | Locus wallet management via MCP | Locus |
| `agent/src/mech-client.ts` | Olas Mech Marketplace requests (min 10) | Olas |
| `agent/src/index.ts` | FSM loop wiring everything together | All |

**Key dependencies:**
- Venice API (OpenAI-compatible at api.venice.ai)
- `@x402/axios` for micropayments
- Locus MCP at mcp.paywithlocus.com
- Uniswap API key from developers.uniswap.org

**Deliverable:** Agent running autonomously. Real Uniswap API TxIDs logged.

**How to verify before moving on:**
- Each integration tested in isolation BEFORE wiring into FSM:
  - `venice.ts`: send a hardcoded pool state prompt -> receive valid JSON
    with tickLower, tickUpper, fee, confidence fields
  - `uniswap-api.ts`: call `/v1/quote` for wstETH/USDC -> receive a valid
    quote response with price, gas estimate. Log the request ID.
  - `x402-client.ts`: make a single x402 API call -> confirm payment
    deducted from wallet, data returned
  - `locus.ts`: check wallet balance via MCP -> confirm USDC balance.
    Make a test payment -> confirm balance decremented.
  - `mech-client.ts`: send one Olas Mech request -> receive a response.
    Track request count (need 10+ total by submission).
- FSM integration test (run agent for 2-3 cycles):
  - MONITOR: agent logs current tick, liquidity, volume from Base RPC
  - ANALYZE: Venice AI called, response logged with recommendation
  - DECIDE: agent compares recommendation to current position
  - EXECUTE: if different, delegation redeemed, rebalance tx confirmed
    on-chain. Verify hook state changed (tick range / fee).
  - Check that Locus wallet was debited for x402 calls
  - Check that at least 1 Uniswap API TxID is logged to file
- Negative test: stop the agent, confirm vault is unaffected (LPs can
  still deposit/withdraw, swaps still work at last-set fee)

---

### Phase 5: Reputation + Additional Identity — NOT STARTED

**Goal:** Write performance data to ERC-8004 ReputationRegistry. Add Self Protocol
and ENS layers.

```
  After each rebalance cycle:

  Agent                   ERC-8004 ReputationRegistry
    |                            (0x8004...8713)
    |                                 |
    | submitFeedback(                 |
    |   curatorIdentityId,            |
    |   { rebalanceCount,             |
    |     avgFeeRevenue,              |
    |     tickAccuracy })             |
    |------------------------------->|
    |                                 | stored permanently on-chain
```

**What to build:**
- REPORT state in agent FSM: compute metrics, call ReputationRegistry
- Self Protocol Agent ID: register via @selfxyz/agent-sdk (optional identity layer)
- ENS/Basenames: register curator Basename (e.g., vault-curator.base.eth)

**Deliverable:** ReputationRegistry receives feedback entries. Basename registered.

**How to verify before moving on:**
- Run agent for one full rebalance cycle on Base Sepolia
- Query ReputationRegistry at 0x8004...8713 on Sepolia block explorer —
  confirm a feedback entry exists for the curator's identity ID
- Verify the feedback payload contains meaningful data (rebalanceCount > 0,
  non-zero feeRevenue, recent timestamp)
- Self Protocol (if integrated): verify curator has a soulbound NFT at
  the Smart Account address via block explorer or Self dashboard
- ENS/Basenames: resolve the registered name (e.g., vault-curator.base.eth)
  via `viem`'s `getEnsName()` — confirm it resolves to the curator SA address
- Verify registerCurator() still works end-to-end (ERC-8004 check remains
  the primary gate; Self is additive, not blocking)

---

### Phase 6: Frontend — NOT STARTED

**Goal:** React dashboard showing the complete vault experience.

```
  +-----------------------------------------------------------------------+
  |                         CuratedLP Dashboard                           |
  |                                                                       |
  |  +----------------------------+  +----------------------------------+ |
  |  |    Vault Overview          |  |    Curator Dashboard             | |
  |  |                            |  |                                  | |
  |  |  TVL: $1.2M               |  |  Agent: vault-curator.base.eth   | |
  |  |  Fee: 0.30%               |  |  Status: Online                  | |
  |  |  24h Volume: $340K        |  |  Last Rebalance: 3 min ago       | |
  |  |  Tick Range: [-120, 120]  |  |  ERC-8004 ID: #42                | |
  |  |                            |  |                                  | |
  |  |  [Deposit]  [Withdraw]    |  |  Venice AI Log:                  | |
  |  |                            |  |  "Widening range due to          | |
  |  +----------------------------+  |   rising vol. Confidence: 87%"   | |
  |                                  |                                  | |
  |  +----------------------------+  |  Locus Spending:                 | |
  |  |    Performance             |  |  Today: $0.42 / $5.00 cap       | |
  |  |                            |  |                                  | |
  |  |  Vault APY: 14.2%         |  |  Delegation Status:              | |
  |  |  Passive APY: 8.1%        |  |  Active, fee [500, 10000]        | |
  |  |  Outperformance: +6.1%    |  |  Rate limit: 10 blocks           | |
  |  |                            |  |                                  | |
  |  |  [APY Chart]              |  |                                  | |
  |  |  [Rebalance History]      |  |                                  | |
  |  +----------------------------+  +----------------------------------+ |
  +-----------------------------------------------------------------------+
```

**Pages:** Vault Overview, Curator Dashboard, Performance Charts
**Integrations:** Wagmi/Viem, Uniswap Trading API, ENS/Basenames resolution

**Deliverable:** Working frontend on localhost, all pages functional.

**How to verify before moving on:**
- Vault Overview page:
  - Displays TVL (reads `hook.totalAssets()`)
  - Displays current fee (reads `hook.getCurrentFee()`)
  - Displays tick range (reads `hook.currentTickLower()` / `currentTickUpper()`)
  - Deposit flow: connect MetaMask, enter amounts, submit tx -> shares appear
  - Withdraw flow: enter share amount, submit tx -> tokens returned
- Curator Dashboard page:
  - Shows curator Basename (ENS resolution working)
  - Shows last rebalance time (reads `curator.lastRebalanceBlock`)
  - Shows Venice AI log (agent writes logs to a shared endpoint or file)
  - Shows Locus spending (reads from Locus API or cached data)
  - Shows delegation status (active/revoked, fee bounds)
- Performance page:
  - Displays cumulativeVolume, cumulativeFeeRevenue, totalSwaps
  - Rebalance history (reads Rebalanced events from hook)
- Cross-browser: test on Chrome + Firefox with MetaMask extension
- All addresses display as Basenames where available

---

### Phase 7: Testing, Demo, and Submission — NOT STARTED

**Goal:** Full integration test, demo recording, hackathon submission.

```
  Integration Test Checklist (Base Sepolia):

  [1] Deploy contracts (hook, shares, enforcer)
  [2] Register curator (ERC-8004 identity check)
  [3] Create MetaMask Smart Account + delegation
  [4] Deposit tokens (Alice)
  [5] Run agent loop (Venice -> x402 -> rebalance via delegation)
  [6] Verify ReputationRegistry feedback entry
  [7] Execute swaps -> verify dynamic fee
  [8] Withdraw (Alice) -> verify tokens returned
  [9] Verify all TxIDs are real (Uniswap bounty requirement)
```

**Demo Script (60 seconds):**
1. "AI curator managing wstETH/USDC on Uniswap v4" — show dashboard
2. "Alice deposits via MetaMask" — show deposit flow
3. "AI analyzes via Venice AI" — show reasoning
4. "Rebalances within delegation bounds" — show tx
5. "Fee adjusts, Alice withdraws anytime" — show control
6. "All costs paid via x402 through Locus" — show payment log

**Submission:** Devfolio, all 8 bounties, public GitHub with README.

**How to verify before submitting:**
- Full end-to-end on Base Sepolia (not fork, actual testnet):
  - [ ] Contracts deployed (hook, shares, enforcer) — addresses logged
  - [ ] Curator registered (ERC-8004 ownerOf check passed on-chain)
  - [ ] MetaMask Smart Account created, delegation signed
  - [ ] Alice deposits -> shares minted
  - [ ] Agent runs 3+ cycles: Venice called, x402 data purchased, rebalance executed
  - [ ] ReputationRegistry has feedback entries
  - [ ] Swaps execute at dynamic fee
  - [ ] Alice withdraws -> tokens returned
  - [ ] All TxIDs are real and verifiable on Sepolia block explorer
- Bounty-specific checks:
  - [ ] Uniswap: API key works, TxIDs logged, public repo with README
  - [ ] MetaMask: delegation + sub-delegation both demonstrated
  - [ ] Venice: API calls logged, recommendations -> on-chain actions
  - [ ] Merit/x402: x402 payments are load-bearing (agent fails without data)
  - [ ] Locus: wallet funded, spending visible, per-tx limits enforced
  - [ ] Olas: 10+ Mech requests logged on marketplace.olas.network
  - [ ] Self: Agent ID NFT visible at curator address (optional)
  - [ ] ENS: Basenames resolve in frontend
- Demo video is 60 seconds, covers all 7 script points
- README includes: architecture diagram, setup instructions, deployed addresses,
  all API integration descriptions

---

## 15. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Venice AI rate-limited or down | Agent can't analyze | Cache last recommendation; fallback model |
| x402 facilitator limit (1000 free tx/month) | Runs out during demo | 1000 is plenty; monitor usage |
| Delegation setup fails on Sepolia | Agent can't rebalance | Test delegation.ts in isolation first |
| Pool has no volume | Can't show APY | Self-generate test swaps |
| ReputationRegistry ABI differs | Breaks reputation writes | Read ABI from explorer first |
| Sub-delegation chain validation fails | Loses MetaMask bounty | Test 2-hop redemption in isolation |
| Biggest risk: Phase 4 | Wiring Venice + x402 + Locus + delegation is most complex | Start Phase 4 early, test each integration independently |
