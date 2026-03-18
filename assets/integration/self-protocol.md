# Self Protocol Integration Reference

*Source: https://docs.self.xyz/llms-full.txt*
*Last updated: 2026-03-18*

---

## What Is Self Protocol

Self Protocol is a privacy-first, open-source identity protocol using zero-knowledge proofs for secure identity verification. Users scan real-world documents (passports, ID cards, Aadhaar, KYC attestations) in the Self app, ZK proofs are generated over the attestations with selective disclosure, and proofs are shared with requesting applications — on-chain or off-chain — without revealing the underlying personal data.

---

## Role in CuratedLP

Self Protocol is the **secondary identity layer** for curator agents. It sits on top of the primary ERC-8004 identity gating, providing a verifiable, privacy-preserving proof that the agent operator is a real person (or at least controls a verified identity document). This is **additive, not blocking** — ERC-8004 remains the primary gate for `registerCurator()`.

**Bounty target**: Self Protocol — $1,000 (Best Agent ID Integration)

---

## Architecture: How Self Fits in the Stack

```
┌─────────────────────────────────────────────────────────────┐
│  Curator Registration Flow                                   │
│                                                               │
│  Step 1 (Primary - ERC-8004):                                │
│    registerCurator(performanceFeeBps, erc8004IdentityId)     │
│    └─ Hook calls IDENTITY_REGISTRY.ownerOf(identityId)       │
│    └─ Must return msg.sender → registration proceeds         │
│                                                               │
│  Step 2 (Secondary - Self Protocol):                         │
│    Agent verifies identity via Self Protocol                  │
│    └─ ZK proof of passport/ID ownership                      │
│    └─ On-chain verification on Celo via VerificationHub      │
│    └─ Verified status queryable by anyone                    │
│    └─ Optional: store verification hash in agent metadata    │
│                                                               │
│  Result:                                                      │
│    Curator has BOTH:                                          │
│    - ERC-8004 identity NFT (Base Sepolia) — load-bearing     │
│    - Self Protocol verification (Celo) — trust-enhancing     │
└─────────────────────────────────────────────────────────────┘
```

---

## Self Protocol Core Concepts

### Verification Flow

```
1. User downloads Self app and scans a supported document
   (e-passport, EU ID card, Aadhaar, or KYC/Sumsub attestation)

2. Self app extracts NFC-signed data from the document chip

3. When verification is requested:
   - User selects what to disclose (nationality, age threshold, etc.)
   - ZK proof is generated locally on device
   - Proof is submitted to verifier (on-chain contract or backend)

4. Verifier checks proof validity without seeing the raw document data
```

### Supported Document Types

| Attestation ID | Document Type | Coverage |
|----------------|--------------|----------|
| 1 | E-Passport | 160+ countries |
| 2 | EU ID Card | EU member states |
| 3 | Aadhaar | India |
| 4 | KYC/Sumsub | Selfrica ID Card |

### Disclosure Options

**Verification Requirements** (boolean pass/fail, no data revealed):

| Option | Type | Description |
|--------|------|-------------|
| `minimumAge` | number (0-99) | Proves user is at least N years old without revealing DOB |
| `excludedCountries` | string[] | ISO 3-letter codes, max 40 countries |
| `ofac` | boolean | Sanctions list screening |

**Data Disclosure Requests** (actual values revealed if user consents):

| Field | Type | Description |
|-------|------|-------------|
| `name` | boolean | Full name from document |
| `nationality` | boolean | Country of citizenship |
| `gender` | boolean | M or F |
| `date_of_birth` | boolean | Complete date |
| `passport_number` | boolean | Document identifier |
| `expiry_date` | boolean | Document expiration |
| `issuing_state` | boolean | Issuing country |

---

## Two Verification Approaches

### Option A: On-Chain Verification (Recommended for CuratedLP)

Smart contracts on Celo receive and validate ZK proofs trustlessly via the `SelfVerificationHub`.

