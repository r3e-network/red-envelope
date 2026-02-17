#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOOLCHAIN_DIR="${ROOT_DIR}/.toolchains/neo-llvm"
TARGET_FILE="${ROOT_DIR}/.toolchains/neo-llvm/wasm-neovm/src/translator/translation/function.rs"
PATCH_FILE="${ROOT_DIR}/scripts/patches/neo-llvm-onnep17-data-compat.patch"
PATCH_MARKER="neo-red-envelope-onnep17-object-array-compat"

if [[ ! -f "${TARGET_FILE}" ]]; then
  echo "neo-llvm toolchain patch skipped: ${TARGET_FILE} not found"
  exit 0
fi

if [[ ! -f "${PATCH_FILE}" ]]; then
  echo "neo-llvm toolchain patch failed: patch file missing at ${PATCH_FILE}"
  exit 1
fi

if rg -q "${PATCH_MARKER}" "${TARGET_FILE}"; then
  echo "neo-llvm toolchain patch already applied"
  exit 0
fi

if ! git -C "${TOOLCHAIN_DIR}" apply --whitespace=nowarn "${PATCH_FILE}"; then
  if rg -q "${PATCH_MARKER}" "${TARGET_FILE}"; then
    echo "neo-llvm toolchain patch already applied"
    exit 0
  fi
  echo "neo-llvm toolchain patch failed: unable to apply ${PATCH_FILE}"
  exit 1
fi

if ! rg -q "${PATCH_MARKER}" "${TARGET_FILE}"; then
  echo "neo-llvm toolchain patch failed: marker not found after applying patch"
  exit 1
fi

echo "neo-llvm toolchain patch applied"
