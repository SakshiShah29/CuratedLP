# AgentCash / x402 Integration Reference

*Source: https://agentcash.dev/docs/llms-full.txt*
*Last updated: 2026-03-17*

---

## What Is AgentCash

AgentCash is a CLI and agent skill that gives AI agents instant access to 250+ premium, paywalled data and services via micropayments in USDC. Agents pay per request (fractions of a cent to a few cents each) without API keys or subscriptions. It implements the **x402 protocol** — using the HTTP 402 Payment Required status code for machine-to-machine payments.

---

## Role in CuratedLP

AgentCash is the **data access layer** for the AI curator agent. Every FSM cycle (5 minutes), the agent buys real-time market data (price feeds, volatility, sentiment) to feed Venice AI for rebalance decisions. Without this data, Venice AI cannot make informed tick range or fee recommendations.

**Bounty target**: Merit/x402 — $5,250

---

## x402 Payment Flow

```
1. Agent sends HTTP request to premium data endpoint
2. Endpoint responds with 402 Payment Required + pricing details
3. AgentCash extracts payment requirements (amount, currency, network)
4. System checks wallet balance against required amount
5. Private key signs USDC payment credential
6. Request retries with payment proof attached
7. Server verifies on-chain payment and returns data
8. Response includes transaction hash and payment metadata
```

AgentCash attempts **SIWX (Sign-In With X) authentication first** before payment. If the endpoint still returns 402 after SIWX, only then does it pay.

---

## Supported Networks

| Network | Chain ID | Notes |
|---|---|---|
| **Base** | 8453 | Default and cheapest. Most endpoints accept Base. |
| Ethereum | 1 | Higher gas |
| Optimism | 10 | |
| Arbitrum | 42161 | |
| Polygon | 137 | |
| Base Sepolia | 84532 | Testnet |
| Ethereum Sepolia | 11155111 | Testnet |

**CuratedLP should always use Base** — same chain as the vault, lowest fees.

**Token**: USDC exclusively.

---

## CLI Commands

| Command | Purpose |
|---|---|
| `npx agentcash fetch <url> [options]` | HTTP request with auto auth/payment |
| `npx agentcash check <url>` | Schema inspection without paying |
| `npx agentcash discover <url>` | List available endpoints on an origin |
| `npx agentcash try <url>` | Interactive exploration |
| `npx agentcash register <url>` | Register new origin |
| `npx agentcash balance` | Show total wallet balance |
| `npx agentcash accounts` | Show per-network details |
| `npx agentcash redeem <code>` | Redeem invite codes |
| `npx agentcash fund` | Open funding page |
| `npx agentcash install [--client <name>]` | Install MCP server |
| `npx agentcash onboard [code]` | Initial setup |

### Fetch Options

```bash
npx agentcash fetch <url> \
  -m POST \                        # HTTP method
  -b '<json-body>' \               # Request body
  -H 'Name: value' \               # Custom header
  --timeout <ms> \                 # Request timeout
  --payment-protocol <protocol> \  # Payment protocol override
  --payment-network <network> \    # Network override (default: Base)
  --max-amount <usd> \             # Abort if price exceeds this
  --verbose                        # Debug output
```

### Global Flags

| Flag | Purpose |
|---|---|
| `--verbose` / `-v` | Debug output |
| `--quiet` / `-q` | Suppress stderr |
| `--format <json\|pretty>` | Output format |
| `-y` / `--yes` | Skip confirmations |
| `--dev` | Use localhost endpoints |
| `--sessionId <id>` | Request tracing |
| `--provider <name>` | Custom identifier |

---

## MCP Server Integration

### Installation for Claude Code

```bash
claude mcp add agentcash --scope user -- npx -y agentcash@latest
```

### Installation for Claude Desktop

```json
{
  "mcpServers": {
    "agentcash": {
      "command": "npx",
      "args": ["-y", "agentcash@latest"]
    }
  }
}
```

### MCP Tools Exposed

| Tool | Parameters | Purpose |
|---|---|---|
| `fetch` | url, method, body, headers, timeout, payment_protocol, payment_network, max_amount | Primary request tool with auto-payment |
| `check_endpoint_schema` | url, method, headers | Inspect endpoint schema + pricing |
| `discover_api_endpoints` | url | List all endpoints on an origin |
| `get_balance` | — | Check USDC balance |
| `list_accounts` | — | Per-network account details |
| `redeem_invite` | code | Redeem invite code |
| `fetch_with_auth` | *(deprecated alias for fetch)* | |

**Supported AI clients**: claude-code, cursor, claude, codex, cline, windsurf, warp, gemini-cli, goose, zed, opencode, openclaw.

---

## Response Structures

### Fetch Response (with payment)

```
data: object           # Parsed response body
paymentInfo:
  amount: string       # USDC amount paid (e.g., "0.003")
  transaction: string  # On-chain tx hash
  network: string      # Chain identifier (e.g., "base")
```

### Check / Schema Response

```
price: string          # Cost per request
methods: string[]      # Supported HTTP methods
inputSchema: object    # JSON schema for request body
outputSchema: object   # JSON schema for response
authType: string       # "x402", "siwx", "mpp", or "none"
```

### Balance Response

```
balance: number        # Total USDC across all networks
```

### Accounts Response

