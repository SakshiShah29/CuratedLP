# Curator-Agent Identity Model — CuratedLP

*Last updated: 2026-03-20*

---

## 1. The Core Question

Who is the curator? Who is the agent? Are they the same entity?

This document resolves that question definitively. Every other spec
in the project should be read through the lens of this document.

---

## 2. The One-Sentence Answer

The curator IS the AI agent. The "curator" is a role the agent holds
in the vault. The agent has two on-chain addresses — one for identity
and execution, one for data spending — connected by a MetaMask
delegation.

---

## 3. The Two On-Chain Addresses

```
  +-----------------------------------+     +-----------------------------------+
  |  Agent Smart Account              |     |  Locus Wallet                     |
  |  (identity + execution)           |     |  (trigger + data spending)        |
  |                                   |     |                                   |
  |  MetaMask DeleGator               |     |  ERC-4337 smart wallet            |
  |  Permanent                        |     |  Replaceable                      |
  |                                   |     |                                   |
  |  Holds ERC-8004 identity NFT      |     |  Triggers delegation redemption   |
  |  Registered as curator in hook    |     |  (calls DelegationManager)        |
  |  Holds ETH for gas                |     |                                   |
  |  Executes rebalance/claim on hook |     |  Pays for x402 data (USDC)       |
  |  Reputation accrues here          |     |  Pays for Olas Mech (USDC)       |
  |  ENS/Basename resolves here       |     |  Per-tx + daily budget controls   |
  |  Recoverable by human operator    |     |  Gasless via paymaster            |
  |                                   |     |                                   |
  |  This IS the agent on-chain       |     |  This is HOW the agent spends     |
  |                                   |     |  and triggers actions             |
  +-----------------------------------+     +-----------------------------------+
                |                                         ^
                |                                         |
                |  MetaMask Delegation                    |
                |  "Locus Wallet may trigger              |
                |   rebalance() + claimPerformanceFee()   |
                |   within fee bounds [500, 10000]        |
                |   max once per 10 blocks"               |
                +-----------------------------------------+
```

The Locus wallet is controlled by a private key held in the OpenClaw
runtime. That key is an implementation detail of ERC-4337 — it signs
UserOperations but is not itself an on-chain entity. If it's
compromised, the human operator revokes the delegation and assigns
a new Locus wallet. The Smart Account, curator registration, identity,
and reputation are unaffected.

---

## 4. Why This Split

The agent's identity (Smart Account) is separated from its operational
trigger (Locus Wallet) for three reasons:

**Key rotation without identity loss**

```
  Locus wallet key compromised
       |
       v
  Human revokes delegation to old Locus Wallet
  Human sets up new Locus wallet
  Human signs new delegation: Agent Smart Account → new Locus Wallet
       |
       v
  Agent resumes with:
    - Same Smart Account address
    - Same ERC-8004 identity
    - Same curator registration
    - Same reputation history
    - Same Basename
    - New operational wallet
```

**On-chain guardrails via the enforcer**

The CuratedVaultCaveatEnforcer runs on every delegation redemption.
Even if the OpenClaw LLM hallucinates a bad action, the enforcer
blocks it on-chain. Fee bounds and rate limits are enforced
cryptographically, not by trusting the agent's logic.

**Human-defined bounds for AI autonomy**

The human operator signs the delegation and sets the bounds. The AI
agent operates freely within those bounds but cannot exceed them. This
is the core value of the delegation architecture — the human defines
the mandate, the AI executes within it.

---

## 5. The Agent IS the Curator

In the CuratedVaultHook, the "curator" is whoever is stored in
curatorByWallet. In CuratedLP, that address is the Agent Smart Account.

```
  CuratedVaultHook sees:

  curatorByWallet[Agent Smart Account] = 1
  activeCuratorId = 1
  curators[1].wallet = Agent Smart Account
  curators[1].erc8004IdentityId = agent's identity NFT
```

