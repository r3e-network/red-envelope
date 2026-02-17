#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN_DIR="${ROOT_DIR}/.toolchains/neo-solidity"
SOLC_BIN="${TOOLCHAIN_DIR}/target/release/neo-solc"
CONTRACT_FILE="${ROOT_DIR}/contracts-solidity/RedEnvelope.sol"
OUTPUT_BASE="${ROOT_DIR}/contracts-solidity/build/RedEnvelope"

if [[ ! -d "${TOOLCHAIN_DIR}" ]]; then
  mkdir -p "${ROOT_DIR}/.toolchains"
  git clone --depth 1 https://github.com/r3e-network/neo-solidity "${TOOLCHAIN_DIR}"
fi

cargo build --manifest-path "${TOOLCHAIN_DIR}/Cargo.toml" --release
mkdir -p "${ROOT_DIR}/contracts-solidity/build"

"${SOLC_BIN}" "${CONTRACT_FILE}" -O2 -o "${OUTPUT_BASE}"

echo "Built Solidity Neo N3 artifacts:"
echo "  ${OUTPUT_BASE}.nef"
echo "  ${OUTPUT_BASE}.manifest.json"
