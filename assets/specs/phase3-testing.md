# Phase 3 Testing — Delegation + OpenClaw Base

*Last updated: 2026-03-20*

---

## 1. What We're Testing

Phase 3 has two parts that need to be validated before moving to Phase 4:

**Part A — Delegation mechanics (TypeScript)**
The setup, signing, and redemption of MetaMask delegations. This was
built in `agent/src/setup.ts`, `delegation.ts`, and `sub-delegation.ts`.

**Part B — OpenClaw agent base**
The SKILL.md, CLI tools (pool-reader, execute-rebalance, claim-fees),
and the heartbeat cycle. This validates that OpenClaw can invoke our
tools and make autonomous decisions — before we add Venice AI, x402,
Locus, or Olas in Phase 4.

---

## 2. Prerequisites

Before testing, the following must be in place:

```
  What                              How to verify
  +-------------------------------+------------------------------------------+
  |                               |                                          |
  | Contracts deployed on         | HOOK_ADDRESS and ENFORCER_ADDRESS are    |
  | Base Sepolia                  | set in agent/.env and respond to         |
  |                               | eth_call (not zero address)              |
  |                               |                                          |
  | Pool initialized with         | pool-reader returns totalLiquidity > 0   |
  | deposits (Alice deposited)    | and activeCuratorId > 0                  |
  |                               |                                          |
  | Curator EOA funded with       | Check balance on Sepolia explorer        |
  | Base Sepolia ETH              | Faucet: coinbase.com/faucets/           |
  |                               |     base-ethereum-sepolia-faucet         |
  |                               |                                          |
  | Agent .env configured         | All required vars in agent/.env          |
  |   CURATOR_PRIVATE_KEY         | (see agent/.env.example)                 |
  |   MOLTBOT_PRIVATE_KEY         |                                          |
  |   BASE_SEPOLIA_RPC            |                                          |
  |   HOOK_ADDRESS                |                                          |
  |   ENFORCER_ADDRESS            |                                          |
  |   PIMLICO_API_KEY             |                                          |
  |                               |                                          |
  | Dependencies installed        | Run: bun install                         |
  |                               | Verify: no errors                        |
  +-------------------------------+------------------------------------------+
```

---

## 3. Part A — Delegation Mechanics Testing

These tests validate the MetaMask delegation lifecycle end-to-end
on Base Sepolia. Each test is run manually via the command line.

### Test A1: Curator Setup

**What it does:** Creates the Agent Smart Account, mints ERC-8004
identity NFT, and registers as curator on the hook.

**Run:**
  bun run src/setup.ts

**Expected output:**
- Curator EOA address printed
- Curator Smart Account address derived and printed
- If SA needs funding, ETH transferred from EOA to SA
- ERC-8004 identity NFT minted (tokenId printed)
- registerCurator() called on the hook
- "Setup Complete" with ERC8004_IDENTITY_ID to add to .env

**Verify on-chain:**
- Query IdentityRegistry.ownerOf(tokenId) — should return the SA address
- Query hook.curatorByWallet(SA address) — should return the curatorId
- Query hook.activeCuratorId() — should equal the curatorId

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "Curator EOA needs ETH" | Faucet not used | Get Sepolia ETH from Coinbase faucet |
| "PIMLICO_API_KEY not set" | Missing env var | Get key from dashboard.pimlico.io |
| UserOp reverts | SA not deployed | First UserOp deploys SA; if it fails, check Pimlico dashboard for error details |
| "Already registered" | Previous run succeeded | Not an error — setup.ts is idempotent |

**After success:** Add the printed ERC8004_IDENTITY_ID to agent/.env.

---

### Test A2: Single Delegation (Curator SA → Agent EOA)

**What it does:** Signs a delegation from the Curator Smart Account to
the Moltbot EOA, then redeems it to call rebalance() on the hook.

**Run:**
  bun run src/delegation.ts