The hook doesn't know or care that this address belongs to an AI agent.
It just knows: this is the registered curator, it owns an ERC-8004
identity NFT, and it's allowed to rebalance.

When the Locus wallet triggers a delegation redemption, the
DelegationManager executes the action via the Agent Smart Account.
The hook sees msg.sender = Agent Smart Account = the registered curator.

---

## 6. How the Delegation Executes

```
  Locus Wallet (trigger)
       |
       | Calls DelegationManager.redeemDelegations(
       |   signedDelegation,     <-- signed by human during setup
       |   rebalanceCalldata     <-- built by OpenClaw this heartbeat
       | )
       v
  MetaMask DelegationManager
       |
       | (1) Validates Smart Account's signature on delegation
       | (2) Calls CuratedVaultCaveatEnforcer.beforeHook()
       |       - target == hook address?
       |       - selector == rebalance() or claimPerformanceFee()?
       |       - fee within [500, 10000]?
       |       - rate limit respected?
       | (3) Calls Agent Smart Account.execute(hook, calldata)
       v
  Agent Smart Account
       |
       | Regular CALL to the hook (not delegatecall)
       | Pays gas from its ETH balance
       v
  CuratedVaultHook.rebalance()
       |
       | msg.sender = Agent Smart Account
       | curatorByWallet[msg.sender] == activeCuratorId ✓
       | Rebalance executes
```

---

## 7. What Each Partner Sees

Each partner integration sees a different face of the same agent.

```
  +------------------------------------------------------------------+
  |                                                                  |
  |  ERC-8004 IdentityRegistry                                      |
  |    sees: Agent Smart Account                                     |
  |    role: "This is a registered agent with on-chain identity"     |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  ERC-8004 ReputationRegistry                                     |
  |    sees: Agent Smart Account (via identity NFT)                  |
  |    role: "This agent has a verifiable performance track record"   |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  CuratedVaultHook                                                |
  |    sees: Agent Smart Account (as msg.sender via delegation)      |
  |    role: "This is the registered curator, authorized to act"     |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  CuratedVaultCaveatEnforcer                                      |
  |    sees: Delegation + execution calldata                         |
  |    role: "Validates fee bounds, rate limit, target, selector"    |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  MetaMask DelegationManager                                      |
  |    sees: Agent Smart Account (delegator) + Locus Wallet (trigger)|
  |    role: "Routes authorized actions from trigger to executor"    |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  Venice AI                                                       |
  |    sees: API calls from OpenClaw runtime                         |
  |    role: "Analyzes market data, recommends tick range + fee"     |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  AgentCash / x402 endpoints                                      |
  |    sees: Locus Wallet (USDC payment)                             |
  |    role: "Sells market data for micropayments"                   |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  Locus                                                           |
  |    sees: Locus Wallet                                            |
  |    role: "Manages agent spending with per-tx + daily limits"     |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  Olas Mech Marketplace                                           |
  |    sees: Locus Wallet (USDC payment for mech requests)           |
  |    role: "Provides AI analysis for cross-checking Venice"        |
  |                                                                  |
  +------------------------------------------------------------------+
  |                                                                  |
  |  LP Alice                                                        |
  |    sees: vault-curator.base.eth (Basename on Agent Smart Acct)   |
  |    role: "Deposits tokens into the vault the agent manages"      |
  |                                                                  |
  +------------------------------------------------------------------+
```

---

## 8. Setup: Who Does What

The human operator is involved once during setup, then steps back.
Everything the human does is on behalf of the agent — setting up the
agent's on-chain presence.

