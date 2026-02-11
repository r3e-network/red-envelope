# Red Envelope

Send lucky GAS gifts to friends

## Overview

| Property      | Value                 |
| ------------- | --------------------- |
| **App ID**    | `miniapp-redenvelope` |
| **Category**  | Social                |
| **Version**   | 1.0.0                 |
| **Framework** | Vue 3 + Vite          |

## Features

- Red-envelope
- Social
- Gift
- Lucky

## Permissions

| Permission | Required |
| ---------- | -------- |
| Payments   | ✅ Yes   |
| RNG        | ✅ Yes   |
| Data Feed  | ❌ No    |
| Governance | ❌ No    |

## Network Configuration

### Testnet

| Property          | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **Contract**      | `0x36a46aa95413029e340e57365cdadd3ae29244ff`                                                      |
| **RPC**           | `https://testnet1.neo.coz.io:443`                                                                 |
| **Explorer**      | [View on NeoTube](https://testnet.neotube.io/contract/0x36a46aa95413029e340e57365cdadd3ae29244ff) |
| **Network Magic** | `894710606`                                                                                       |

### Mainnet

| Property          | Value                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------- |
| **Contract**      | `0x5f371cc50116bb13d79554d96ccdd6e246cd5d59`                                              |
| **RPC**           | `https://mainnet1.neo.coz.io:443`                                                         |
| **Explorer**      | [View on NeoTube](https://neotube.io/contract/0x5f371cc50116bb13d79554d96ccdd6e246cd5d59) |
| **Network Magic** | `860833102`                                                                               |

## Platform Contracts

### Testnet

| Contract            | Address                                      |
| ------------------- | -------------------------------------------- |
| PaymentHub          | `0x0bb8f09e6d3611bc5c8adbd79ff8af1e34f73193` |
| Governance          | `0xc8f3bbe1c205c932aab00b28f7df99f9bc788a05` |
| PriceFeed           | `0xc5d9117d255054489d1cf59b2c1d188c01bc9954` |
| RandomnessLog       | `0x76dfee17f2f4b9fa8f32bd3f4da6406319ab7b39` |
| AppRegistry         | `0x79d16bee03122e992bb80c478ad4ed405f33bc7f` |
| AutomationAnchor    | `0x1c888d699ce76b0824028af310d90c3c18adeab5` |
| ServiceLayerGateway | `0x27b79cf631eff4b520dd9d95cd1425ec33025a53` |

### Mainnet

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
cd frontend
npm install

# Configure frontend
cp .env.example .env

# Development server
cd ..
npm run dev

# Build frontend
npm run build

# Build Neo N3 contract (.nef + .manifest)
npm run contract:build
```

Contract artifacts are generated at:

- `contracts/bin/sc/RedEnvelope.nef`
- `contracts/bin/sc/RedEnvelope.manifest.json`

## Usage

### Red Envelope Pool (multi-claimer)

1. Creator sends GAS and configures packet count, NEO gate, and expiry time.
2. Users claim one slot from the pool; each claim mints one **Claim NFT**.
3. **Claiming is not the same as receiving GAS** — the holder must call `OpenClaim` to receive reward.
4. Before opening, the Claim NFT can be transferred to another user.
5. If a user never opens the Claim NFT before expiry, they receive **0 GAS**.
6. After expiry, only the pool issuer can reclaim unclaimed pool balance and unopened claim balances.

### Lucky NFT (single spreading envelope)

1. Creator sends GAS and mints **one single Lucky NFT** with open-count and expiry.
2. The current holder can choose to open once for random GAS, then transfer to next holder.
3. If a holder only transfers without opening, that holder gets **no reward**.
4. Each address can open that envelope only once.
5. When all open-count is used, the NFT is burned.
6. After expiry, only the original issuer can reclaim remaining GAS.

## Core Rules

- **Only real users can open/claim**: contract accounts are rejected for open/claim actions.
- **Contract owner cannot touch envelopes**: owner cannot create/open/claim/transfer/reclaim envelopes.
- **Open is required to receive GAS**: holding or claiming NFT alone does not transfer GAS.
- **Expiry is enforced**: open/claim operations are blocked after expiry.
- **Minimum amounts**: total per envelope is at least `1 GAS`, and each packet/slot is at least `0.1 GAS`.

## Contract API

All functions below were evaluated on Neo N3 TestNet in the latest full E2E run (56/56 passing).
To reproduce that run locally, set `KEY1_WIF` and `KEY2_WIF` and execute `node scripts/test-e2e.js`.

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
| `TransferClaim` | `claimId`, `from`, `to` | —                           | Transfer an unopened Claim NFT.              |
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
| `EnvelopeBurned`   | `id`                                     | NFT fully consumed            |
| `EnvelopeRefunded` | `id, creator, amount`                    | Creator reclaims after expiry |

## How It Works

Red Envelope brings traditional gifting to the blockchain:

1. **Cultural Tradition**: Based on the Chinese tradition of hongbao (lucky money)
2. **Smart Contract Escrow**: Issuer's GAS stays in contract until users open claims
3. **Runtime Randomness**: Packet amounts are assigned with Neo runtime randomness syscall
4. **Two Modes**: Pool mode (claim NFT per slot) and Lucky NFT mode (single transferable envelope)
5. **Open-to-Earn**: Users receive GAS only when they execute open operation
6. **Expiry + Reclaim**: After expiry, only issuer can reclaim unopened/remaining GAS

## Assets

- **Allowed Assets**: GAS
- **Max per TX**: 100 GAS
- **Daily Cap**: 500 GAS

## License

MIT License - R3E Network
