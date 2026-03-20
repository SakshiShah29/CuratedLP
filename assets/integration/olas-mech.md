# Olas Mech Marketplace Integration Reference

*Sources: stack.olas.network, build.olas.network, github.com/valory-xyz/mech-client*
*Last updated: 2026-03-20 (corrected via web research)*

> **⚠️ CORRECTIONS FROM WEB RESEARCH (2026-03-20)**
> - Python version: `>=3.10, <3.15` (NOT `<3.12`)
> - `--client-mode` is a **global flag** — must precede subcommand: `mechx --client-mode request ...`
> - Using `--client-mode` skips `mechx setup` entirely (no Safe registration needed)
> - Stdout format: `✓ Transaction hash: 0x...` and `✓ Request IDs: [...]` with checkmarks
> - Result is under `✓ Delivery results:\n Request <id>: <text>` (not `Result:`)
> - Tool names confirmed: `openai-gpt-4o-2024-05-13`, `claude-prediction-online`, `claude-prediction-offline`
> - `prediction_request`, `superforecaster`, `price_oracle` are NOT confirmed tool names

---

## What Is Olas / Mech Marketplace

Olas is a platform for building, monetizing, and hiring autonomous AI agents. The **Mech Marketplace** is its agent-as-a-service layer — on-chain smart contracts that let any application post AI task requests and receive results. A "Mech" is a deployed AI agent that accepts prompts, runs a tool (e.g., GPT-4, prediction model, price oracle), and returns results either on-chain or off-chain.

**mech-client** is the Python CLI/SDK for interacting with Mechs from the marketplace.

---

## Role in CuratedLP

Olas is a **secondary intelligence input** in the agent's ANALYZE step. The curator agent sends at least 10 requests to the Mech Marketplace per session for market analysis, prediction, and cross-checking Venice AI's recommendations.

**Bounty target**: Olas — $1,000 (requires minimum 10 mech requests demonstrated)

### Where It Fits in the FSM

```
MONITOR -> ANALYZE -> DECIDE -> EXECUTE -> REPORT
               |
               |-- x402-client: market data (paid via AgentCash)
               |-- uniswap-api: Trading API price quotes (free)
               |-- mech-client: Olas Mech analysis (10+ requests) <-- THIS
               |-- venice.ts: all data -> Venice AI -> recommendation
```

The mech-client results feed into Venice AI alongside x402 market data and Uniswap quotes, giving Venice a richer dataset for tick range and fee recommendations.

---

## Supported Chains

| Chain | Marketplace | Native Payment | NVM Subscription | OLAS Payment | USDC Payment |
|---|---|---|---|---|---|
| **Gnosis** | Yes | Yes | Yes | Yes | No |
| **Base** | Yes | Yes | Yes | Yes | Yes |
| **Polygon** | Yes | No | No | Yes | Yes |
| **Optimism** | Yes | No | No | Yes | Yes |

**CuratedLP should use Base** — same chain as the vault, supports USDC payments.

---

## Installation

```bash
pip install mech-client
```

Or with Poetry:
```bash
poetry add mech-client
```

**Requirements**: Python >=3.10, <3.15 (current version: 0.20.0)

---

## CLI Command Reference

### Setup

```bash
mechx setup --chain-config <chain_name>
```

Registers agent on-chain. Supported chain configs: `gnosis`, `base`, `polygon`, `optimism`.

### Global Flags

**IMPORTANT**: Global flags come BEFORE the subcommand:

```bash
mechx --client-mode request ...   # CORRECT
mechx request --client-mode ...   # WRONG
```

| Flag | Purpose |
|---|---|
| `--client-mode` | Use EOA-based client mode (skips Safe setup, recommended for hackathon) |
| `--version` | Display version |
| `--help` | Show help |

### Request Submission

```bash
# --client-mode MUST come before the subcommand
mechx --client-mode request \
  --prompts "<text>" \
  --priority-mech <mech_address> \
  --tools <tool_name> \
  --chain-config <chain_name> \
  [--key <path_to_key_file>] \
  [--use-prepaid] \
  [--use-offchain]
```

