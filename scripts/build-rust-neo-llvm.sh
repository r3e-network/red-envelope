#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN_DIR="${ROOT_DIR}/.toolchains/neo-llvm"
CONTRACT_DIR="${ROOT_DIR}/contracts-rust/red-envelope-neo"
BUILD_DIR="${CONTRACT_DIR}/build"
WASM_PATH="${CONTRACT_DIR}/target/wasm32-unknown-unknown/release/red_envelope_neo_rust.wasm"
OPT_WASM_PATH="${BUILD_DIR}/RedEnvelopeRust.opt.wasm"
CSP_MANIFEST="${ROOT_DIR}/contracts/bin/sc/RedEnvelope.manifest.json"

DEFAULT_RUSTFLAGS="-C opt-level=z -C strip=symbols -C panic=abort -C target-feature=-simd128,-reference-types,-multivalue,-tail-call"
RUSTFLAGS_TO_USE="${NEO_WASM_RUSTFLAGS:-${DEFAULT_RUSTFLAGS}}"
WASM_OPT_MODE="${NEO_WASM_OPT:-1}"
WASM_OPT_LEVEL="${NEO_WASM_OPT_LEVEL:-Oz}"

if [[ ! -d "${TOOLCHAIN_DIR}" ]]; then
  mkdir -p "${ROOT_DIR}/.toolchains"
  if ! git clone --depth 1 git@github.com:r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"; then
    git clone --depth 1 https://github.com/r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"
  fi
fi

"${ROOT_DIR}/scripts/patch-neo-llvm-toolchain.sh"

rustup target add wasm32-unknown-unknown >/dev/null 2>&1 || true

echo "Building Rust contract with RUSTFLAGS: ${RUSTFLAGS_TO_USE}"
RUSTFLAGS="${RUSTFLAGS_TO_USE}" cargo build \
  --manifest-path "${CONTRACT_DIR}/Cargo.toml" \
  --release \
  --target wasm32-unknown-unknown

mkdir -p "${BUILD_DIR}"
TRANSLATE_INPUT="${WASM_PATH}"

case "${WASM_OPT_MODE}" in
  0|false|FALSE|no|NO)
    echo "Skipping wasm-opt post-processing (NEO_WASM_OPT=${WASM_OPT_MODE})"
    ;;
  *)
    if command -v wasm-opt >/dev/null 2>&1; then
      echo "Applying wasm-opt -${WASM_OPT_LEVEL}"
      wasm-opt "-${WASM_OPT_LEVEL}" "${WASM_PATH}" -o "${OPT_WASM_PATH}"
      TRANSLATE_INPUT="${OPT_WASM_PATH}"
    else
      echo "wasm-opt not found; using raw wasm artifact"
    fi
    ;;
esac

cargo run --manifest-path "${TOOLCHAIN_DIR}/wasm-neovm/Cargo.toml" -- \
  --input "${TRANSLATE_INPUT}" \
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
