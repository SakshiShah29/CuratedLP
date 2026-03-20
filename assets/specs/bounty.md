# CuratedLP — Partner Bounty Tally Sheet

**Last updated:** March 20, 2026
**Hackathon:** Synthesis, March 13–22, 2026
**Total targetable prize pool:** ~$33,250 across 8 bounties

Use this file to check off each requirement as you build. Each bounty has hard requirements (must-have) and bonus criteria (nice-to-have).

---

## 1. Venice AI — $11,500

**Track name:** Private Agents, Trusted Actions
**Prize breakdown:** 1st $5,750 (1,000 VVV) · 2nd $3,450 (600 VVV) · 3rd $2,300 (400 VVV)
**Prizes paid in:** VVV tokens (not USD — VVV can be staked for perpetual free inference via DIEM)

**What they want:** Agents that reason over sensitive data without exposure, producing trustworthy outputs for public systems. Private cognition → public consequence.

**Example directions they list:** Private treasury copilots, confidential governance analysts, private deal negotiation agents, onchain risk desks, confidential due diligence agents, private multi-agent coordination systems.

**How CuratedLP fits:** Curator agent uses Venice for private market analysis (zero-retention inference). Strategy reasoning is private, but the output (rebalance tx) is a public on-chain action. This is textbook "private cognition → trusted public action."

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Uses Venice API (`api.venice.ai/api/v1`) | ☐ | OpenAI-compatible. Auth: `Bearer VENICE_API_KEY` |
| 2 | Venice inference is load-bearing (not decorative) | ☐ | Agent cannot decide rebalance params without Venice |
| 3 | Private cognition → public on-chain action | ☐ | Venice recommendation → rebalance() tx on Base Sepolia |
| 4 | Demonstrate zero-retention privacy value | ☐ | Strategy prompts/responses never stored by Venice |

### Technical Details

- **API base:** `https://api.venice.ai/api/v1`
- **Auth:** `Authorization: Bearer VENICE_API_KEY` (get from venice.ai/settings/api)
- **Recommended models:** `qwen3-235b` (strongest reasoning), `zai-org-glm-4.7` (function calling, 128k context), `deepseek-ai-DeepSeek-R1` (chain-of-thought)
- **Venice parameters:** `enable_web_search: "auto"`, `strip_thinking_response: true`
- **Pricing:** Pro account gives $10 API credit on signup. Venice Small: $0.05/$0.15 per M tokens (in/out)
- **SDK:** No proprietary SDK — use OpenAI JS/Python SDK with base URL changed
- **Function calling supported on:** `zai-org-glm-4.7`, `qwen3-4b`, `mistral-31-24b`, `llama-3.3-70b`

---

## 2. Uniswap — $5,000

**Track name:** Agentic Finance (Best Uniswap API Integration)
**Prize breakdown:** 1st $2,500 · 2nd $1,500 · 3rd $1,000

**What they want:** Agents that trade, coordinate, or invent primitives powered by Uniswap. Deep stack integration rewarded.

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Real API key from developers.uniswap.org | ☐ | **MANDATORY — no exceptions** |
| 2 | Functional swaps with real TxIDs (testnet or mainnet) | ☐ | Log all TxIDs to file, include in README |
| 3 | Open source, public GitHub with README | ☐ | Push before submission |
| 4 | **Bonus:** v4 hooks integration | ☐ | CuratedVaultHook = deep v4 hook usage |
| 5 | **Bonus:** AI Skills integration | ☐ | `swap-integration`, `liquidity-planner` from uniswap-ai |
| 6 | **Bonus:** Unichain deployment | ☐ | Optional stretch — separate L2 |
| 7 | **Bonus:** v4 contracts (PoolManager, PositionManager) | ☐ | Direct contract interaction via hook |
| 8 | **Bonus:** Permit2 integration | ☐ | Optional for token approvals |

### Technical Details

