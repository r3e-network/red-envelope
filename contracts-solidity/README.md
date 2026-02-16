# Red Envelope Solidity Contract (neo-solidity)

This directory contains a Neo N3 Red Envelope contract implemented in Solidity and compiled with `neo-solidity` (`neo-solc`).

## Contract

- Source: `contracts-solidity/RedEnvelope.sol`
- Envelope modes: spreading / pool / claim
- C#-aligned method surface (lower-camel entrypoints)
- Core flows covered: create/open/claim/transfer/reclaim
- Owner controls: `getOwner`, `setOwner`, `pause`, `resume`, `update`, `destroy`
- Query helpers: envelope/claim state, eligibility, stats, calculation constants

## Notes

- Neo-solidity currently emits Solidity struct/tuple returns as `Array` in manifest.  
  C# `Map`/`InteropInterface` return shapes are represented with array payloads here.
- `onNEP17Payment` supports two config encodings:
  - ABI-encoded payload for full C#-style fields (`packetCount`, `expiryMs`, `message`, `minNeoRequired`, `minHoldSeconds`, `envelopeType`)
  - packed-integer fallback (`packetCount * 1_000_000_000 + expiryMs * 10 + envelopeType`) for compatibility.

## Build

From repo root:

```bash
./scripts/build-solidity-neo-solc.sh
```

Artifacts:

- `contracts-solidity/build/RedEnvelope.nef`
- `contracts-solidity/build/RedEnvelope.manifest.json`