**Pros**: Fully trustless, queryable by anyone, composable with other contracts
**Cons**: Requires Celo deployment (separate chain from Base Sepolia)

### Option B: Backend Verification

Server-side validation using `SelfBackendVerifier` SDK.

**Pros**: Simpler setup, no contract deployment needed
**Cons**: Requires trust in the backend operator

**Recommendation for CuratedLP**: Use **backend verification** for hackathon speed, with the verification result stored as agent metadata. On-chain verification on Celo is the ideal production path but adds cross-chain complexity that isn't necessary for the bounty.

---

## Implementation Plan for Phase 5

### What Phase 5 Builds (Self Protocol Portion)

Phase 5's goal is: *"Write performance data to ERC-8004 ReputationRegistry. Add Self Protocol and ENS layers."*

Self Protocol specifically:
1. Agent operator verifies their identity via Self Protocol (one-time setup)
2. Verification result is stored/queryable
3. `registerCurator()` flow remains unchanged — ERC-8004 is primary, Self is additive trust signal

### Integration Architecture

Since Phase 4 agent TypeScript is implemented, Self Protocol adds a `self-identity.ts` module that runs once during agent initialization (not every FSM cycle).

```
Agent Startup (one-time)
  │
  ├─ Phase 4 already done:
  │   ├─ Locus wallet funded
  │   ├─ x402/AgentCash configured
  │   ├─ Venice AI connected
  │   ├─ Delegation redemption working
  │   └─ FSM loop running
  │
  ├─ Phase 5 — Self Protocol:
  │   │
  │   ├─ 1. Generate verification request (SelfAppBuilder)
  │   │      └─ scope: "curatedlp-curator-id"
  │   │      └─ disclosures: { nationality: true, ofac: true }
  │   │      └─ endpoint: backend URL or Celo contract
  │   │
  │   ├─ 2. Operator scans passport in Self app
  │   │      └─ QR code displayed or deep link sent
  │   │      └─ One-time human interaction
  │   │
  │   ├─ 3. Verify proof (backend or on-chain)
  │   │      └─ SelfBackendVerifier.verify(attestationId, proof, signals, context)
  │   │      └─ Returns: nationality, ofac status, nullifier
  │   │
  │   └─ 4. Store verification status
  │          └─ Log to agent metadata
  │          └─ Optionally write hash to ReputationRegistry feedback
  │
  └─ Phase 5 — Reputation (separate):
      └─ REPORT state writes metrics to ReputationRegistry
```

---

## `self-identity.ts` Module Design

### Dependencies

```bash
npm install @selfxyz/qrcode @selfxyz/core
```

### Exports

```typescript
// One-time identity verification setup
generateVerificationRequest(): { qrData: object, deepLink: string }

// Backend verification of submitted proof
verifyIdentityProof(
  attestationId: number,
  proof: object,
  publicSignals: string[],
  userContext: string
): Promise<VerificationResult>

// Check if agent operator has been verified
isOperatorVerified(): boolean

// Get disclosed attributes (after verification)
getVerifiedAttributes(): { nationality?: string, ofac?: boolean, nullifier?: string }
```

### Verification Request Generation

```typescript
import { SelfAppBuilder } from '@selfxyz/qrcode'

function generateVerificationRequest(curatorAddress: string) {
  const selfApp = new SelfAppBuilder({
    version: 2,
    appName: "CuratedLP Vault Curator",
    scope: "curatedlp-curator-id",
    endpoint: VERIFICATION_ENDPOINT, // backend URL
    userId: curatorAddress,
    userIdType: "hex",
    endpointType: "https", // or "staging_https" for testing
    disclosures: {
      // Verification requirements (no data revealed)
      ofac: true,                        // Not on sanctions list
      excludedCountries: ["PRK", "IRN"], // Not from sanctioned nations

      // Data disclosure requests (revealed with consent)
      nationality: true,                 // Know which country
    }
  }).build()

  return {
    qrData: selfApp,
    deepLink: getUniversalLink(selfApp)  // For mobile same-device flow
  }
}
```