```
  Human Operator (one-time setup)
       |
       |  Step 1: Create Agent Smart Account
       |  (MetaMask DeleGator — this becomes the agent's identity)
       |
       |  Step 2: Fund Smart Account with ETH
       |  (for gas on rebalance/claim transactions)
       |
       |  Step 3: Register ERC-8004 identity from Agent Smart Account
       |  (Agent Smart Account calls IdentityRegistry.register()
       |   and receives the identity NFT)
       |
       |  Step 4: Register as curator from Agent Smart Account
       |  (Agent Smart Account calls hook.registerCurator()
       |   The hook stores curatorByWallet[AgentSmartAcct] = 1)
       |
       |  Step 5: Set up Locus wallet
       |  (Register wallet, fund with USDC, set spending limits)
       |
       |  Step 6: Sign delegation from Agent Smart Account → Locus Wallet
       |  (Scoped: rebalance() + claimPerformanceFee()
       |   Bounds: fee [500, 10000], rate limit 10 blocks
       |   Human decides these bounds — the agent's mandate)
       |
       |  Step 7: Configure and start OpenClaw agent
       |  (Locus wallet key + signed delegation bytes +
       |   contract addresses + API keys → agent config)
       |
       v
  DONE — Human walks away.

  Human returns ONLY for:
    - Revoking delegation (emergency: wallet key leaked)
    - Signing new delegation (changed bounds or new Locus wallet)
    - Topping up Locus wallet (agent running low on USDC)
    - Topping up Smart Account (running low on ETH for gas)
```

---

## 9. Runtime: The Agent Acts Alone

After setup, the agent operates without human involvement.

```
  OpenClaw Runtime (every 5 minutes)
       |
       |  OBSERVE
       |    Reads pool state via RPC (free, no tx)
       |    Checks Locus budget via API (free, no tx)
       |
       |  REASON + ANALYZE
       |    Decides what data to fetch based on budget + cache freshness
       |    Locus wallet pays for x402 market data (USDC, gasless)
       |    Locus wallet pays for Olas Mech requests (USDC, gasless)
       |    Calls Uniswap Trading API (free, keyed)
       |    Sends all data to Venice AI (API call, no tx)
       |
       |  DECIDE
       |    Reasons about whether to act
       |
       |  ACT (if warranted)
       |    Locus wallet triggers DelegationManager.redeemDelegations()
       |    DelegationManager → Enforcer → Agent Smart Account → Hook
       |    Smart Account pays gas (ETH)
       |    msg.sender in hook = Agent Smart Account = curator
       |
       |  REFLECT
       |    Writes performance to ERC-8004 ReputationRegistry
       |    (reputation accrues to Agent Smart Account)
       |    Logs cycle results + payment tx hashes
```

---

## 10. Sub-Delegation: Agent Coordination

The sub-delegation chain extends naturally from this model. The primary
agent can delegate a subset of its authority to a specialist.

```
  Agent Smart Account
  (curator, wide authority)
       |
       | Delegation #1
       | fee [500, 10000], interval 10 blocks
       v
  Locus Wallet (primary agent trigger)
  (general-purpose market analysis via OpenClaw)
       |
       | Sub-delegation #2
       | fee [2000, 8000], interval 5 blocks
       | authority = hash(Delegation #1)
       v
  Volatility Agent Wallet (specialist trigger)
  (high-frequency adjustments during extreme conditions)
       |
       | Redeems chain: [Delegation #1, Sub-delegation #2]
       | DelegationManager validates both signatures
       | Enforcer runs twice:
       |   #1: fee in [500, 10000]? interval >= 10?
       |   #2: fee in [2000, 8000]? interval >= 5?
       | Effective bounds = intersection: fee [2000, 8000], interval 10
       |
       v
  Agent Smart Account executes rebalance()
  (msg.sender = Agent Smart Account = curator)
```

Both delegation levels use the same CuratedVaultCaveatEnforcer with
different terms. The specialist operates within tighter bounds than
the primary agent. Zero new Solidity required.

---

## 11. How LPs See the Agent

From an LP's perspective, the complexity above is invisible.