```
accounts: array
  - network: string
  - balance: number
  - address: string
  - depositLink: string
isNewWallet: boolean
onboardingCta: object  # Optional
```

---

## Wallet Management

| Detail | Value |
|---|---|
| Storage location | `~/.agentcash/wallet.json` |
| File permissions | `600` (user read/write only) |
| Contents | Private key (plaintext), address, creation timestamp |
| Address | Standard Ethereum address, same across all EVM networks |
| Auto-creation | Creates automatically on first use |
| Override | `X402_PRIVATE_KEY` environment variable for CI/CD or shared wallets |
| Free credits | Up to $25 USDC via onboarding at agentcash.dev/onboard |

**Security warning**: Private key is stored in plaintext. Do not share wallet file or commit to version control.

---

## SIWX Authentication (Sign-In With X)

Separate from payment — handles wallet-based auth for endpoints that support it:

1. Endpoint responds with 402 + SIWX challenge
2. Agent's wallet signs the challenge to prove address ownership
3. Signed proof attached to retry headers
4. Server verifies, returns data (potentially free if SIWX-only)

Some endpoints accept SIWX auth without payment (free tier). AgentCash tries SIWX first, only pays if the route still requires it.

---

## Discovery Protocol

Any server that publishes a `/.well-known/x402` document is automatically discoverable by AgentCash. This document uses OpenAPI format with pricing metadata, listing all available endpoints, their schemas, pricing, and auth requirements.

### Known Indexed Origins

| Origin | Domain |
|---|---|
| StableEnrich | stableenrich.dev |
| StableSocial | stablesocial.dev |
| StableStudio | stablestudio.dev |
| StableUpload | stableupload.dev |
| StableEmail | stableemail.dev |

---

## CuratedLP Integration Design

### x402-client.ts Responsibilities

| Function | Purpose |
|---|---|
| `discoverEndpoints(origin)` | Hit `/.well-known/x402` to list available premium endpoints |
| `checkSchema(url)` | Probe endpoint for price, input/output schema, auth type (no payment) |
| `fetchMarketData(url, body)` | Make paid request: handle 402 -> sign -> retry cycle |
| `getBalance()` | Check agent's USDC balance |

### Data Sources the Agent Buys

| Data Type | Used For | Estimated Cost |
|---|---|---|
| Price feeds (wstETH/USDC) | Current price, historical OHLCV | $0.001-0.01/req |
| Volatility metrics | Tick range width decision | $0.01-0.05/req |
| Sentiment / social signals | Directional bias for Venice AI | $0.005-0.02/req |
| On-chain analytics | Whale movements, TVL changes | $0.005-0.03/req |

At 5-minute intervals with ~4 data calls per cycle: **~1,152 calls/day, ~$0.05-0.50/day**.

### Where It Fits in the FSM

```
MONITOR ─► ANALYZE ─► DECIDE ─► EXECUTE ─► REPORT
               │
               ├── x402-client: fetch market data (paid via AgentCash)
               ├── uniswap-api: Trading API price quotes (free)
               ├── mech-client: Olas Mech analysis (10+ requests)
               └── venice.ts: all data -> Venice AI -> recommendation
```

### Connection to Locus Wallet

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

### Error Handling Requirements

| Scenario | Handling |
|---|---|
| Insufficient balance | Skip data source, use cached data, log warning |
| Endpoint down | Fall back to alternative provider |
| Price spike | `max_amount` parameter prevents overspend |
| SIWX-only endpoint | Authenticate free without payment |
| Timeout | Retry once, then skip and use stale data |

### One-Time Setup (Before FSM Loop)

1. `discover` all known origins (stableenrich.dev, stablesocial.dev, etc.)
2. `check` each endpoint for schema + pricing
3. Cache the endpoint catalog with prices
4. Select cheapest providers for each data type needed

---

## Solidity Impact

**None.** AgentCash is entirely a TypeScript-side integration:

- No new contract functions needed
- No on-chain payment verification by the hook
- The hook does not know or care how the agent acquires market data
- AgentCash payments happen on Base mainnet USDC, separate from the vault pool

---

## Bounty Alignment (Merit/x402: $5,250)

| Requirement | How CuratedLP Satisfies It |
|---|---|
| Use x402 micropayments | Every FSM cycle pays for 3-4 market data calls |
| Meaningful integration | Data is load-bearing — Venice cannot function without it |
| Volume of requests | ~1,152 calls/day at 5-min intervals |
| On-chain payment proof | Each call generates verifiable USDC payment on Base |
| Combined with Locus | Agent wallet management + spending controls ($3,000 bounty) |

**Combined Phase 4 bounty target from AgentCash + Locus: $8,250**

---

## Quick Start Checklist

- [ ] Run `npx agentcash onboard` to create agent wallet
- [ ] Fund wallet with USDC on Base (or redeem invite code for $25 free)
- [ ] Run `npx agentcash discover https://stableenrich.dev` to catalog endpoints
- [ ] Run `npx agentcash check <endpoint>` for each data source to get schemas + pricing
- [ ] Implement `x402-client.ts` wrapping fetch with 402 handling
- [ ] Wire into FSM ANALYZE step alongside Venice AI + Olas
- [ ] Set `max_amount` guards to prevent overspend
- [ ] Connect to Locus MCP for wallet balance + spending policy checks