### Backend Verification

```typescript
import { SelfBackendVerifier, DefaultConfigStore, AllIds } from '@selfxyz/core'

const verifier = new SelfBackendVerifier(
  "curatedlp-curator-id",        // scope — must match frontend
  VERIFICATION_ENDPOINT,          // backend endpoint
  false,                          // mockPassport (true for testing)
  AllIds,                         // accept all document types
  new DefaultConfigStore({
    minimumAge: 0,                // no age requirement
    excludedCountries: ["PRK", "IRN"],
    ofac: true
  }),
  "hex"                           // userIdentifierType (Ethereum address)
)

async function verifyIdentityProof(
  attestationId: number,
  proof: object,
  publicSignals: string[],
  userContext: string
): Promise<VerificationResult> {
  const result = await verifier.verify(
    attestationId,
    proof,
    publicSignals,
    userContext
  )

  // Result structure:
  // {
  //   attestationId: 1,
  //   isValidDetails: {
  //     isValid: true,
  //     isOlderThanValid: true,
  //     isOfacValid: true
  //   },
  //   discloseOutput: {
  //     nationality: "FRA",
  //     ofac: [...],
  //   },
  //   userData: {
  //     userIdentifier: "0xCuratorAddress",
  //     userDefinedData: "..."
  //   }
  // }

  return result
}
```

---

## On-Chain Verification (Alternative Path)

If deploying a verifier contract on Celo, inherit from `SelfVerificationRoot`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SelfVerificationRoot} from "@selfxyz/contracts/contracts/abstract/SelfVerificationRoot.sol";
import {ISelfVerificationRoot} from "@selfxyz/contracts/contracts/interfaces/ISelfVerificationRoot.sol";

contract CuratorIdentityVerifier is SelfVerificationRoot {
    // Mapping: curator address => verified
    mapping(address => bool) public isVerified;
    mapping(address => string) public verifiedNationality;

    bytes32 public verificationConfigId;

    constructor(
        address hubV2,           // Celo Hub address
        string memory scopeSeed  // max 31 ASCII chars, hashed with contract address
    ) SelfVerificationRoot(hubV2, scopeSeed) {}

    /// @notice Returns the config ID for this verification request.
    function getConfigId(
        bytes32 /* destinationChainId */,
        bytes32 /* userIdentifier */,
        bytes memory /* userDefinedData */
    ) public view override returns (bytes32) {
        return verificationConfigId;
    }

    /// @notice Called automatically after successful ZK proof verification.
    function customVerificationHook(
        ISelfVerificationRoot.GenericDiscloseOutputV2 memory output,
        bytes memory /* userData */
    ) internal override {
        address curator = address(uint160(uint256(output.userIdentifier)));
        isVerified[curator] = true;

        // Store disclosed nationality if provided
        if (bytes(output.nationality).length > 0) {
            verifiedNationality[curator] = output.nationality;
        }
    }
}
```

### GenericDiscloseOutputV2 Fields

| Field | Type | Description |
|-------|------|-------------|
| `attestationId` | uint256 | Document type (1=passport, 2=EU ID, etc.) |
| `userIdentifier` | bytes32 | Curator's address (hex-encoded) |
| `nullifier` | bytes32 | Replay prevention — unique per document+scope |
| `nationality` | string | Country (if disclosed) |
| `gender` | string | M/F (if disclosed) |
| `name` | string[] | Name parts (if disclosed) |
| `dateOfBirth` | string | DOB (if disclosed) |
| `issuingState` | string | Document issuing country |
| `idNumber` | string | Document number (if disclosed) |
| `expiryDate` | string | Document expiry (if disclosed) |
| `minimumAge` | string | Age verification result |
| `ofac` | string[] | Sanctions check results |

### Deployed Hub Contracts

| Network | Address | Use |
|---------|---------|-----|
| **Celo Mainnet** | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | Real documents |
| **Celo Sepolia** | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` | Mock documents / testing |

