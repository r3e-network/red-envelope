# Red Envelope Frontend (Standalone)

Vue 3 + Vite frontend for the standalone Neo N3 Red Envelope contract.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```bash
cp .env.example .env
```

Environment variables:

- `VITE_CONTRACT_HASH`: target contract script hash
- `VITE_NETWORK`: `testnet` or `mainnet`

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Test

```bash
npm run test
```

## Wallet

The app expects a Neo dAPI-compatible wallet in browser (`window.OneGate` or `window.neo`).