- **API endpoint:** `https://trade-api.gateway.uniswap.org/v1/`
- **Auth headers:** `x-api-key: YOUR_KEY` + `x-universal-router-version: 2.0`
- **Key endpoints:** `POST /v1/quote` (price quotes), `POST /v1/swap` (execute swaps)
- **LP operations via API:** "Coming Soon" — must use PositionManager contract directly
- **AI Skills repo:** github.com/Uniswap/uniswap-ai (7 skills including `liquidity-planner`, `swap-planner`)
- **Resources:** developers.uniswap.org, api-docs.uniswap.org, docs.uniswap.org

### Key addresses (Base + Base Sepolia — same addresses)

| Contract | Address |
|---|---|
| PoolManager | `0x498581ff718922c3f8e6a244956af099b2652b2b` |
| PositionManager | `0x7c5f5a4bbd8fd63184577525326123b519429bdc` |
| Universal Router | `0x6ff5693b99212da76ad316178a184ab56d299b43` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |

---

## 3. MetaMask — $5,000

**Track name:** Best Use of Delegations
**Prize breakdown:** 1st $3,000 · 2nd $1,500 · 3rd $500

**What they want:** Creative, novel, meaningful use of MetaMask Delegation Framework. Standard patterns without meaningful innovation will NOT place.

**Dream-tier submissions (from bounty text):**
- Intent-based delegations as a core pattern
- Extend ERC-7715 with sub-delegations or novel permission models
- ZK proofs combined with delegation-based authorization

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Uses MetaMask Delegation Framework | ☐ | Via `@metamask/smart-accounts-kit` or direct contracts |
| 2 | Delegation creation demonstrated | ☐ | Curator SA → Moltbot delegation |
| 3 | Delegation redemption demonstrated | ☐ | Moltbot redeems to call rebalance() |
| 4 | **Innovation required** — standard patterns won't place | ☐ | Custom CuratedVaultCaveatEnforcer is the innovation |
| 5 | **Strong:** Intent-based delegation pattern | ☐ | "Optimize my LP within these bounds" = intent |
| 6 | **Strong:** Sub-delegation chains | ☐ | Curator SA → Moltbot → Volatility Agent (2-hop) |
| 7 | **Strong:** Novel permission models | ☐ | Fee bounds + rate limiting + dual selector enforcer |
| 8 | **Stretch:** ZK proofs + delegation | ☐ | Not currently in spec — would be a differentiator |

### Technical Details

- **Package:** `@metamask/smart-accounts-kit` v0.3.0 (renamed from delegation-toolkit)
- **Scaffold:** `npx @metamask/create-gator-app`
- **Live on:** Base mainnet + Base Sepolia (confirmed, Framework v1.3.0)
- **ERC-7710:** On-chain delegation redemption (`redeemDelegations`)
- **ERC-7715:** Wallet-to-dapp permission request (`wallet_grantPermissions`)
- **Sub-delegation:** `authority: hashDelegation(parentDelegation)` chains cryptographically
- **Custom enforcer:** CuratedVaultCaveatEnforcer validates target, selector, fee bounds, rate limit

### Our Innovation (what makes it non-standard)

- Custom `CuratedVaultCaveatEnforcer` with dual-selector design (rebalance + claimPerformanceFee)
- Packed calldata parsing (`abi.encodePacked` format from ExecutionLib)
- Per-delegation rate limiting with first-use bypass
- Sub-delegation chain: Curator SA → Moltbot → Volatility Agent with progressive permission narrowing
- Same enforcer used at every level with different terms — zero new Solidity for sub-delegation

---

## 4. Merit Systems / x402 — $5,250

**Track name:** Build with x402 (×3 identical bounties)
**Prize breakdown:** 3 tracks × (1st $1,000 · 2nd $500 · 3rd $250)