---

## Connection to Existing CuratedVaultHook

The hook's `registerCurator()` currently requires only ERC-8004:

```solidity
function registerCurator(uint256 performanceFeeBps, uint256 erc8004IdentityId)
    external returns (uint256 curatorId)
{
    // Check 1: Not already registered
    // Check 2: Performance fee within bounds
    // Check 3: Caller owns ERC-8004 identity NFT
    address identityOwner = IDENTITY_REGISTRY.ownerOf(erc8004IdentityId);
    if (identityOwner != msg.sender) revert CuratedVaultHook_IdentityNotOwned();
    // ... store curator
}
```

**Self Protocol does NOT modify this function.** The integration is additive:

1. Agent registers via `registerCurator()` — ERC-8004 check passes
2. Agent separately verifies via Self Protocol — proof stored off-chain or on Celo
3. Frontend/dashboard queries both: "Does this curator have ERC-8004? Does it have Self verification?"
4. LPs see both trust signals when choosing a curator

This means **zero Solidity changes** to the existing hook contract.

---

## Connection to ReputationRegistry (Phase 5)

After Self verification completes, the agent can optionally include the verification status in its ReputationRegistry feedback:

```typescript
// In the REPORT state of the FSM loop
const feedbackPayload = {
  rebalanceCount: metrics.rebalanceCount,
  avgFeeRevenue: metrics.avgFeeRevenue,
  tickAccuracy: metrics.tickAccuracy,
  selfVerified: isOperatorVerified(),          // boolean
  selfNationality: getVerifiedAttributes().nationality  // optional
}

// Encode and submit to ReputationRegistry
const encoded = ethers.utils.defaultAbiCoder.encode(
  ['uint256', 'uint256', 'uint256', 'bool', 'string'],
  [feedbackPayload.rebalanceCount, ...]
)

await reputationRegistry.submitFeedback(curatorIdentityId, encoded)
```

This makes Self verification status **permanently queryable on-chain** via the ReputationRegistry, even though the Self proof itself lives on Celo.

---

## Testing with Mock Passports

For hackathon development, Self provides a mock passport flow:

### Setup

1. Download the Self app
2. On the home screen, tap the **passport button 5 times** to enable mock mode
3. A mock passport is generated automatically

### Configuration for Testing

```typescript
// Backend verifier — enable mock mode
const verifier = new SelfBackendVerifier(
  "curatedlp-curator-id",
  VERIFICATION_ENDPOINT,
  true,                    // mockPassport = true
  AllIds,
  new DefaultConfigStore({
    excludedCountries: ["PRK", "IRN"],
    ofac: false            // MUST be false for mock passports
  }),
  "hex"
)

// Frontend — use staging endpoint
const selfApp = new SelfAppBuilder({
  ...config,
  endpointType: "staging_https",  // staging for mock documents
}).build()
```

**Important**: `ofac` must be `false` when using mock passports. Staging endpoints point to `playground.staging.self.xyz`.

---

## Where Self Fits in the FSM

Self Protocol is **NOT part of the 5-minute FSM loop**. It runs once during agent initialization:

```
Agent Lifecycle:
  │
  ├─ INIT (one-time, Phase 5)
  │   ├─ Register curator (ERC-8004) ── already done in Phase 2
  │   ├─ Verify via Self Protocol ────── NEW in Phase 5
  │   └─ Register Basename ──────────── NEW in Phase 5 (ENS)
  │
  └─ FSM LOOP (every 5 minutes, Phase 4)
      ├─ MONITOR ── read pool state
      ├─ ANALYZE ── x402 data + Venice AI + Olas
      ├─ DECIDE ─── compare recommendation vs current
      ├─ EXECUTE ── redeem delegation, rebalance
      └─ REPORT ── write to ReputationRegistry (includes Self status)
```

