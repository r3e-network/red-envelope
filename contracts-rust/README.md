# Red Envelope Rust Contract (neo-llvm)

This directory contains a Neo N3 Red Envelope contract implemented in Rust and compiled through `neo-llvm` (`wasm-neovm`).

## Important ABI/Toolchain notes

`neo-llvm` currently has strict wrapper/runtime constraints for complex Neo ABI types. This contract therefore uses an `i64`-centric runtime surface and relies on manifest type overrides for parity where possible.

- `address`/account values are represented as numeric IDs (`i64`)
- map-like/string-rich C# responses are represented as numeric/status outputs at runtime
- one C# lifecycle entrypoint (`_deploy`) is still missing from the generated Rust manifest (toolchain export limitation)

## Logic coverage

- two envelope types (`spreading`, `pool`) plus `claim` NFTs
- open/claim/reclaim state transitions
- owner pause/resume control
- eligibility checks via status codes

## Build

From repo root:

```bash
npm run contract:build:rust
```

Artifacts:

- `contracts-rust/red-envelope-neo/build/RedEnvelopeRust.nef`
- `contracts-rust/red-envelope-neo/build/RedEnvelopeRust.manifest.json`

`contract:build:rust` now includes a post-build size gate. To build without gate:

```bash
npm run contract:build:rust:only
```

## Deployment status (updated February 17, 2026)

Rust artifact size is now within Neo N3 deploy limits on public testnet nodes:

- `RedEnvelopeRust.nef`: ~35 KB
- deploy script payload: ~43 KB
- signed deployment transaction: ~43 KB

Direct deployment succeeds on testnet.

Read-only sanity checks now HALT correctly after low-level syscall refactor:

- `getTotalEnvelopes`
- `getOwner`
- `isPaused`
- `getCalculationConstants`

## Current runtime blocker (toolchain ABI)

There are still toolchain-level ABI blockers for exact C# parity:

- Rust wrapper exports are still `i64`-centric, so account values (`Hash160`) are persisted as integer surrogates instead of full 20-byte hashes.
- `System.Storage.Get` missing-key values are `Null` stack items; this is now handled by a dedicated null-probe path before integer decode.
- NeoVM entry shims in upstream `wasm-neovm` normalize parameters through integer bit-ops. This repo now applies a local toolchain patch (via `scripts/patch-neo-llvm-toolchain.sh`) that canonicalizes `onNEP17Payment.data`:
  - `null -> 0`
  - `object[] -> adapter integer`:
    - spreading: `1_000_000_000_000 + packetCount + expiryMs * 1_000`
    - pool: `2_000_000_000_000 + packetCount + expiryMs * 1_000`
  - `Integer -> unchanged`
- This enables C#-style `object[]` transfer calls to create envelopes in Rust runtime mode.

Current behavior:

- `setOwner/getOwner` now persist/read consistently on-chain (integer representation).
- `pause/resume/isPaused` persist correctly.
- GAS `transfer(..., data = 0)`, `GAS transfer(..., data = null)`, and `GAS transfer(..., data = object[])` all create envelopes and increment `getTotalEnvelopes`.
- `object[]` fields currently honored by Rust path: `packetCount`, `expiryMs`, `envelopeType` (including packet-count/expiry/type validation paths).
- `object[]` fields `message`, `minNeoRequired`, `minHoldSeconds` are still not represented in the Rust storage/runtime model (remaining parity gap vs C#).

## Size analysis and gate

Analyze artifact and deploy payload sizes:

```bash
npm run contract:rust:size
```

Include deploy dry-run estimate (requires signer WIF):

```bash
DEPLOYER_WIF=... npm run contract:rust:size
```

Run size gate (fails on oversize artifacts / deploy payload):

```bash
npm run contract:rust:gate
DEPLOYER_WIF=... npm run contract:rust:gate
```

Run deep root-cause analysis (compiler profile vs ABI surface vs business logic vs clean upstream toolchain):

```bash
npm run contract:rust:size:deep
```

This command performs controlled experiments and emits a JSON report. Typical findings for current code:

- custom Rust release profile (`opt-level=z`, `lto`, `strip`) saves roughly `~34 KB` NEF vs default release profile
- same ABI surface with empty logic compiles to sub-`1 KB` NEF, showing business logic dominates current Rust artifact size
- clean upstream `neo-llvm` translation produces the same NEF/manifest byte sizes as local toolchain for this contract

Gate thresholds can be tuned by environment variables:

- `SIZE_GATE_MAX_WASM_BYTES`
- `SIZE_GATE_MAX_NEF_BYTES`
- `SIZE_GATE_MAX_MANIFEST_BYTES`
- `SIZE_GATE_MAX_DEPLOY_SCRIPT_BYTES`
- `SIZE_GATE_MAX_SIGNED_TX_BYTES`
- `SIZE_GATE_REQUIRE_DEPLOY_ESTIMATE`
- `SIZE_GATE_WIF` (or `DEPLOYER_WIF` / `KEY1_WIF`)
- `RPC_URL`

## Local test

```bash
cd contracts-rust/red-envelope-neo
cargo test
```
