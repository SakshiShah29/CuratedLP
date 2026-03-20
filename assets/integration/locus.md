# Locus Integration Reference

*Source: https://docs.paywithlocus.com/llms-full.txt*
*Last updated: 2026-03-20 (corrected via web research)*

> **⚠️ CORRECTIONS FROM WEB RESEARCH (2026-03-20)**
> - **No JWT auth endpoint** — `POST /api/auth` does NOT exist. Auth is a static Bearer token.
> - **No `/accounts` endpoint** — balance is at `GET /pay/balance`, not `/accounts`.
> - **API key is the Bearer token** — use `Authorization: Bearer claw_beta_...` directly on every call.

---

## What Is Locus

Locus is "payment infrastructure for AI agents" — non-custodial ERC-4337 smart wallets on Base with sponsored (gasless) transactions and configurable spending guardrails. The agent holds USDC, pays for services autonomously, and the human retains kill-switch access via a revocable permissioned key.

---

## Role in CuratedLP

Locus is the **agent's operational wallet**. Every x402 micropayment the curator makes (price feeds, volatility, sentiment) is funded from and gated by the Locus wallet. Without Locus, the agent cannot pay for market data, Venice AI gets no input, and no rebalances happen.

**Bounty target**: Locus — $3,000 (combined with x402/AgentCash: $8,250)

---

## Architecture: How Locus Sits in the Stack

```
┌─────────────────────────────────────────────────┐
│  FSM Agent Loop (index.ts)                       │
│                                                   │
│  MONITOR → ANALYZE → DECIDE → EXECUTE → REPORT  │
│               │                                   │
│               ▼                                   │
│  ┌─────────────────────┐                         │
│  │  x402-client.ts     │ ◄── needs to pay $0.003 │
│  │  (AgentCash fetch)  │     for market data      │
│  └────────┬────────────┘                         │
│           │                                       │
│           ▼                                       │
│  ┌─────────────────────┐                         │
│  │  locus.ts           │ ◄── checks budget,      │
│  │  (MCP integration)  │     enforces limits,     │
│  │                     │     signs USDC payment    │
│  └────────┬────────────┘                         │
│           │                                       │
│           ▼                                       │
│  ┌─────────────────────┐                         │
│  │  Base L1            │                         │
│  │  USDC transfer      │                         │
│  │  (gasless via       │                         │
│  │   paymaster)        │                         │
│  └─────────────────────┘                         │
└─────────────────────────────────────────────────┘
```

---

## Wallet Setup (One-Time, Pre-Loop)

### Step 1: Agent Self-Registration (Beta)

```
POST https://beta-api.paywithlocus.com/api/register
Body: { "name": "OpenClaw Moltbot", "email": "curator@curatedlp.xyz" }
```

Returns:

| Field | Value | Notes |
|-------|-------|-------|
| `apiKey` | `claw_dev_xxxx` | Used to get JWT tokens |
| `ownerPrivateKey` | hex string | Generated client-side, never stored on Locus servers |
| `ownerAddress` | `0x...` | Agent's EOA |
| `walletId` | UUID | Identifies the smart wallet |
| `walletStatus` | `"deploying"` | ERC-4337 wallet deploying on Base |
| `claimUrl` | URL | Human visits to link dashboard |
| `skillFileUrl` | URL | SKILL.md for agent discovery |

Rate limit: 5 self-registrations per IP per hour.

### Step 2: Authentication — Direct Bearer Token

```
Authorization: Bearer claw_beta_YOUR_API_KEY
```

**There is no `/api/auth` endpoint and no JWT.** The API key returned from `/register` is used directly as the Bearer token on every authenticated request. It does not expire.

All authenticated endpoints use:
```
Authorization: Bearer claw_beta_...
Content-Type: application/json
```

### Step 3: Configure Spending Controls (Dashboard or API)

| Control | Value | Rationale |
|---------|-------|-----------|
| **Max per transaction** | $0.50 | No single x402 call should exceed this |
| **Daily allowance** | $5.00 | ~1,152 calls/day at $0.001-0.01 each = $1-5 |
| **Total allowance** | $50.00 | Hackathon lifetime budget |
| **Approval threshold** | $0.10 | Anything above auto-approves up to per-tx limit |