**Expected output:**
- Curator Smart Account and Moltbot EOA addresses printed
- Moltbot funded with ETH if balance is low
- Delegation signed with caveat bounds (fee [100, 50000], interval 30)
- Rebalance calldata encoded (tick [-1200, 1200], fee 3000)
- DelegationManager.redeemDelegations() tx submitted
- "Rebalance executed" with tx hash

**Verify on-chain:**
- Query hook.currentTickLower() — should be -1200
- Query hook.currentTickUpper() — should be 1200
- Query hook.getCurrentFee() — should be 3000
- Check the Rebalanced event in the tx receipt

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "OnlyCurator" revert | SA not registered as curator | Run setup.ts first |
| "NoCuratorSet" revert | activeCuratorId is 0 | Run setup.ts first |
| "RebalanceTooFrequent" | Less than 30 blocks since last rebalance | Wait ~1 minute, try again |
| "FeeOutOfBounds" from enforcer | Fee outside [100, 50000] | Check the fee argument |
| "InvalidTarget" from enforcer | Wrong HOOK_ADDRESS in .env | Fix the address |
| Moltbot out of gas | Insufficient ETH | delegation.ts auto-funds, but check EOA balance |

---

### Test A3: Sub-Delegation Chain (SA → Agent → Volatility Agent)

**What it does:** Creates a 3-party delegation chain and verifies that
the intersection of bounds is enforced.

**Prerequisite:** Add VOLATILITY_AGENT_PRIVATE_KEY to agent/.env
(any fresh private key works — generate with `cast wallet new`).

**Run:**
  bun run src/sub-delegation.ts