---

## Error Handling

| Error | Cause | Resolution |
|-------|-------|------------|
| `ScopeMismatch` | Frontend scope differs from backend/contract | Ensure `scope` string is identical everywhere |
| `ConfigMismatch` | Frontend disclosures differ from backend config | Match `excludedCountries`, `ofac`, `minimumAge` exactly |
| `InvalidIdentityCommitmentRoot` | Real passport on testnet or mock on mainnet | Use staging endpoints for mock, mainnet for real |
| `DOCTYPE` | Malformed callback URL (common with ngrok) | Check endpoint URL is clean HTTPS |
| Document not supported | Country not in Self's coverage | Check map.self.xyz — 160+ countries supported |
| User denies disclosure | User doesn't consent to nationality reveal | Gracefully degrade — Self verification is optional |

---

## Implementation Checklist

### One-Time Setup (Agent Operator)

- [ ] Download Self app on mobile device
- [ ] Scan passport (or enable mock mode: tap passport button 5x)
- [ ] Install SDKs: `npm install @selfxyz/qrcode @selfxyz/core`

### `self-identity.ts` Implementation

- [ ] Implement `generateVerificationRequest()` with SelfAppBuilder
- [ ] Implement verification endpoint (Express route or similar)
- [ ] Implement `verifyIdentityProof()` with SelfBackendVerifier
- [ ] Store verification result in agent state
- [ ] Implement `isOperatorVerified()` and `getVerifiedAttributes()`

### Integration with FSM

- [ ] Call `generateVerificationRequest()` during agent INIT
- [ ] Display QR code or deep link for operator to scan
- [ ] Wait for verification callback
- [ ] Include `selfVerified` flag in ReputationRegistry feedback (REPORT state)

### Verification Checklist (Before Moving On)

- [ ] Agent operator has scanned passport in Self app
- [ ] Backend verifier returns `isValid: true` with disclosed nationality
- [ ] `isOperatorVerified()` returns `true` after verification
- [ ] ReputationRegistry feedback includes `selfVerified: true`
- [ ] `registerCurator()` still works end-to-end (Self is additive, not blocking)
- [ ] Verify via block explorer or Self dashboard that verification exists

---

## Bounty Alignment ($1,000 Self Protocol Prize)

| Requirement | How CuratedLP Satisfies It |
|-------------|---------------------------|
| Use Self for agent identity | Curator agent verifies operator identity via passport ZK proof |
| Meaningful integration | Identity is trust-enhancing — LPs can verify curator is a real person |
| Privacy-preserving | ZK proof reveals only nationality + OFAC status, not raw passport data |
| On-chain queryable | Verification status included in ReputationRegistry feedback entries |
| Complementary to existing identity | Layers on top of ERC-8004, not a replacement |

---

## Key Constants

| Item | Value |
|------|-------|
| Self app | Download from self.xyz |
| Coverage map | map.self.xyz |
| Celo Hub (mainnet) | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` |
| Celo Hub (testnet) | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| Staging playground | `playground.staging.self.xyz` |
| npm: QR/frontend | `@selfxyz/qrcode` |
| npm: backend verifier | `@selfxyz/core` |
| npm: contracts | `@selfxyz/contracts` |
| Scope for CuratedLP | `"curatedlp-curator-id"` |
| Attestation IDs | 1=passport, 2=EU ID, 3=Aadhaar, 4=KYC |

---

## Solidity Impact

**None for the existing hook.** Self Protocol integration is entirely TypeScript-side:

- `registerCurator()` is unchanged — ERC-8004 remains the primary gate
- Self verification happens separately, off-chain or on Celo
- No new imports, no new contract functions, no redeployment needed
- The only on-chain touchpoint is optionally including `selfVerified` in ReputationRegistry feedback bytes

If a Celo verifier contract is deployed (stretch goal), it lives on Celo — completely separate from the Base Sepolia hook deployment.