```
  Alice's view:

  +-----------------------------------------------------+
  |  CuratedLP Vault — wstETH/USDC                      |
  |                                                      |
  |  Curator: vault-curator.base.eth                     |
  |  Identity: ERC-8004 #42 (verified)                   |
  |  Performance: 14.2% APY (vs 8.1% passive)            |
  |  Rebalances: 42 (last: 3 minutes ago)                |
  |  Fee: 0.30% (curator-managed, dynamic)               |
  |  Performance fee: 10% of LP fee revenue              |
  |                                                      |
  |  [Deposit]  [Withdraw]                               |
  +-----------------------------------------------------+
```

Alice doesn't know about the Smart Account, the Locus wallet, the
delegation, the enforcer, or the OpenClaw runtime. She sees:
- A curator with a verifiable identity and track record
- A vault with good returns
- Buttons to deposit and withdraw

---

## 12. Terminology Reference

To avoid confusion across all specs, these terms have precise meanings:

| Term | Meaning |
|---|---|
| **The agent** | The AI entity as a whole — its reasoning (OpenClaw), its identity (Smart Account), and its operational wallet (Locus) |
| **The curator** | The role the agent holds in the hook — the address stored in curatorByWallet. This is the Agent Smart Account address. |
| **Agent Smart Account** | MetaMask DeleGator. The agent's permanent on-chain identity. Holds ERC-8004 NFT. Registered as curator. Holds ETH for gas. Reputation accrues here. |
| **Locus Wallet** | ERC-4337 smart wallet on Base. The delegate in the delegation. Triggers delegation redemptions. Pays for x402 data and Olas Mech requests (USDC). Has per-tx and daily spending limits. Replaceable. |
| **Human operator** | The person who sets up the agent's on-chain presence. Involved once during setup. Signs the delegation (sets the bounds). Retains emergency recovery access to the Smart Account. |
| **Delegation** | The signed permission from Agent Smart Account to Locus Wallet. Scoped to rebalance() + claimPerformanceFee() with fee bounds and rate limits. The human operator signs this and defines the bounds — the agent's mandate. |
| **The enforcer** | CuratedVaultCaveatEnforcer. Validates every delegated action on-chain. The agent's guardrail that works even if the reasoning layer fails. |

---

## 13. Summary Diagram

```
  +-----------------------------------------------------------------------+
  |                                                                       |
  |                          "The Agent"                                  |
  |                                                                       |
  |   IDENTITY + EXECUTION          REASONING          TRIGGER + SPENDING |
  |   +-------------------+     +---------------+     +-----------------+ |
  |   |                   |     |               |     |                 | |
  |   | Agent Smart Acct  |     | OpenClaw      |     | Locus Wallet    | |
  |   |                   |     | Runtime       |     |                 | |
  |   | ERC-8004 NFT      |     |               |     | Triggers deleg  | |
  |   | Curator role      | <-- | Venice AI     | --> | redemption      | |
  |   | Reputation        |     | Olas Mech     |     | Pays x402 (USDC)| |
  |   | Basename          |     | x402 data     |     | Pays Olas (USDC)| |
  |   | Holds ETH (gas)   |     | Uniswap quote |     | Budget controls | |
  |   | Executes on hook  |     | Reasoning     |     | Gasless (4337)  | |
  |   |                   |     |               |     |                 | |
  |   +-------------------+     +---------------+     +-----------------+ |
  |          |                                               |            |
  |          |  delegation (signed by human operator)        |            |
  |          +-----------------------------------------------+            |
  |                                                                       |
  |   On-chain actions:                    Off-chain actions:             |
  |     hook.rebalance()                     Venice AI API                |
  |     hook.claimPerformanceFee()           AgentCash x402 endpoints    |
  |     ReputationRegistry.submit()          Olas Mech CLI               |
  |     (all via Smart Account,              Uniswap Trading API         |
  |      gas paid in ETH)                    (all via Locus wallet       |
  |                                           or free API calls)         |
  +-----------------------------------------------------------------------+
                                    ^
                                    |
                           All one agent.
                           Two addresses.
                           Different roles.
```
