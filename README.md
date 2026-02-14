# Red Envelope

Send lucky GAS gifts to friends on Neo N3

## Overview

| Property      | Value                 |
| ------------- | --------------------- |
| **App ID**    | `miniapp-redenvelope` |
| **Category**  | Social                |
| **Version**   | 1.0.0                 |
| **Framework** | Vue 3 + Vite          |
| **Standard**  | NEP-11 (NFT)          |
| **Network**   | Neo N3 MainNet        |

## Features

- GAS red envelopes with on-chain randomness
- Two modes: Pool (multi-claimer) and Lucky NFT (single spreading)
- NEO-weighted luck boost — holding more NEO improves your odds
- Claim NFT minting, persistent transferability, and open-to-earn mechanics
- Upgradable contract with admin pause/resume circuit breaker
- Bilingual UI (English / 中文)

## Network Configuration

| Property          | Value                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Contract**      | `0x215099698349ba405400b3b2fe97bb96941c0f9b`                                              |
| **RPC**           | `https://mainnet1.neo.coz.io:443`                                                         |
| **Explorer**      | [View on NeoTube](https://neotube.io/contract/0x215099698349ba405400b3b2fe97bb96941c0f9b) |
| **Network Magic** | `860833102`                                                                               |

## Platform Contracts

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| PaymentHub          | `0xc700fa6001a654efcd63e15a3833fbea7baaa3a3` |
| Governance          | `0x705615e903d92abf8f6f459086b83f51096aa413` |
| PriceFeed           | `0x9e889922d2f64fa0c06a28d179c60fe1af915d27` |
| RandomnessLog       | `0x66493b8a2dee9f9b74a16cf01e443c3fe7452c25` |
| AppRegistry         | `0x583cabba8beff13e036230de844c2fb4118ee38c` |
| AutomationAnchor    | `0x0fd51557facee54178a5d48181dcfa1b61956144` |
| ServiceLayerGateway | `0x7f73ae3036c1ca57cad0d4e4291788653b0fa7d7` |

## Development

```bash
# Install frontend dependencies
cd frontend && npm install

# Configure frontend (defaults to mainnet)
cp .env.example .env

# Development server
cd .. && npm run dev

# Build frontend
npm run build

# Build Neo N3 contract (.nef + .manifest)
npm run contract:build
```

Contract artifacts are generated at:

- `contracts/bin/sc/RedEnvelope.nef`
- `contracts/bin/sc/RedEnvelope.manifest.json`

### Deployment Scripts

| Script                      | Purpose                            |
| --------------------------- | ---------------------------------- |
| `scripts/deploy-mainnet.js` | Deploy a fresh contract to mainnet |
| `scripts/deploy-update.js`  | Upgrade existing contract in-place |
| `scripts/test-e2e.js`       | Full E2E workflow validation       |

```bash
# Deploy new contract
DEPLOYER_WIF=... node scripts/deploy-mainnet.js

# Upgrade existing contract
KEY1_WIF=... KEY2_WIF=... node scripts/deploy-update.js

# Run E2E tests
KEY1_WIF=... KEY2_WIF=... node scripts/test-e2e.js
```

## Usage

### Red Envelope Pool (multi-claimer)

1. Creator sends GAS and configures packet count, NEO gate, and expiry time.
2. Users claim one slot from the pool; each claim mints one **Claim NFT**.
3. **Claiming is not the same as receiving GAS** — the holder must call `OpenClaim` to receive reward.
4. Claim NFTs remain transferable before and after opening.
5. If a user never opens the Claim NFT before expiry, they receive **0 GAS**.
6. After expiry, only the pool issuer can reclaim unclaimed pool balance and unopened claim balances.

### Lucky NFT (single spreading envelope)

1. Creator sends GAS and mints **one single Lucky NFT** with open-count and expiry.
2. The current holder can choose to open once for random GAS, then transfer to next holder.
3. If a holder only transfers without opening, that holder gets **no reward**.
4. Each address can open that envelope only once.
5. When all open-count is used, reward is depleted but the NFT remains transferable.
6. After expiry, only the original issuer can reclaim remaining GAS.

### NEO-Weighted Luck Boost

The random GAS distribution uses a "best-of-N" roll mechanism based on the opener's NEO balance:

| NEO Balance | Rolls | Effect                     |
| ----------- | ----- | -------------------------- |
| 0–99        | 1     | Baseline uniform random    |
| 100–999     | 2     | Keep the better of 2 rolls |
| 1000+       | 3     | Keep the best of 3 rolls   |

More NEO improves your odds of a larger reward but never guarantees the maximum. All rolls are extracted from a single `Runtime.GetRandom()` call using bit-shifted division.

## Core Rules

- **Only real users can open/claim**: contract accounts are rejected for open/claim actions.
- **Open is required to receive GAS**: holding or claiming NFT alone does not transfer GAS.
- **Expiry is enforced**: open/claim operations are blocked after expiry.
- **NFTs are never burned by open/reclaim flows**: settled envelopes can still be transferred as collectibles.
- **Minimum amounts**: total per envelope is at least `1 GAS`, and each packet/slot is at least `0.1 GAS`.

## Contract API

All functions below have been validated on Neo N3 MainNet.
To run E2E tests, set `KEY1_WIF` and `KEY2_WIF` and execute `node scripts/test-e2e.js`.

### Entry Point

| Method           | Params                   | Returns | Description                                                                                                                     |
| ---------------- | ------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `OnNEP17Payment` | `from`, `amount`, `data` | —       | Receives GAS and creates an envelope. `data` is an array: `[packetCount, expiryMs, message, minNeo, minHoldSec, envelopeType]`. |

### Spreading Envelope (Lucky NFT)

| Method             | Params                             | Returns                   | Description                                  |
| ------------------ | ---------------------------------- | ------------------------- | -------------------------------------------- |
| `OpenEnvelope`     | `envelopeId`, `opener`             | `BigInteger` (GAS amount) | Current holder opens for random GAS.         |
| `TransferEnvelope` | `envelopeId`, `from`, `to`, `data` | —                         | Transfer the Lucky NFT to another user.      |
| `ReclaimEnvelope`  | `envelopeId`, `creator`            | `BigInteger` (refund)     | Creator reclaims remaining GAS after expiry. |

### Pool Envelope

| Method          | Params                  | Returns                     | Description                                  |
| --------------- | ----------------------- | --------------------------- | -------------------------------------------- |
| `ClaimFromPool` | `poolId`, `claimer`     | `BigInteger` (claim NFT id) | Claim a slot; mints a Claim NFT.             |
| `OpenClaim`     | `claimId`, `opener`     | `BigInteger` (GAS amount)   | Open a Claim NFT to receive GAS.             |
| `TransferClaim` | `claimId`, `from`, `to` | —                           | Transfer a Claim NFT (opened or unopened).   |
| `ReclaimPool`   | `poolId`, `creator`     | `BigInteger` (refund)       | Creator reclaims unclaimed GAS after expiry. |

### Query (read-only)

| Method                    | Params                 | Returns      | Description                  |
| ------------------------- | ---------------------- | ------------ | ---------------------------- |
| `GetEnvelopeState`        | `envelopeId`           | `Map`        | Full envelope metadata.      |
| `GetClaimState`           | `claimId`              | `Map`        | Claim NFT metadata.          |
| `CheckEligibility`        | `envelopeId`, `user`   | `Map`        | Whether user can open/claim. |
| `HasOpened`               | `envelopeId`, `opener` | `bool`       | Whether address has opened.  |
| `GetOpenedAmount`         | `envelopeId`, `opener` | `BigInteger` | GAS received by opener.      |
| `HasClaimedFromPool`      | `poolId`, `claimer`    | `bool`       | Whether address has claimed. |
| `GetPoolClaimedAmount`    | `poolId`, `claimer`    | `BigInteger` | GAS amount in claim.         |
| `GetPoolClaimIdByIndex`   | `poolId`, `claimIndex` | `BigInteger` | Claim NFT id by index.       |
| `GetTotalEnvelopes`       | —                      | `BigInteger` | Global envelope counter.     |
| `GetTotalDistributed`     | —                      | `BigInteger` | Total GAS distributed.       |
| `GetCalculationConstants` | —                      | `Map`        | Min amounts, max caps.       |

### Admin

| Method             | Params            | Returns   | Description                   |
| ------------------ | ----------------- | --------- | ----------------------------- |
| `GetOwner`         | —                 | `UInt160` | Current contract owner.       |
| `SetOwner`         | `newOwner`        | —         | Transfer ownership.           |
| `IsOwner`          | —                 | `bool`    | Check caller is owner.        |
| `Pause` / `Resume` | —                 | —         | Emergency circuit breaker.    |
| `IsPaused`         | —                 | `bool`    | Pause state.                  |
| `Update`           | `nef`, `manifest` | —         | Upgrade contract on-chain.    |
| `Destroy`          | —                 | —         | Permanently destroy contract. |

### Events

| Event              | Fields                                   | Trigger                       |
| ------------------ | ---------------------------------------- | ----------------------------- |
| `EnvelopeCreated`  | `id, creator, amount, packetCount, type` | Envelope or Claim NFT minted  |
| `EnvelopeOpened`   | `id, opener, amount`                     | GAS distributed to opener     |
| `EnvelopeRefunded` | `id, creator, amount`                    | Creator reclaims after expiry |

## How It Works

1. **Cultural Tradition**: Based on the Chinese tradition of hongbao (lucky money)
2. **Smart Contract Escrow**: Issuer's GAS stays in contract until users open claims
3. **NEO-Weighted Randomness**: Packet amounts use Neo runtime randomness with a best-of-N luck boost for NEO holders
4. **Two Modes**: Pool mode (claim NFT per slot) and Lucky NFT mode (single transferable envelope)
5. **Open-to-Earn**: Users receive GAS only when they execute open operation
6. **Expiry + Reclaim**: After expiry, only issuer can reclaim unopened/remaining GAS
7. **Persistent NFTs**: Opened/depleted envelopes remain as transferable NFTs (no burn on settlement)
8. **Upgradable**: Contract owner can push updates via `Update(nef, manifest)` without redeployment

## Assets

- **Allowed Assets**: GAS
- **Max per TX**: 100 GAS
- **Daily Cap**: 500 GAS

## License

MIT License - R3E Network