Beta defaults: $10 allowance, $5 max per transaction.

### Step 4: Fund the Wallet

Fund with $10-50 USDC on Base to the smart wallet address. Or redeem credits:

```
POST /api/users/redeem-code
Body: { "code": "XXX-XXX-XXX-XXX", "walletId": "<walletId>" }
```

Credit requests: `POST /api/gift-code-requests` with email, reason (min 10 chars), requestedAmountUsdc (5-50). Rate limit: 1 per email per 24 hours.

---

## Wallet Architecture

**Smart wallet design**: ERC-4337 account that validates against two possible signers:

1. **Owner key** — generated client-side during registration, never stored on Locus servers. The agent holds this.
2. **Permissioned key** — stored in AWS KMS, revocable by human via dashboard. Kill-switch access.

Key properties:
- Single-signer ERC-4337 based on Solady
- Deterministic deployment via CREATE2 through LocusFactory
- UUPS upgradeability explicitly disabled (immutable implementation)
- Exclusive deployment on Base mainnet
- All transactions gasless via paymaster

**Subwallet system** (for email transfers, not used in CuratedLP):
- Time-limited escrow via `disburseBefore` deadline
- Up to 100 subwallets per wallet
- One-time password email claim flow

---

## `locus.ts` Module Design

### Exports

```typescript
// GET /pay/balance — response: { success: true, data: { balance | usdc | amount } }
getBalance(): Promise<{ balance: number; walletAddress?: string }>

// Budget enforcement (called before every x402 payment)
canSpend(amount: number): Promise<boolean>

// POST /pay/send — { to_address, amount, memo }
transferUSDC(to: string, amount: string, memo?: string): Promise<{ txHash: string }>

// Checkout (for receiving payments — performance fee collection)
createCheckoutSession(params: {
  amount: string
  description: string
  webhookUrl?: string
  metadata?: Record<string, any>
}): Promise<{ sessionId: string, checkoutUrl: string }>
```

### How `canSpend()` Works

Before every x402 micropayment, the agent calls `canSpend(amount)`:

1. Fetches current wallet balance via Locus API
2. Checks amount against per-transaction limit ($0.50)
3. Checks cumulative daily spend against daily cap ($5.00)
4. Returns `true` → x402-client proceeds with payment
5. Returns `false` → x402-client skips this data source, uses cached data

This is the critical bridge between `x402-client.ts` and `locus.ts`.

---

## MCP Server Integration

Locus exposes an MCP server at `https://mcp.paywithlocus.com/mcp`.

| MCP Tool | Phase 4 Usage |
|----------|--------------|
| `get_balance` | Check USDC balance before FSM cycle starts |
| `list_accounts` | Get deposit address for funding, verify wallet is deployed |
| `fetch` | Route x402 payments through Locus (handles SIWX + 402 automatically) |
| `check_endpoint_schema` | Probe data endpoints for pricing before committing to pay |
| `discover_api_endpoints` | Catalog available data sources on stableenrich.dev etc. |

### MCP Flow Per FSM Cycle

```
1. get_balance → if < $0.50, log warning, skip paid data sources
2. discover_api_endpoints("https://stableenrich.dev") → cache endpoint list
3. check_endpoint_schema(endpoint) → get price, confirm < $0.50
4. fetch(endpoint, { body, max_amount: "0.50" }) → auto-pay via x402
5. Response includes paymentInfo.amount + paymentInfo.transaction
6. Log tx hash for bounty submission proof
```

---

## Per-FSM-Cycle Payment Flow (Every 5 Minutes)

```
Cycle starts
  │
  ├─ locus.ts: getBalance() → $8.47 remaining
  │
  ├─ ANALYZE step begins
  │   │
  │   ├─ x402-client: fetch price feed
  │   │   └─ locus.ts: canSpend($0.003) → ✅
  │   │   └─ AgentCash signs USDC, pays, gets data
  │   │   └─ Cost: $0.003, TX: 0xabc...
  │   │
  │   ├─ x402-client: fetch volatility metrics
  │   │   └─ locus.ts: canSpend($0.01) → ✅
  │   │   └─ Cost: $0.01, TX: 0xdef...
  │   │
  │   ├─ x402-client: fetch sentiment data
  │   │   └─ locus.ts: canSpend($0.005) → ✅
  │   │   └─ Cost: $0.005, TX: 0x123...
  │   │
  │   ├─ uniswap-api: Trading API quote (free, API key auth)
  │   ├─ mech-client: Olas Mech analysis (separate payment)
  │   └─ venice.ts: all data → Venice AI → recommendation
  │
  ├─ Cycle total spend: ~$0.018
  ├─ Daily cumulative: $0.72 (within $5.00 cap)
  │
  └─ Log all payment tx hashes for bounty proof
```