**What they want:** Projects that meaningfully use the x402 protocol — consuming existing APIs through AgentCash OR producing new x402-compatible endpoints. **x402 payment layer must be load-bearing, not decorative.**

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Uses x402 protocol meaningfully | ☐ | Agent pays for market data via x402 micropayments |
| 2 | x402 is load-bearing (agent fails without it) | ☐ | No market data → no analysis → no rebalance |
| 3 | Consuming existing x402 APIs | ☐ | Via AgentCash bundled routes (280+ endpoints) |
| 4 | **Bonus:** Producing new x402-compatible endpoints | ☐ | Could expose vault analytics as x402-gated API |

### Technical Details

- **x402 protocol:** HTTP 402 Payment Required → client signs USDC payment → retries with X-PAYMENT header
- **Payment method:** EIP-3009 (transferWithAuthorization) for gasless USDC transfers
- **x402 on Base:** `eip155:8453` with USDC
- **CDP facilitator:** `x402.coinbase.com` — 1,000 free transactions/month
- **AgentCash:** Merit's product. Ships as Tessl Skills. Install: `npx tessl i github:Merit-Systems/agentcash-skills --skill email`
- **Execution primitive:** `agentcash.fetch(url, method, body)` auto-handles 402→pay→retry
- **Client libraries:** `@x402/axios` (auto-handler), `x402-fetch` npm package
- **Server middleware:** `paymentMiddleware` from `x402-express`
- **GitHub:** github.com/coinbase/x402 (Apache-2.0, 5.4k stars)
- **AgentCash routes:** 280+ across social intelligence, web research, email, file hosting, image/video gen

---

## 5. Locus — $3,000

**Track name:** Best Use of Locus
**Prize breakdown:** 1st $2,000 · 2nd $500 · 3rd $500

**What they want:** Projects that most meaningfully integrate Locus payment infrastructure. Must use Locus wallets, spending controls, pay-per-use APIs, or vertical tools as CORE to the product. **Automatic disqualification without a working Locus integration.** Base chain, USDC only.

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Working Locus integration (or auto-DQ) | ☐ | Test wallet tx before submission! |
| 2 | On Base chain | ☐ | Base Sepolia / Base mainnet |
| 3 | USDC only | ☐ | All payments in USDC |
| 4 | Locus is core, not bolted on | ☐ | Agent's operational wallet for all spending |
| 5 | Spending controls demonstrated | ☐ | Per-tx max, daily cap, audit trail |
| 6 | **Strong:** Agent autonomy with controls | ☐ | Agent spends autonomously within policy bounds |

### Technical Details

- **Setup:** Create account at app.paywithlocus.com → deploy wallet → create agent identity → set permissions → generate API key
- **MCP server:** `https://mcp.paywithlocus.com/mcp` with Bearer auth (Locus API key)
- **Spending controls:** Per-transaction limits, daily caps, required justifications, agent identities bound to policy groups, approval flows, full audit trails
- **Reference implementation:** github.com/locus-technologies/agentic-commerce-protocol-demo

---

## 6. Self Protocol — $1,000

**Track name:** Best Self Agent ID Integration
**Prize breakdown:** Winner-takes-all $1,000

**What they want:** Best integration of Self Agent ID (`app.ai.self.xyz`). Agent identity must be load-bearing, not decorative. Looking for: soulbound NFT generation, A2A identity verification, Sybil-resistant workflows, or novel uses of human-backed credential verification.

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Uses Self Agent ID | ☐ | Register curator agent at app.ai.self.xyz |
| 2 | Agent identity is load-bearing | ☐ | Curator registration checks Self Agent ID NFT |
| 3 | Soulbound NFT minted for agent | ☐ | Non-transferable ERC-721 |
| 4 | **Bonus:** A2A identity verification | ☐ | Google A2A protocol Agent Cards |

### Technical Details