**With `--client-mode`, no `mechx setup` is required** — it uses EOA directly.

**Batch requests** (multiple prompts + tools in one call):
```bash
mechx request \
  --prompts={prompt1,prompt2} \
  --tools={tool1,tool2} \
  --priority-mech <address> \
  --chain-config <chain_name>
```

### Stdout Output Format (mech-client v0.20.0)

```
Sending marketplace request...

✓ Transaction hash: 0xabc123...def456
✓ Request IDs: [123456789]

✓ Delivery results:
 Request 123456789: <result text or JSON>
```

**Parsing notes for TypeScript shell-out:**
- Tx hash regex: `/Transaction hash[:\s]+(0x[0-9a-fA-F]{64})/`
- Request ID regex: `/Request IDs[:\s]+\[?(\d+)/`
- Result regex: `/Request \d+[:\s]+(.+?)(?=\n[A-Z✓]|$)/s`
- Off-chain mode: `Transaction hash: None` (no on-chain tx)

### Mech Discovery

```bash
# List top 20 mechs sorted by delivery count (use --client-mode)
mechx --client-mode mech list --chain-config <chain_name>
```

Output columns: `| AI Agent Id | Mech Type | Mech Address | Total Deliveries | Metadata Link |`

Then list tools for a specific mech:

```bash
mechx --client-mode tool list <ai_agent_id> --chain-config base
```

### Tool Discovery

```bash
# List all tools for a specific mech
mechx tool list <ai_agent_id> --chain-config <chain_name>

# Get tool description
mechx tool describe <tool_unique_id> --chain-config <chain_name>

# Get tool input/output schema
mechx tool schema <tool_unique_id> --chain-config <chain_name>
```

Tool unique ID format: `<agent_id>-<tool_name>` (e.g., `1722-openai-gpt-4`)

### Deposit / Payment Management

```bash
# Deposit native tokens (ETH on Base)
mechx deposit native <amount> --chain-config <chain_name>

# Deposit OLAS tokens
mechx deposit token <amount> --chain-config <chain_name> --token-type olas

# Deposit USDC
mechx deposit token <amount> --chain-config <chain_name> --token-type usdc

# Purchase NVM subscription (unlimited requests for a period)
mechx subscription purchase --chain-config <chain_name>
```

---

## Python SDK Reference

### MarketplaceService (Primary Interface)

```python
from mech_client.services import MarketplaceService
from mech_client.domain.payment import PaymentType
from mech_client.infrastructure.config import get_mech_config
from aea_ledger_ethereum import EthereumApi, EthereumCrypto

# Load chain config
config = get_mech_config("base")

# Setup crypto from private key file
crypto = EthereumCrypto("ethereum_private_key.txt")
ledger_api = EthereumApi(**config.ledger_config.__dict__)

# Create service
service = MarketplaceService(
    chain_config="base",
    ledger_api=ledger_api,
    payer_address=crypto.address,
    mode="client",           # "client" (EOA) or "agent" (Safe multisig)
    safe_address=None         # Required if mode="agent"
)

# Send request
result = service.send_request(
    priority_mech="0x77af31De935740567Cf4fF1986D04B2c964A786a",
    tools=["openai-gpt-4o-2024-05-13"],
    prompts=["Estimate ETH volatility for the next 24 hours"],
    payment_type=PaymentType.NATIVE
)

print(f"Transaction hash: {result['tx_hash']}")
print(f"Request ID: {result['request_ids'][0]}")
print(f"Result: {result.get('result')}")
```

### ToolService (Discovery)

```python
from mech_client.services import ToolService
from mech_client.infrastructure.config import get_mech_config
from aea_ledger_ethereum import EthereumApi

config = get_mech_config("base")
ledger_api = EthereumApi(**config.ledger_config.__dict__)

tool_service = ToolService(
    chain_config="base",
    ledger_api=ledger_api
)

# List tools for a mech (by service ID)
tools = tool_service.list_tools(service_id=1722)
for tool_name, tool_id in tools:
    print(f"{tool_name}: {tool_id}")
```

