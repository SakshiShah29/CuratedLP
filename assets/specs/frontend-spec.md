# CuratedLP Frontend — Flow Spec

*Last updated: 2026-03-20*

*Related: curator-agent-identity-spec.md, openclaw-agent-spec.md*

---

## Guiding Principle

This is a **hackathon demo frontend**, not a production app. It needs to tell the story in 60 seconds: LP deposits, AI manages, LP withdraws anytime, everything is transparent. Every screen should answer one question clearly.

---

## Three Views, One Dashboard

**1. Vault Overview** (the landing page — "What is this vault?")
**2. Curator Dashboard** (the transparency layer — "What is the AI doing?")
**3. Performance & History** (the proof — "Is the AI actually good?")

Navigation: simple top tab bar across all three. No routing depth beyond this.

---

## View 1: Vault Overview

**Who it's for**: Alice (the LP). This is the deposit/withdraw page.

### Top Section — Vault Stats (read-only, live from contract)

- TVL (from `totalAssets()` — show both token amounts + USD equivalent)
- Current fee (from `getCurrentFee()`, displayed as percentage)
- Current tick range (`currentTickLower` / `currentTickUpper`)
- Total swaps count
- Active curator name (resolve via Basename if available, fallback to truncated address)

### Middle Section — Deposit

- Connect wallet button (MetaMask via Wagmi)
- Two input fields: token0 amount, token1 amount
- "You will receive: ~X cvLP shares" estimate
- Deposit button → sends `deposit()` tx
- Success state: show tx hash linking to BaseScan Sepolia

### Middle Section — Withdraw

- Input: number of cvLP shares to burn (show "Balance: X cvLP" above)
- "You will receive: ~X token0 + ~Y token1" estimate
- Withdraw button → sends `withdraw()` tx
- Success state: tx hash link

### Bottom Section — Your Position

- Only visible if connected wallet holds cvLP shares
- Your shares, your % of vault, estimated token value

### Key UX Decisions

- Deposit and withdraw can live side-by-side or as tabs within this view — no separate pages
- All dollar values are optional/best-effort (Chainlink or Uniswap Trading API for price). If it's too complex, just show raw token amounts
- Wallet connection is the first CTA if not connected

---

## View 2: Curator Dashboard

**Who it's for**: Anyone curious about the AI agent. This is the transparency/trust page.

### Top Section — Agent Identity

The curator IS the AI agent. The Agent Smart Account is the registered
curator. The Locus Wallet is the agent's operational trigger + data
spending wallet. See curator-agent-identity-spec.md for the full model.

- Agent Basename (e.g., `vault-curator.base.eth`) — ENS resolution via viem,
  resolves the Agent Smart Account address
- ERC-8004 Identity ID (link to BaseScan — NFT held by Agent Smart Account)
- Agent Smart Account address (truncated, copyable) — this is the curator
- Status indicator: Online / Offline (based on how recent `lastRebalanceBlock`
  is relative to current block — if within last 100 blocks, online)

### Middle Section — Agent Activity Log

- A reverse-chronological feed of agent heartbeat cycles. The OpenClaw
  agent writes a structured cycle log after each heartbeat (see
  openclaw-agent-spec.md section 8). The frontend reads this log.
- Each entry shows:
  - Timestamp
  - Heartbeat phase reached (OBSERVE / ANALYZE / DECIDE / ACT / REFLECT)
  - Key data: what data was gathered, Venice's recommendation + reasoning,
    what decision was made and why, tx hash if rebalanced, or
    "No action — confidence too low / position still optimal"
  - Budget spent this cycle (USDC for x402/Olas)
- This is the core transparency feature — it shows the agent's autonomous
  reasoning. OpenClaw's LLM reasoning trail is logged automatically,
  including WHY the agent made each decision.
- Data source: agent writes cycle-log.json (append-only). Frontend polls
  every 30-60 seconds. Alternatively, agent writes to a simple API
  endpoint that the frontend reads.

### Bottom Section — Operational Stats

