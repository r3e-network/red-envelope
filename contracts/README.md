# RedEnvelope Contract (Standalone Neo N3)

This directory contains the standalone Neo N3 smart contract implementation for Red Envelope.

## Build

```bash
cd contracts
dotnet build
```

Build output artifacts are generated to:

- `contracts/bin/sc/RedEnvelope.nef`
- `contracts/bin/sc/RedEnvelope.manifest.json`

## Notes

- The project uses local .NET tool restore (`neo.compiler.csharp`) during build.
- Contract symbol is `RedEnvelope` (NEP-11 non-divisible token).
- Legacy duplicate lower-case method aliases that caused compiler method-key collisions were removed to keep the contract buildable on the current Neo compiler.