### marketplace_interact (Convenience Function)

```python
from mech_client.marketplace_interact import marketplace_interact

result = marketplace_interact(
    prompts=("Estimate wstETH/USDC volatility next 4 hours",),  # Must be tuple
    priority_mech="0x77af31De935740567Cf4fF1986D04B2c964A786a",
    agent_mode=False,
    safe_address="",
    use_offchain=False,
    tools=("openai-gpt-4o-2024-05-13",),  # Must be tuple
    chain_config="base"
)
```

---

## Payment Types

The mech's smart contract determines which payment type is required (auto-detected by mech-client):

| Type | Description | How It Works |
|---|---|---|
| **NATIVE** | Per-request native token (ETH on Base) | Sent with the transaction |
| **OLAS_TOKEN** | Per-request OLAS payment | ERC20 approve + transfer |
| **USDC_TOKEN** | Per-request USDC payment | ERC20 approve + transfer |
| **NATIVE_NVM** | NVM subscription + native | Purchase subscription NFT first, then unlimited requests |
| **TOKEN_NVM_USDC** | NVM subscription + USDC | Purchase subscription NFT first |

### Finding Mech Price

1. Enter mech address in block explorer
2. Contract -> Read Contract -> `maxDeliveryRate`
3. Divide result by 10^8 for actual price in native token

### Prepaid vs Per-Request

- **Prepaid**: Deposit funds first with `deposit` command, then use `--use-prepaid` flag
- **Per-Request**: No flag needed; client handles payment automatically per call

---

## Request/Response Format

### Request Structure

```json
{
  "prompts": "string",
  "tool": "tool_name",
  "chain_config": "network_name",
  "priority_mech": "0xAddress"
}
```

### Response Structure

```json
{
  "requestId": 123456789,
  "prompt": "user_input",
  "tool": "tool_name",
  "result": "mech_response_here",
  "metadata": {}
}
```

### Prediction Tool Response Example

```json
{
  "result": {
    "p_yes": 0.35,
    "p_no": 0.65,
    "confidence": 0.85
  }
}
```

---

## On-Chain vs Off-Chain Modes

| Mode | How It Works | Flag |
|---|---|---|
| **On-Chain** (default) | Request sent to mech smart contract, relayed via marketplace, result stored on-chain | Omit `--use-offchain` |
| **Off-Chain** | Request sent directly to mech agent via HTTP, mech posts result to contract afterward | Use `--use-offchain` |

Off-chain mode auto-discovers the mech's HTTP URL from its `ComplementaryServiceMetadata` contract.

---

## Available Tool Types

### Confirmed Tool Names (as of mech-client v0.20.0)

| Tool Name | Purpose | Relevance to CuratedLP |
|---|---|---|
| `openai-gpt-4o-2024-05-13` | GPT-4o general reasoning | Market analysis, tick range, fee recommendation |
| `openai-gpt-3.5-turbo` | GPT-3.5 lightweight | Low-cost analysis |
| `openai-gpt-3.5-turbo-instruct` | GPT-3.5 instruct | Lightweight structured output |
| `claude-prediction-online` | Claude prediction with live web data | Price direction, support/resistance |
| `claude-prediction-offline` | Claude prediction without live data | Faster, cheaper predictions |
| `deepmind-optimization` | DeepMind optimization model | Advanced analysis |

> **Note**: `prediction_request`, `superforecaster`, `price_oracle` are NOT confirmed tool names.
> Use `mechx --client-mode tool list <agent_id> --chain-config base` to get the live list for your mech.

### Tool Schema Structure

Each tool exposes:
- **Tool Name**: Display identifier
- **Unique ID**: `<agent_id>-<tool_name>` format
- **Description**: What the tool does
- **Input Schema**: Expected input format (typically `type: text` — a prompt string)
- **Output Schema**: `requestId` (integer), `result` (string/object), `prompt` (string)