- Locus wallet balance + daily spend (from agent's cycle log or Locus API)
- Delegation status: Active / Revoked, fee bounds [minFee, maxFee], rate limit
  (read from the signed delegation terms — the human operator's mandate)
- x402 payments today: count + total USDC spent (from payment-log.json)
- Olas Mech requests: count / 10 minimum (bounty tracking)

### Key UX Decisions

- The activity log is the star of this view — it proves the AI is
  genuinely reasoning, not just running a script. Show Venice's reasoning
  text prominently.
- Don't over-design the Locus/delegation section. Simple key-value pairs
  are fine.
- The agent writes cycle-log.json and payment-log.json. The frontend
  reads these files — no separate API needed. If the agent runs on a
  different machine, serve these files via a simple static file server.

---

## View 3: Performance & History

**Who it's for**: LPs evaluating whether to deposit, or judges evaluating the project.

### Top Section — Performance Comparison

- Vault APY vs Passive LP APY (the core value proposition)
- Outperformance delta (positive = curator is earning its fee)
- These are computed from on-chain data: `cumulativeFeeRevenue`, `totalSwaps`, time elapsed, and a passive LP benchmark estimate

### Middle Section — Rebalance History

- Table or timeline of all `Rebalanced` events from the hook contract
- Each row: timestamp, old tick range → new tick range, old fee → new fee, tx hash
- Read from contract event logs via viem `getLogs`

### Bottom Section — Swap Activity

- Recent `SwapTracked` events: volume, fee revenue per swap
- Cumulative chart if time permits (volume over time, fee revenue over time)

### Bottom — Reputation

- ERC-8004 ReputationRegistry feedback entries for this curator
- Shows: rebalance count, avg fee revenue, tick accuracy
- Links to BaseScan for on-chain proof

### Key UX Decisions

- Charts are nice-to-have. A simple table of rebalance history + cumulative stats is sufficient for the demo
- The APY comparison is the single most important number on this page. If you can only show one thing, show that
- Historical event logs can be paginated — don't try to load all history at once

---

## Cross-Cutting Concerns

**Wallet connection**: Global, persistent across all views. Wagmi + MetaMask. Show connected address (as Basename if available) in the top-right corner.

**ENS/Basenames resolution**: Every address displayed anywhere should attempt Basename resolution. Fallback to `0xAbCd...1234` truncation. This covers the $1,500 ENS bounty.

**Network**: Base Sepolia only. If user is on wrong network, show a "Switch to Base Sepolia" prompt. Don't support multiple chains.

**Data freshness**: All on-chain reads (TVL, fee, tick range, curator info) should refresh on a ~15-second interval or on wallet events. No manual refresh button needed.

**Responsiveness**: Desktop-first. Mobile is nice-to-have but not required for a hackathon demo.

---

## Demo Flow (60 Seconds)

The frontend should support this exact walkthrough:

1. **Land on Vault Overview** → "Here's the vault: TVL, fee, tick range, AI curator managing it"
2. **Connect wallet, deposit** → "Alice deposits wstETH + USDC, gets cvLP shares"
3. **Switch to Curator Dashboard** → "Here's what the AI is doing — OpenClaw reasoned about market conditions, Venice recommended widening the range, agent rebalanced 3 minutes ago, paid $0.003 for market data via x402"
4. **Switch to Performance** → "Vault is outperforming passive LP by 6%, here's the rebalance history with on-chain proof"
5. **Back to Vault Overview, withdraw** → "Alice withdraws anytime, no lockup, tokens returned"
6. **Point to curator Basename** → "Everything is human-readable via ENS"

---

## Data Sources Summary

| Data | Source | Method |
|------|--------|--------|
| TVL, fee, tick range, swap count | `CuratedVaultHook` contract | Direct contract reads via viem |
| Curator info (identity ID, fee, last rebalance) | `getCurator()` / `activeCuratorId` | Contract read |
| Performance metrics | `getPerformanceMetrics()` | Contract read |
| Rebalance history | `Rebalanced` event logs | `getLogs` via viem |
| Swap history | `SwapTracked` event logs | `getLogs` via viem |
| Agent activity + Venice reasoning | OpenClaw cycle-log.json | Poll file every 30-60s |
| Payment history (x402, Olas) | Agent payment-log.json | Read on page load + poll |
| Locus spending | Agent cycle log or Locus API | Read from cycle log budget fields |
| Basename resolution | Base L2 ENS resolver | viem `getEnsName()` |
| Token prices (optional) | Uniswap Trading API or Chainlink | API call for USD conversion |

---

## Contract View Functions Used

| Function | Returns | Used In |
|----------|---------|---------|
| `totalAssets()` | `(uint256 amount0, uint256 amount1)` | Vault Overview — TVL |
| `getCurrentFee()` | `uint24` | Vault Overview — current fee |
| `getPerformanceMetrics()` | `(volume, feeRevenue, swapCount, liquidity, tickLower, tickUpper, currentFee)` | Performance view |
| `getCurator(curatorId)` | `Curator` struct | Curator Dashboard |
| `activeCuratorId` | `uint256` | All views — who's managing |
| `getTokens()` | `(address token0, address token1)` | Deposit/withdraw — token metadata |
| `vaultShares.balanceOf(user)` | `uint256` | Your Position section |
| `vaultShares.totalSupply()` | `uint256` | Share % calculation |

---

## Events Indexed

| Event | Fields | Used In |
|-------|--------|---------|
| `Rebalanced` | `curatorId, newTickLower, newTickUpper, newFee` | Rebalance history table |
| `SwapTracked` | `volume, feeRevenue` | Swap activity section |
| `Deposited` | `depositor, amount0, amount1, shares` | Your Position history |
| `Withdrawn` | `withdrawer, shares, amount0, amount1` | Your Position history |
| `CuratorRegistered` | `curatorId, wallet, erc8004IdentityId` | Curator identity display |
| `PerformanceFeeClaimed` | `curatorId, wallet, amount` | Performance view |