**Expected output (4 steps):**
- [1/4] Alice signs delegation to Bob (broad: 0.01%-5%, 30 blocks) — Signed
- [2/4] Bob sub-delegates to Charlie (narrow: 0.5%-2%, 60 blocks) — Signed
- [3/4] Charlie redeems chain with fee 0.80% — Rebalance executed with tx hash
- [4/4] Charlie tries fee 3% (outside Bob's max 2%) — Correctly reverted

**Verify:**
- Step 3 succeeds: fee 8000 (0.80%) is within both [100, 50000] and [5000, 20000]
- Step 4 reverts: fee 30000 (3.00%) is within Alice's bounds but exceeds Bob's max
- This proves the enforcer runs at both levels and the intersection is enforced

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "hashDelegation is not defined" | TypeScript compile error in sub-delegation.ts | Known issue — check if hashDelegation is imported or needs a local implementation |
| Step 3 reverts | Rate limit from previous test A2 | Wait 30+ blocks (~1 min) between A2 and A3. Or use different salt in sub-delegation.ts (already uses salt=100n) |
| Step 4 does NOT revert | Enforcer not checking bounds correctly | Check enforcer deployment — run forge test to verify |

---

## 4. Part B — OpenClaw Agent Base Testing

These tests validate the CLI tools and SKILL.md that form the
foundation for the OpenClaw agent.

### Test B1: pool-reader Tool

**What it does:** Reads all on-chain state from the hook and outputs JSON.

**Run:**
  bun run src/tools/pool-reader.ts

**Expected output:** JSON with all pool state fields. Example:

```
  {
    "tickLower": -1200,
    "tickUpper": 1200,
    "totalLiquidity": "5000000000000000",
    "currentFee": 3000,
    "cumulativeVolume": "0",
    "cumulativeFeeRevenue": "0",
    "totalSwaps": 0,
    "idleToken0": "0",
    "idleToken1": "0",
    "accruedPerformanceFee": "0",
    "activeCuratorId": 1,
    "currentBlock": 12345678
  }
```

**Verify:**
- activeCuratorId > 0 (curator is registered)
- tickLower and tickUpper match the last rebalance (or default range)
- totalLiquidity > 0 if deposits have been made
- Output is valid JSON parseable by any tool

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "HOOK_ADDRESS must be set" | Missing env var | Set HOOK_ADDRESS in agent/.env |
| Contract call reverts | Hook not deployed at that address | Verify HOOK_ADDRESS on block explorer |
| All values are 0 | Pool not initialized or no deposits | Run the deploy script + make a deposit first |

---

### Test B2: execute-rebalance Tool

**What it does:** Triggers a rebalance via delegation redemption.

**Run:**
  bun run src/tools/execute-rebalance.ts --tickLower -600 --tickUpper 600 --fee 5000

**Expected output:**

```
  {
    "success": true,
    "txHash": "0x...",
    "blockNumber": 12345800,
    "gasUsed": "245000",
    "tickLower": -600,
    "tickUpper": 600,
    "fee": 5000
  }
```

**Verify:**
- success is true
- Run pool-reader again — tickLower should be -600, tickUpper 600, fee 5000
- Check tx on Sepolia block explorer — Rebalanced event emitted

**What can go wrong:**

| Symptom | Cause | Fix |
|---|---|---|
| "RebalanceTooFrequent" | Less than 30 blocks since test A2/A3 | Wait ~1 minute |
| "FeeOutOfBounds" | Fee outside delegation bounds | Use fee between 100 and 50000 |
| "OnlyCurator" | SA address mismatch | Ensure CURATOR_PRIVATE_KEY matches the key used in setup.ts |
| Missing args error | Forgot --tickLower etc | Check the command syntax |

---

### Test B3: claim-fees Tool

**What it does:** Claims accrued performance fees via delegation.

**Run:**
  bun run src/tools/claim-fees.ts

**Expected output (if fees exist):**

```
  {
    "success": true,
    "txHash": "0x...",
    "blockNumber": 12345810,
    "gasUsed": "120000"
  }
```

**Expected output (if no fees — typical on fresh testnet):**

```
  {
    "success": false,
    "error": "... NoFeesToClaim ..."
  }
```

**Verify:**
- If success=true: accruedPerformanceFee on the hook should now be 0
- If success=false with NoFeesToClaim: this is correct behavior on a
  fresh pool with no swaps. Run some test swaps through the pool first,
  then retry.

**How to generate fees for testing:**
- Execute a few swaps through the pool (using a swap router or test script)
- Each swap accrues performance fees based on the curator's performanceFeeBps
- Then run claim-fees again — it should succeed

---

### Test B4: OpenClaw Integration

**What it does:** Runs the full agent via OpenClaw's heartbeat cycle
using the SKILL.md and CLI tools.

**Prerequisite:** OpenClaw installed globally.

**Run:**
  npm install -g openclaw@latest
  cd agent
  openclaw --workspace ./workspace

**What to watch for (first heartbeat):**

```
  Expected agent reasoning:

  1. Agent reads SKILL.md, understands its role
  2. Agent runs: npx tsx src/tools/pool-reader.ts
  3. Agent reads the JSON output
  4. Agent REASONS about the pool state:
     - "activeCuratorId is 1 — curator is registered"
     - "totalLiquidity is X — there are deposits"
     - "tickLower is -600, tickUpper is 600"
     - "idle balances are balanced — position looks in range"
     - "accruedPerformanceFee is 0 — nothing to claim"
  5. Agent DECIDES: "Position looks healthy. No action needed."
  6. Agent REFLECTS: logs its reasoning
```

**What to watch for (after manually moving the price):**

If you execute swaps that move the price significantly, the idle
balances will become imbalanced. On the next heartbeat:

```
  Expected agent reasoning:

  1. Agent runs pool-reader
  2. Agent sees: "idleToken0 is much larger than idleToken1"
  3. Agent REASONS: "The position may be out of range on one side.
     I should consider rebalancing."
  4. Agent DECIDES: "Rebalance to a new centered range."
  5. Agent runs: npx tsx src/tools/execute-rebalance.ts --tickLower X --tickUpper Y --fee Z
  6. Agent reads the result: "success: true, txHash: 0x..."
  7. Agent REFLECTS: "Rebalanced to [X, Y] with fee Z. Tx: 0x..."
```

**Verification checklist for OpenClaw integration:**

| Check | How |
|---|---|
| Agent invokes pool-reader on first heartbeat | Watch OpenClaw logs for exec call |
| Agent outputs reasoning about pool state | Check log for idle balance analysis |
| Agent decides to do nothing when pool is healthy | Log says "no action needed" or similar |
| Agent decides to rebalance when appropriate | After moving price, next heartbeat triggers rebalance |
| Agent does NOT retry after a failed tx | If rebalance fails, log shows error + "waiting for next heartbeat" |
| Agent does NOT fabricate data | All decisions based on pool-reader output, no invented numbers |
| Agent stays within constraints | Fee in [100, 50000], ticks divisible by 60 |

---

## 5. Test Sequence (Run in This Order)

The tests build on each other. Run them in sequence.

```
  Test A1: setup.ts
       |
       | Curator SA created, identity minted, curator registered
       | Add ERC8004_IDENTITY_ID to .env
       v
  Test A2: delegation.ts
       |
       | Single delegation signed and redeemed
       | Rebalance executed on hook
       v
  Test A3: sub-delegation.ts
       |
       | 3-party chain validated
       | Bound intersection enforced
       v
  Test B1: pool-reader tool
       |
       | Verify tool outputs correct state
       | (should reflect A2's rebalance)
       v
  Test B2: execute-rebalance tool
       |
       | Verify standalone tool works
       | (different tick range from A2)
       v
  Test B3: claim-fees tool
       |
       | Verify claim works (or correctly fails with no fees)
       v
  Test B4: OpenClaw integration
       |
       | Agent runs 2-3 heartbeats autonomously
       | Makes decisions based on pool state
       | Executes via delegation when warranted
```

---

## 6. Pass/Fail Criteria

Phase 3 is complete when ALL of the following are true:

**Delegation mechanics (Part A):**
- [ ] setup.ts runs successfully — SA registered as curator on hook
- [ ] delegation.ts runs successfully — single delegation redeemed, rebalance executed
- [ ] sub-delegation.ts runs successfully — 3-party chain works, bound intersection verified
- [ ] Out-of-bounds fee correctly reverts at enforcer level

**OpenClaw agent base (Part B):**
- [ ] pool-reader outputs valid JSON with correct hook state
- [ ] execute-rebalance triggers successful rebalance via delegation
- [ ] claim-fees works (success if fees exist, correct error if none)
- [ ] OpenClaw loads SKILL.md and invokes pool-reader on first heartbeat
- [ ] OpenClaw agent reasons about pool state and makes a decision
- [ ] OpenClaw agent correctly does nothing when pool is healthy
- [ ] OpenClaw agent correctly rebalances when position needs adjustment
- [ ] All tool invocations go through OpenClaw's exec — no manual intervention

**On-chain verification:**
- [ ] Hook state reflects the agent's rebalance (tick range, fee changed)
- [ ] Rebalanced event emitted with correct parameters
- [ ] The tx was routed: DelegationManager → Enforcer → Smart Account → Hook
- [ ] msg.sender in hook = Agent Smart Account (verifiable in tx trace)

---

## 7. What Comes Next (Phase 4)

Once Phase 3 testing passes, the agent has a working base:
- OpenClaw can invoke tools and reason about results
- Delegation redemption works end-to-end
- The SKILL.md framework is validated

Phase 4 adds intelligence to this base:
- venice-analyze tool (Venice AI replaces the simple heuristic)
- market-data tool (x402/AgentCash replaces guessing from idle balances)
- olas-analyze tool (cross-checking Venice's recommendations)
- check-budget tool (Locus wallet for data spending)
- uniswap-quote tool (Trading API for price quotes)

The SKILL.md decision guidelines section gets replaced with the full
autonomous reasoning framework from openclaw-agent-spec.md. The tools,
constraints, heartbeat protocol, and error handling sections remain
unchanged — Phase 4 only adds to them.