### Discovering Tools at Runtime

```bash
# Find mechs on Base
mechx mech list --chain-config base

# List tools for a specific mech (agent ID 2182)
mechx tool list 2182 --chain-config base

# Get schema for a specific tool
mechx tool schema 2182-prediction_request --chain-config base
```

---

## Known Mech Addresses

| Address | Agent ID | Chain |
|---|---|---|
| `0xc05e7412439bd7e91730a6880e18d5d5873f632c` | 2182 | Gnosis |
| `0xb3c6319962484602b00d5587e965946890b82101` | 2235 | Gnosis |
| `0x77af31De935740567Cf4fF1986D04B2c964A786a` | — | Gnosis |

**Note**: Use `mechx mech list --chain-config base` to discover Base-specific mechs at runtime.

---

## Environment Variables

| Variable | Purpose | Example |
|---|---|---|
| `MECHX_CHAIN_RPC` | Custom RPC endpoint | `https://base-mainnet.g.alchemy.com/v2/KEY` |
| `MECHX_SUBGRAPH_URL` | Custom subgraph URL for mech discovery | |
| `MECHX_GAS_LIMIT` | Override gas limit | `200000` |
| `MECHX_TRANSACTION_URL` | Block explorer URL | |
| `MECHX_LEDGER_CHAIN_ID` | Chain ID override | `8453` (Base) |
| `MECHX_LEDGER_POA_CHAIN` | Proof-of-Authority flag | `true` or `false` |
| `MECHX_LEDGER_DEFAULT_GAS_PRICE_STRATEGY` | Gas price strategy | |
| `MECHX_LEDGER_IS_GAS_ESTIMATION_ENABLED` | Enable gas estimation | `true` |

### Private Key Setup

```bash
# Create key file (no trailing newline)
echo -n YOUR_PRIVATE_KEY > ethereum_private_key.txt

# Add to .gitignore
echo ethereum_private_key.txt >> .gitignore
```

---

## Error Handling

| Error | Cause | Solution |
|---|---|---|
| Non-hexadecimal character | Trailing newline in private key file | Use `echo -n` when writing key |
| Out of gas | Default gas limit too low | `export MECHX_GAS_LIMIT=200000` |
| Timeout waiting for response | Slow RPC or network congestion | Use reliable RPC provider, set `MECHX_CHAIN_RPC` |
| Result not returned | Mech processing delay | Note `request_id`, retrieve manually from marketplace UI |

### Manual Result Retrieval (Timeout Fallback)

1. Note the `request_id` from logs
2. Convert to hex: `printf "%x\n" <request_id>`
3. Visit `marketplace.olas.network/<chain>/ai-agents`
4. Find the mech by agent ID
5. Locate request by hex ID
6. Click "Delivers Data" to view response

---

## CuratedLP Integration Design

### mech-client.ts Responsibilities

Since the mech-client SDK is Python-only, the TypeScript agent has two integration options:

**Option A: Shell out to CLI** (simpler, recommended for hackathon)
```
mech-client.ts -> spawns `mechx request ...` CLI commands -> parses JSON output
```

**Option B: HTTP off-chain mode** (no Python dependency)
```
mech-client.ts -> discovers mech HTTP URL from contract metadata -> direct HTTP POST
```

### 10+ Required Requests (Bounty Minimum)

The agent should make at least 10 mech requests per session. Proposed request breakdown:

| # | Prompt | Tool | Purpose |
|---|---|---|---|
| 1 | "Probability ETH/USDC price increases next 4 hours?" | `claude-prediction-online` | Direction bias (bull) |
| 2 | "Probability ETH drops >2% in 4 hours?" | `claude-prediction-online` | Downside risk |
| 3 | "Probability ETH rises >2% in 4 hours?" | `claude-prediction-online` | Upside probability |
| 4 | "Estimate ETH implied volatility next 24 hours. Return % only." | `openai-gpt-4o-2024-05-13` | Volatility estimate |
| 5 | "Optimal tick range [tickLower,tickUpper] for wstETH/USDC LP. Reply as JSON." | `openai-gpt-4o-2024-05-13` | Range recommendation |
| 6 | "Optimal fee tier (bps) for wstETH/USDC pool. Reply as JSON." | `openai-gpt-4o-2024-05-13` | Fee recommendation |
| 7 | "Nearest ETH/USD resistance — probability of break in 4 hours?" | `claude-prediction-online` | Technical resistance |
| 8 | "Nearest ETH/USD support — probability of break below in 4 hours?" | `claude-prediction-online` | Technical support |
| 9 | "Summarize DeFi market sentiment for ETH ecosystem in 2-3 sentences." | `openai-gpt-4o-2024-05-13` | Sentiment input |
| 10 | "Should LP rebalance? Narrow/widen/keep. Reply as JSON." | `openai-gpt-4o-2024-05-13` | Rebalance decision |

These results are aggregated and passed to Venice AI as structured context for the final rebalance decision.

### Data Flow

```
mech-client.ts
    |
    |-- 10+ requests to Olas Mech Marketplace
    |       |-- prediction_request: p_yes/p_no/confidence
    |       |-- superforecaster: calibrated probabilities
    |       |-- price_oracle: current prices
    |       |-- openai-gpt-4o: analysis text
    |
    |-- Aggregate results into structured JSON
    |
    v
venice.ts
    |-- Receives: mech results + x402 market data + uniswap quotes
    |-- Sends to Venice AI for final recommendation
    |-- Returns: { newTickLower, newTickUpper, newFee }
```

### Connection to Agent Wallet

Mech requests require payment. On Base, the agent can pay with:
- **ETH** (native) — simplest, per-request
- **USDC** — if mech supports it on Base
- **OLAS token** — if available in agent wallet
- **Prepaid deposit** — deposit once, use `--use-prepaid` for all requests

The same Locus-managed wallet that funds AgentCash payments can fund mech requests.

---

## Solidity Impact

**None.** Olas integration is entirely TypeScript-side:
- No new contract functions
- No on-chain interaction between the vault and Olas
- Mech requests happen on Base mainnet, separate from vault operations
- Results are consumed off-chain by the agent before executing on-chain rebalance

---

## Bounty Alignment (Olas: $1,000)

| Requirement | How CuratedLP Satisfies It |
|---|---|
| Use Olas Mech Marketplace | mech-client requests in every FSM ANALYZE cycle |
| Minimum 10 requests | 10 distinct prompts per session (predictions, prices, analysis) |
| Meaningful integration | Mech results are load-bearing input to Venice AI's rebalance decision |
| On-chain proof | Each mech request generates an on-chain transaction with tx_hash |

---

## Quick Start Checklist

- [ ] Install mech-client: `pip install mech-client` (Python >=3.10, <3.15)
- [ ] Create private key file (no trailing newline): `echo -n $AGENT_PRIVATE_KEY > ethereum_private_key.txt`
- [ ] Set Base RPC: `export MECHX_CHAIN_RPC=<base_rpc_url>`
- [ ] Discover mechs (use --client-mode BEFORE subcommand): `mechx --client-mode mech list --chain-config base`
- [ ] List tools: `mechx --client-mode tool list <agent_id> --chain-config base`
- [ ] Test a request: `mechx --client-mode request --prompts "test" --tools openai-gpt-4o-2024-05-13 --chain-config base --priority-mech <address> --key ethereum_private_key.txt`
- [ ] Deposit funds: `mechx --client-mode deposit native 0.01 --chain-config base`
- [ ] Set OLAS_MECH_ADDRESS in .env with discovered address
- [ ] Implement olas-analyze.ts (shell-out via Node execFile to mechx)
- [ ] Wire 10+ requests into FSM ANALYZE step
- [ ] Aggregate results and pass to venice-analyze.ts
