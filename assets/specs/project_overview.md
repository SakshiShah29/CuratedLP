# CuratedLP — High Level Project Overview
*Last updated: 2026-03-17*

---

## What It Is

A Uniswap v4 hook on Base that turns a standard liquidity pool into an AI-managed vault. Human LPs deposit tokens and choose an AI curator agent. The curator continuously analyzes market conditions using Venice AI and rebalances the concentrated liquidity position. The human retains full withdrawal rights at all times. The curator earns a performance fee only when it outperforms passive LP returns.

---

## The Three Actors

| Actor | Role |
|---|---|
| **Human LP (Alice)** | Deposits wstETH + USDC. Receives vault shares. Creates a MetaMask delegation expressing her intent (fee bounds, rate limits). Can withdraw anytime. Never interacts with the agent directly. |
| **AI Curator Agent (OpenClaw Moltbot)** | Registers in the hook via ERC-8004 identity check. Runs an FSM every 5 minutes using Venice AI for analysis. Executes rebalances by redeeming Alice's delegation. Earns performance fee only if it beats passive LP. |
| **Swapper (Bob)** | Trades through the pool normally. Pays the dynamic fee set by the curator. Unaware of vault mechanics. |

---

## Complete Flow

### Setup (One Time)
1. **Curator agent registers** — calls `registerCurator()` from its EOA. Hook verifies ERC-8004 identity NFT ownership on Base Sepolia. Stores curator EOA, performance fee %, ERC-8004 ID. First curator auto-becomes `activeCuratorId`.

### Alice's Journey
2. **Alice creates a MetaMask Smart Account** — her EOA controls a DeleGator account (`0xAliceSmartAccount`)
3. **Alice deposits** — calls `deposit(amount0, amount1)`. Hook mints vault shares to Alice. Hook adds liquidity to pool at current tick range.
4. **Alice creates a delegation to the curator** — signs delegation `0xAliceSmartAccount → curatorEOA` with caveat terms (fee bounds, rate limit, target = this hook). This is Alice's **expressed intent** on-chain. She never needs to interact again.

### Daily Agent Loop (Every 5 Minutes)
5. **MONITOR** — reads Base RPC for current tick, liquidity, swap volume
6. **ANALYZE** — calls Uniswap Trading API for price quotes, buys market data via x402/AgentCash (paid from Locus wallet), sends all data to Venice AI → gets tick range + fee recommendation
7. **DECIDE** — if recommendation differs enough from current position, proceed
8. **EXECUTE** — agent calls `DelegationManager.redeemDelegations()` with Alice's signed delegation + rebalance calldata
   - DelegationManager validates Alice's signature
   - Calls `beforeHook` on `CuratedVaultCaveatEnforcer`: target ✅, selector ✅, fee in bounds ✅, rate limit ✅
   - Executes `rebalance()` on behalf of Alice's Smart Account
   - `msg.sender` in hook = `0xAliceSmartAccount` → depositor path ✅
   - Hook removes all liquidity, updates tick range + fee, re-adds all liquidity
9. **REPORT** — writes performance data to ERC-8004 ReputationRegistry on-chain

### Sub-Delegation Chain (MetaMask Bounty Differentiator)
During high volatility, curator (Bob) sub-delegates to a volatility agent (Charlie):
```
Alice → Bob (fee 0.01%-5%, 30 blocks)
           ↓ sub-delegates
        Charlie (fee 0.5%-2%, 60 blocks)
```
- Charlie passes the full chain `[AliceToBob, BobToCharlie]` when redeeming
- DelegationManager runs both enforcers — Charlie is constrained by the **intersection** of both bound sets
- Zero new Solidity needed — same enforcer contract, different `_terms`

### Ongoing
- **Swaps** — `beforeSwap` returns `curators[activeCuratorId].recommendedFee` as dynamic fee every swap
- **Alice withdraws** — burns shares anytime, hook removes proportional liquidity, tokens returned
- **Curator claims fees** — calls `claimPerformanceFee()` to collect earnings after outperforming benchmark

---

## Partner Integrations — How & When

| Partner | Prize | Phase | Integration |
|---|---|---|---|
| **Uniswap** | $5,000 | Phase 0-2 (done) + Phase 4 | v4 hook is the core product. Trading API for price quotes in agent FSM. AI Skills (liquidity-planner, swap-planner) in analysis step. |
| **Venice AI** | $11,500 | Phase 4 | Agent's brain. Every FSM cycle, pool state + market data → Venice → tick range + fee recommendation → on-chain rebalance. |
| **MetaMask** | $5,000 | Phase 3 | Alice creates DeleGator Smart Account, delegates `rebalance()` authority to curator with caveat terms. Sub-delegation chain (Bob→Charlie) is the bounty differentiator. `CuratedVaultCaveatEnforcer` is the custom Solidity piece. |
| **Merit/x402** | $5,250 | Phase 4 | Agent pays for market data (price feeds, sentiment, volatility) via x402 micropayments using `@x402/axios`. Load-bearing — agent cannot function without this data. |
| **Locus** | $3,000 | Phase 4 | Agent's operational wallet. Funds all x402 payments. Per-transaction and daily spending controls enforced. Integrated via MCP server at `mcp.paywithlocus.com`. |
| **Olas** | $1,000 | Phase 4 | `mech-client` used in ANALYZE step. At least 10 requests to Olas Mech Marketplace as secondary market analysis input alongside Venice AI. |
| **Self Protocol** | $1,000 | Phase 5 | Curator agent registers soulbound NFT identity via `@selfxyz/agent-sdk`. Optional secondary check in `registerCurator()` on top of ERC-8004. |
| **ENS** | $1,500 | Phase 6 | Frontend only. Curator agents get a Basename (e.g., `vault-curator.base.eth`). All addresses in UI resolve to names via Base L2 resolver. |