---

## Checkout System (Receiving Payments)

Beyond paying for data, Locus Checkout can be used for **performance fee collection** in the frontend (Phase 6).

### Session Model

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Auto-generated |
| `amount` | string | USDC amount |
| `currency` | string | Always "USDC" |
| `description` | string | Optional |
| `status` | enum | PENDING / PAID / EXPIRED / CANCELLED |
| `expiresAt` | ISO 8601 | Default 30-min TTL (configurable) |
| `sellerWalletAddress` | string | Curator's wallet |
| `paymentTxHash` | string | Set when PAID |
| `metadata` | object | Custom key-value pairs |

### Payment Methods

1. **Locus Wallet** — one-click, sponsored gas
2. **External Wallet** — MetaMask, Coinbase, WalletConnect via Payment Router (`0x34184b7bCB4E6519C392467402DB8a853EF57806` on Base)
3. **AI Agent** — programmatic via Locus API

### Webhook Events

- `checkout.session.paid` — payment confirmed on-chain
- `checkout.session.expired` — TTL exceeded

Payload includes sessionId, amount, currency, txHash, payerAddress, timestamp. Verify via HMAC-SHA256 signature in `X-Signature-256` header (secret format: `whsec_*`).

### React SDK

```typescript
import { LocusCheckout } from '@withlocus/checkout-react'

<LocusCheckout
  sessionId={sessionId}
  mode="embedded"          // or "popup" or "redirect"
  onSuccess={(data) => {}} // { sessionId, amount, currency, txHash, payerAddress, paidAt }
  onCancel={() => {}}
  onError={(err) => {}}
/>
```

Hook: `useLocusCheckout()` returns `getCheckoutUrl()`, `openPopup()`, `redirectToCheckout()`.

### Receipt Configuration

Optional line items, tax, and company details attached to sessions:

```typescript
receiptConfig: {
  creditorName: "CuratedLP Vault",
  lineItems: [{ description: "Performance fee (Q1)", amount: "12.50" }],
  subtotal: "12.50",
  taxRate: "0",
  taxAmount: "0",
  logoUrl: "https://...",
  supportEmail: "curator@curatedlp.xyz"
}
```

---

## Payment Router Contract (Base)

For external wallet payments via checkout:

| Detail | Value |
|--------|-------|
| Address | `0x34184b7bCB4E6519C392467402DB8a853EF57806` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Event | `CheckoutPayment` (binds payment to session) |
| Feature | Permit-based approval + pay in single transaction |

---

## Connection to AgentCash / x402

AgentCash payments are funded from the Locus-managed agent wallet:

```
x402-client.ts                     locus.ts (mcp.paywithlocus.com)
      │                                │
      ├─ needs to pay $0.003    ──►    ├─ checks daily budget remaining
      │                                ├─ checks per-tx limit
      │                                ├─ if within bounds -> approve
      │                                └─ if exceeded -> reject
      │
      └─ signs USDC payment with agent wallet key
```

AgentCash attempts **SIWX (Sign-In With X) authentication first** before payment. If the endpoint still returns 402 after SIWX, only then does it pay. SIWX endpoints are free — they only require wallet identity.

---

## Error Handling Matrix

| Scenario | Response | Fallback |
|----------|----------|----------|
| Balance < required amount | `canSpend()` returns false | Use cached data from last successful cycle |
| Invalid API key (401) | Locus API rejects | Check LOCUS_API_KEY env var — no refresh needed, key is permanent |
| Per-tx limit exceeded | Locus API rejects | Split into smaller requests or skip |
| Daily cap hit | All `canSpend()` return false | Agent enters read-only mode, no rebalances |
| Wallet not yet deployed | `walletStatus: "deploying"` | Poll every 30s until `"ready"` |
| Rate limit (429) | Backoff | Wait and retry next cycle |
| x402 endpoint down | `fetch` throws | Fall back to alternative data provider |

