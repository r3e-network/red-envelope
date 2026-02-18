#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN_DIR="${ROOT_DIR}/.toolchains/neo-solidity"
SOLC_BIN="${TOOLCHAIN_DIR}/target/release/neo-solc"
CONTRACT_FILE="${ROOT_DIR}/contracts-solidity/RedEnvelope.sol"
OUTPUT_BASE="${ROOT_DIR}/contracts-solidity/build/RedEnvelope"
CSP_MANIFEST="${ROOT_DIR}/contracts/bin/sc/RedEnvelope.manifest.json"

if [[ ! -d "${TOOLCHAIN_DIR}" ]]; then
  mkdir -p "${ROOT_DIR}/.toolchains"
  git clone --depth 1 https://github.com/r3e-network/neo-solidity "${TOOLCHAIN_DIR}"
fi

cargo build --manifest-path "${TOOLCHAIN_DIR}/Cargo.toml" --release
mkdir -p "${ROOT_DIR}/contracts-solidity/build"

"${SOLC_BIN}" "${CONTRACT_FILE}" -O2 -o "${OUTPUT_BASE}"

# When neo-solc detects multiple contracts in one compilation unit, it emits:
#   <base>-<ContractName>.nef/.manifest.json
# Normalize the primary wrapper contract output back to canonical paths.
if [[ -f "${OUTPUT_BASE}-RedEnvelope.nef" && -f "${OUTPUT_BASE}-RedEnvelope.manifest.json" ]]; then
  cp "${OUTPUT_BASE}-RedEnvelope.nef" "${OUTPUT_BASE}.nef"
  cp "${OUTPUT_BASE}-RedEnvelope.manifest.json" "${OUTPUT_BASE}.manifest.json"
fi

if [[ -f "${CSP_MANIFEST}" ]]; then
  node "${ROOT_DIR}/scripts/sync-manifest-abi-from-csharp.js" \
    --source "${CSP_MANIFEST}" \
    --target "${OUTPUT_BASE}.manifest.json"
else
  echo "C# manifest not found (${CSP_MANIFEST}); skipping ABI shape sync"
fi

echo "Built Solidity Neo N3 artifacts:"
echo "  ${OUTPUT_BASE}.nef"
echo "  ${OUTPUT_BASE}.manifest.json"