**Total targetable: $33,250**

---

## Role of Each Partner in the Product

| Partner | Role |
|---|---|
| **Uniswap** | The infrastructure — the pool, the hook, the LP mechanics. Everything runs on top of Uniswap v4. |
| **MetaMask** | The permission layer — Alice expresses intent via delegation terms. Agent operates freely within those bounds. Without this, the agent would need Alice's private key. |
| **Venice AI** | The intelligence layer — makes the actual rebalance decisions. Without Venice, the agent has no brain. |
| **Merit/x402** | The data access layer — gives the agent real-time market data to feed Venice. Without x402, Venice is flying blind. |
| **Locus** | The payment infrastructure for the agent — manages the agent's operational budget autonomously with guardrails. |
| **Olas** | Secondary intelligence input — cross-checks Venice's recommendations with Mech Marketplace agents. |
| **Self Protocol** | Identity layer for agents — gives the curator a verifiable, on-chain identity beyond ERC-8004. |
| **ENS** | UX layer — makes the frontend human-readable. Not load-bearing for core function. |

---

## Sub-Delegation: What Code Is Required

Sub-delegation requires **no extra Solidity**. The `DelegationManager` handles chain validation automatically.

When Charlie redeems `[AliceToBob, BobToCharlie]`, the DelegationManager:
1. Validates Alice's signature on the first delegation
2. Validates Bob's signature on the second delegation
3. Checks `BobToCharlie.authority == hash(AliceToBob)` — cryptographic chain link
4. Runs `beforeHook` on Alice's enforcer (Alice's bounds)
5. Runs `beforeHook` on Bob's enforcer (Bob's tighter bounds)
6. If both pass → executes `rebalance()` on behalf of Alice's Smart Account

The same `CuratedVaultCaveatEnforcer` handles both levels with different `_terms`. Intersection of bounds is automatic.

Full checklist:

| What | Where | Status |
|---|---|---|
| `rebalance()` accepts depositors (isDepositor path) | `CuratedVaultHook.sol` | ❌ Small change needed |
| `CuratedVaultCaveatEnforcer` | `src/` | ✅ Done |
| `delegation.ts` — Alice → Bob setup + redemption | `agent/src/` | ❌ TypeScript |
| `sub-delegation.ts` — Bob → Charlie chain | `agent/src/` | ❌ TypeScript |

---

## Current Build Status

**Hackathon deadline: March 22, 2026**

### Solidity (~80% done)

| Component | Status |
|---|---|
| Hook: deposit, withdraw, beforeSwap, afterSwap | ✅ Done |
| Hook: registerCurator with ERC-8004 check | ✅ Done |
| Hook: rebalance() (5-param, security audited) | ✅ Done |
| CuratedVaultCaveatEnforcer (5-param selector) | ✅ Done |
| Security audit — 8 findings fixed | ✅ Done |
| Hook: rebalance() auth — accept depositors | ❌ Small change needed |
| Hook: claimPerformanceFee() | ❌ Not implemented |
| test/CuratedVaultCaveatEnforcer.t.sol | ❌ Not written |

### Agent / TypeScript (0% done)

| Component | Status |
|---|---|
| delegation.ts (Alice → Curator setup + redemption) | ❌ |
| sub-delegation.ts (Bob → Charlie chain) | ❌ |
| venice.ts (Venice AI market analysis) | ❌ |
| uniswap-api.ts (Trading API price quotes) | ❌ |
| x402-client.ts (AgentCash market data payments) | ❌ |
| locus.ts (agent wallet management) | ❌ |
| mech-client.ts (Olas Mech requests) | ❌ |
| index.ts (FSM agent loop — wires everything) | ❌ |

### Frontend (0% done)

| Component | Status |
|---|---|
| Vault overview + deposit/withdraw UI | ❌ |
| Curator dashboard + Venice AI logs | ❌ |
| ENS/Basenames resolution | ❌ |

---

## Priority Order for Remaining 5 Days

| Day | Goal | Bounties Locked |
|---|---|---|
| Day 1 (Mar 17) | rebalance() auth fix + claimPerformanceFee() + enforcer tests | Solidity complete |
| Day 2 (Mar 18) | delegation.ts + sub-delegation.ts | MetaMask bounty |
| Day 3 (Mar 19) | Venice AI + FSM agent loop | Venice bounty |
| Day 4 (Mar 20) | x402 + Locus + Uniswap Trading API + Olas mech-client | Merit + Locus + Uniswap + Olas bounties |
| Day 5 (Mar 21) | Frontend + Self Protocol + ENS + demo recording + submission | All remaining bounties |

**Biggest risk**: The agent loop — wiring Venice + x402 + Locus + MetaMask delegation redemption together is the most complex piece with the most unknowns.

---

## Key Contract Addresses (Base Sepolia)

| Contract | Address |
|---|---|
| Uniswap v4 PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| Uniswap v4 PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| ERC-8004 IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ERC-8004 ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Chainlink wstETH/stETH Rate | `0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061` |
| Locus MCP | `https://mcp.paywithlocus.com/mcp` |
