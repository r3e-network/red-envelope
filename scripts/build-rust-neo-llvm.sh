#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN_DIR="${ROOT_DIR}/.toolchains/neo-llvm"
CONTRACT_DIR="${ROOT_DIR}/contracts-rust/red-envelope-neo"
BUILD_DIR="${CONTRACT_DIR}/build"
WASM_PATH="${CONTRACT_DIR}/target/wasm32-unknown-unknown/release/red_envelope_neo_rust.wasm"
CSP_MANIFEST="${ROOT_DIR}/contracts/bin/sc/RedEnvelope.manifest.json"

if [[ ! -d "${TOOLCHAIN_DIR}" ]]; then
  mkdir -p "${ROOT_DIR}/.toolchains"
  if ! git clone --depth 1 git@github.com:r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"; then
    git clone --depth 1 https://github.com/r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"
  fi
fi

"${ROOT_DIR}/scripts/patch-neo-llvm-toolchain.sh"

rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true

cargo build \
  --manifest-path "${CONTRACT_DIR}/Cargo.toml" \
  --release \
  --target wasm32-unknown-unknown

mkdir -p "${BUILD_DIR}"

cargo run --manifest-path "${TOOLCHAIN_DIR}/wasm-neovm/Cargo.toml" -- \
  --input "${WASM_PATH}" \
  --nef "${BUILD_DIR}/RedEnvelopeRust.nef" \
  --manifest "${BUILD_DIR}/RedEnvelopeRust.manifest.json" \
  --name "RedEnvelopeRust" \
  --manifest-overlay "${CONTRACT_DIR}/manifest.overlay.json"

if [[ -f "${CSP_MANIFEST}" ]]; then
  node "${ROOT_DIR}/scripts/sync-manifest-abi-from-csharp.js" \
    --source "${CSP_MANIFEST}" \
    --target "${BUILD_DIR}/RedEnvelopeRust.manifest.json"
else
  echo "C# manifest not found (${CSP_MANIFEST}); skipping ABI shape sync"
fi

echo "Built Rust Neo N3 artifacts:"
echo "  ${BUILD_DIR}/RedEnvelopeRust.nef"
echo "  ${BUILD_DIR}/RedEnvelopeRust.manifest.json"