- **Registration:** app.ai.self.xyz — 5 modes: wallet-based, agent keypair, wallet-free, passkey smart wallet, social login via Privy
- **SDKs:** `@selfxyz/agent-sdk` (npm), `selfxyz-agent-sdk` (pip), `self-agent-sdk` (cargo)
- **MCP server:** `@selfxyz/mcp-server`
- **Soulbound NFT:** Non-transferable ERC-721 on Base (supports 18+ EVM chains including Base)
- **Identity model:** Each passport document maps to unique identifier — one person cannot register unlimited agents

---

## 7. ENS Labs — $1,500

**Track name:** 3 sub-tracks
**Prize breakdown:** ENS Identity (1st $400, 2nd $200) · ENS Communication (1st $400, 2nd $200) · ENS Open Integration ($300)

**What they want:** ENS names replacing hex addresses everywhere. Name registration, agent identity, profile discovery, communication, payments — anywhere a hex address appears, an ENS name should replace it.

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | ENS names establish identity onchain | ☐ | Curator uses Basename (e.g., `vault-curator.base.eth`) |
| 2 | Hex addresses replaced with names in frontend | ☐ | All addresses display as Basenames |
| 3 | ENS is core to the experience | ☐ | Not an afterthought |
| 4 | **Identity track:** Agent identity via ENS | ☐ | Curator identified by Basename |
| 5 | **Communication track:** Payments via ENS names | ☐ | Fee claims resolve curator by name |
| 6 | **Open track:** Any meaningful integration | ☐ | Catch-all |

### Technical Details

- **Basenames:** `*.base.eth` — fully onchain, leveraging ENS infrastructure on Base
- **Forward resolution:** Works cross-chain via CCIP gateway (ENSIP-10)
- **Reverse resolution:** Supported via ENSIP-19 L2 Primary Names on Base
- **On-chain from hook:** L2 resolver contracts are callable from Solidity on Base
- **Register:** base.org/names
- **In frontend:** Use viem's `getEnsName()` / `getEnsAddress()` with Base L2 resolver

---

## 8. Valory / Olas — $1,000 (targeting "Hire an Agent" track only)

**Track name:** Hire an Agent on Olas Marketplace
**Prize breakdown:** 1st $500 · 2nd $300 · 3rd $200

**What they want:** Build a project that incorporates `mech-client` to hire AI agents on the Olas Mech Marketplace. Project's "client agent" on marketplace.olas.network must have completed at least 10 requests.

### Requirements Checklist

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Integrates `mech-client` | ☐ | `pip install mech-client` (Python ≥3.10, <3.12) |
| 2 | At least 10 requests on Mech Marketplace | ☐ | Track count — verify at marketplace.olas.network |
| 3 | Requests on supported chain (Base works) | ☐ | Base is explicitly listed as supported |
| 4 | Client agent visible on marketplace | ☐ | Check marketplace.olas.network for your agent |

### Technical Details

- **Install:** `pip install mech-client`
- **CLI usage:** `mechx request --prompts "your prompt" --priority-mech <address> --tools <tool> --chain-config base`
- **Python usage:** `from mech_client.marketplace_interact import marketplace_interact`
- **Payment:** Supports native token, OLAS, and USDC on Base
- **Quickstart:** build.olas.network/hire
- **Other Olas tracks (not targeting):**
  - "Build an Agent for Pearl" ($1,000) — access-restricted to Accelerator participants
  - "Monetize Your Agent" ($1,000) — requires 50 served requests, high bar for hackathon

---

## Bounties NOT Targeting (and why)

| Bounty | Prize | Reason to Skip |
|---|---|---|
| Octant | $4,000 | Public goods evaluation — doesn't map to LP management |
| cLabs/Celo | $3,000 | Must build ON Celo — our project is on Base |
| Bonfires.ai | $3,000 | No public API or SDK found — integration risk too high |
| SuperRare | $2,500 | NFT art focus — completely different domain |
| Slice | $2,200 | ERC-8128 auth / commerce — doesn't map to LP |
| Status Network | $2,000 | Must deploy on Status Sepolia (different chain). Prize split among up to 40 teams = ~$50/team |
| Companion Lab/Bankr | $1,750 | End-user wallet management — our agent already handles execution directly |
| bond.credit | $1,500 | Requires live trading on GMX perps — different project |
| Arkhai | $900 | Python SDK archived Feb 2026. Escrow integration possible but effort/reward ratio poor |