---

## Solidity Impact

**None.** Locus is entirely a TypeScript-side integration:

- No new contract functions needed
- No on-chain payment verification by the hook
- The hook does not know or care how the agent funds its operations
- Locus payments happen on Base mainnet USDC, separate from the vault pool

---

## Bounty Alignment ($3,000 Locus Prize)

| Requirement | How CuratedLP Satisfies It |
|-------------|---------------------------|
| Use Locus wallet | Agent's sole payment infrastructure — every x402 call goes through it |
| Spending controls | Per-tx ($0.50) + daily ($5) + total ($50) caps configured |
| Meaningful integration | Load-bearing — without Locus, agent cannot pay for market data |
| Volume | ~1,152 micropayments/day flowing through Locus wallet |
| MCP usage | All payments routed through `mcp.paywithlocus.com` MCP server |
| Combined with x402 | Locus + AgentCash form $8,250 combined bounty target |

---

## Endpoint Table (Confirmed via Web Research)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/register` | None | Create agent, returns `apiKey + ownerPrivateKey + walletId` |
| `GET` | `/status` | Bearer | Poll wallet deployment (`deploying` → `deployed`) |
| `GET` | `/pay/balance` | Bearer | **Check USDC balance** (use this, not `/accounts`) |
| `GET` | `/pay/transactions` | Bearer | Transaction history (`?limit=10`) |
| `GET` | `/pay/transactions/:id` | Bearer | Single transaction |
| `POST` | `/pay/send` | Bearer | Send USDC: `{ to_address, amount, memo }` |
| `POST` | `/pay/send-email` | Bearer | Send USDC via email (escrow) |
| `POST` | `/gift-code-requests` | Bearer | Request promotional USDC |
| `GET` | `/gift-code-requests/mine` | Bearer | Check request status |
| `POST` | `/gift-code-requests/redeem` | Bearer | Redeem approved credits |
| `GET` | `/wrapped/md` | Bearer | List pay-per-use providers |
| `POST` | `/wrapped/<provider>/<endpoint>` | Bearer | Call a wrapped paid API |
| `GET` | `/apps/md` | Bearer | Get enabled apps docs |
| `POST` | `/feedback` | Bearer | Submit feedback |

**Balance response envelope** (exact field name unknown, try all):
```json
{ "success": true, "data": { "balance": 8.47 } }
```
Try fields: `data.balance`, `data.usdc`, `data.amount` in that order.

---

## Key Constants

| Item | Value |
|------|-------|
| API base (beta) | `https://beta-api.paywithlocus.com/api` |
| Dashboard (beta) | `https://beta.paywithlocus.com` |
| MCP server | `https://mcp.paywithlocus.com/mcp` |
| Network | Base mainnet (chain ID 8453) |
| Token | USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) |
| API key prefix | `claw_beta_*` (beta) |
| Webhook secret prefix | `whsec_*` |
| Auth method | **Direct Bearer token** (no JWT exchange, API key = Bearer token) |
| Beta defaults | $10 allowance, $5 max per transaction |

**Note**: Beta and production are fully separate environments. API keys, wallets, and accounts do not transfer between them.

---

## Quick Start Checklist

- [ ] Register agent via `POST /api/register` with name + email
- [ ] Store `apiKey` and `ownerPrivateKey` securely (env vars, not committed)
- [ ] Human visits `claimUrl` to link dashboard and configure spending controls
- [ ] Fund wallet with $10-50 USDC on Base (or redeem gift code)
- [ ] Implement `locus.ts` wrapping authentication + balance + canSpend
- [ ] Wire `canSpend()` into `x402-client.ts` as pre-payment gate
- [ ] Connect to MCP server at `mcp.paywithlocus.com/mcp` for tool access
- [ ] Set `max_amount: "0.50"` on all AgentCash fetch calls as safety net
- [ ] Log all payment tx hashes for bounty submission proof
- [ ] (Phase 6) Integrate `@withlocus/checkout-react` for performance fee UI
