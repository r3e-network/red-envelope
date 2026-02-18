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
# `auto` enables wasm-opt only when the local neo-llvm toolchain contains
# the control-flow/local-initialization fixes required for parity-safe `-Oz`.
WASM_OPT_MODE="${NEO_WASM_OPT:-auto}"
WASM_OPT_LEVEL="${NEO_WASM_OPT_LEVEL:-Oz}"

if [[ ! -d "${TOOLCHAIN_DIR}" ]]; then
  mkdir -p "${ROOT_DIR}/.toolchains"
  if ! git clone --depth 1 git@github.com:r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"; then
    git clone --depth 1 https://github.com/r3e-network/neo-llvm.git "${TOOLCHAIN_DIR}"
  fi
fi

"${ROOT_DIR}/scripts/patch-neo-llvm-toolchain.sh"

if [[ "${WASM_OPT_MODE}" == "auto" ]]; then
  OP_CONTROL_FILE="${TOOLCHAIN_DIR}/wasm-neovm/src/translator/translation/function/op_control.rs"
  FUNCTION_FILE="${TOOLCHAIN_DIR}/wasm-neovm/src/translator/translation/function.rs"
  if [[ -f "${OP_CONTROL_FILE}" ]] \
    && [[ -f "${FUNCTION_FILE}" ]] \
    && rg -q "False-condition path must land at the beginning of the ELSE body" "${OP_CONTROL_FILE}" \
    && rg -q "WebAssembly locals are zero-initialized" "${FUNCTION_FILE}"; then
    WASM_OPT_MODE=1
  else
    WASM_OPT_MODE=0
    echo "wasm-opt auto-disabled: neo-llvm toolchain is missing required parity fixes"
  fi
fi

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