---

## Pre-Submission Verification Checklist

Run through this the day before submission. Every "MANDATORY" item must pass or you lose that bounty entirely.

| Check | Bounty | Mandatory? | Pass? |
|---|---|---|---|
| Uniswap API key returns valid quote in curl | Uniswap | **YES** | ☐ |
| Real swap TxIDs logged to file and in README | Uniswap | **YES** | ☐ |
| Public GitHub repo with README | Uniswap | **YES** | ☐ |
| MetaMask delegation created + redeemed on-chain | MetaMask | **YES** | ☐ |
| Custom CuratedVaultCaveatEnforcer deployed | MetaMask | **YES** | ☐ |
| Sub-delegation chain demonstrated (2-hop) | MetaMask | Strong bonus | ☐ |
| Venice API calls in agent logs | Venice | **YES** | ☐ |
| Venice recommendation → on-chain rebalance tx | Venice | **YES** | ☐ |
| x402 payments visible in agent payment log | Merit | **YES** | ☐ |
| Agent cannot function without x402 data | Merit | **YES** | ☐ |
| Locus wallet tx confirmed on Base | Locus | **YES (auto-DQ)** | ☐ |
| Locus spending controls visible (per-tx, daily cap) | Locus | **YES** | ☐ |
| All Locus txs in USDC on Base | Locus | **YES** | ☐ |
| Self Agent ID NFT at curator address | Self | Strong bonus | ☐ |
| Curator registration checks Self identity | Self | For "load-bearing" claim | ☐ |
| All addresses display as Basenames in frontend | ENS | **YES** | ☐ |
| Basename registered for curator | ENS | **YES** | ☐ |
| ≥10 Mech requests on marketplace.olas.network | Olas | **YES** | ☐ |
| mech-client integrated in agent code | Olas | **YES** | ☐ |
| ERC-8004 IdentityRegistry check in registerCurator() | ERC-8004 | Core to project | ☐ |
| ERC-8004 ReputationRegistry receives feedback entries | ERC-8004 | Core to project | ☐ |
| 60-second demo video recorded | All | **YES** | ☐ |
| Devfolio submission complete for all 8 bounties | All | **YES** | ☐ |

---

## Current Build Status vs. Bounty Requirements

| Bounty | Solidity Done? | TypeScript Done? | Frontend Done? | Integration Tested? |
|---|---|---|---|---|
| Venice AI | N/A | ☐ Phase 4 | ☐ Phase 6 | ☐ |
| Uniswap | ✅ Hook complete (52 tests) | ☐ Phase 4 (uniswap-api.ts) | ☐ Phase 6 | ☐ |
| MetaMask | ✅ Enforcer complete (19 tests) | ✅ delegation.ts + sub-delegation.ts (corrected) | N/A | ☐ |
| Merit/x402 | N/A | ☐ Phase 4 (x402-client.ts) | N/A | ☐ |
| Locus | N/A | ☐ Phase 4 (locus.ts) | ☐ Phase 6 | ☐ |
| Self Protocol | N/A | ☐ Phase 5 | N/A | ☐ |
| ENS | N/A | N/A | ☐ Phase 6 | ☐ |
| Olas | N/A | ☐ Phase 5 (mech-client.ts) | N/A | ☐ |
| **ERC-8004** | ✅ Interfaces + registerCurator() | ☐ Phase 5 (reputation writes) | N/A | ☐ |

**Summary:** Solidity is 100% complete (Phases 0-3). MetaMask delegation TypeScript is written and corrected. Everything else (Phase 4-7) is pending — Venice, x402, Locus, Olas, Self, ENS, frontend, and integration testing.
