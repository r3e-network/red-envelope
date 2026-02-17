#!/usr/bin/env node

/**
 * Enforce Rust artifact size gates for Neo N3 deployability.
 *
 * Usage:
 *   node scripts/check-rust-size-gate.js
 *   DEPLOYER_WIF=... node scripts/check-rust-size-gate.js
 *
 * Optional env overrides:
 *   SIZE_GATE_MAX_WASM_BYTES
 *   SIZE_GATE_MAX_NEF_BYTES
 *   SIZE_GATE_MAX_MANIFEST_BYTES
 *   SIZE_GATE_MAX_DEPLOY_SCRIPT_BYTES
 *   SIZE_GATE_MAX_SIGNED_TX_BYTES
 *   SIZE_GATE_REQUIRE_DEPLOY_ESTIMATE=true|false
 */

const { analyzeRustArtifactSize } = require("./analyze-rust-artifact-size");

function parseLimit(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive number, got: ${raw}`);
  }
  return n;
}

function parseBool(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  throw new Error(`${name} must be true/false, got: ${raw}`);
}

function fmt(n) {
  return `${Number(n).toLocaleString("en-US")} bytes`;
}

function evaluateLimit(failures, metricName, actual, limit) {
  if (actual == null) return;
  if (actual > limit) {
    failures.push(`${metricName} exceeds limit: ${fmt(actual)} > ${fmt(limit)}`);
  }
}

async function main() {
  const thresholds = {
    wasm: parseLimit("SIZE_GATE_MAX_WASM_BYTES", 50000),
    nef: parseLimit("SIZE_GATE_MAX_NEF_BYTES", 100000),
    manifest: parseLimit("SIZE_GATE_MAX_MANIFEST_BYTES", 20000),
    deployScript: parseLimit("SIZE_GATE_MAX_DEPLOY_SCRIPT_BYTES", 100000),
    signedTx: parseLimit("SIZE_GATE_MAX_SIGNED_TX_BYTES", 102400),
  };

  const requireDeployEstimate = parseBool("SIZE_GATE_REQUIRE_DEPLOY_ESTIMATE", false);

  const report = await analyzeRustArtifactSize({
    includeDeployEstimate: Boolean(
      process.env.SIZE_GATE_WIF || process.env.DEPLOYER_WIF || process.env.KEY1_WIF || requireDeployEstimate,
    ),
    wif: process.env.SIZE_GATE_WIF || process.env.DEPLOYER_WIF || process.env.KEY1_WIF || null,
    rpcUrl: process.env.RPC_URL || "https://testnet1.neo.coz.io:443",
    networkMagic: process.env.NETWORK_MAGIC ? Number(process.env.NETWORK_MAGIC) : undefined,
  });

  const failures = [];

  evaluateLimit(failures, "wasmBytes", report.artifacts.wasmBytes, thresholds.wasm);
  evaluateLimit(failures, "nefBytes", report.artifacts.nefBytes, thresholds.nef);
  evaluateLimit(failures, "manifestBytes", report.artifacts.manifestBytes, thresholds.manifest);

  if (report.deployEstimate.attempted) {
    if (!report.deployEstimate.ok) {
      failures.push(`deploy estimate failed: ${report.deployEstimate.error || "unknown error"}`);
    } else {
      evaluateLimit(
        failures,
        "deployScriptBytes",
        report.deployEstimate.deployScriptBytes,
        thresholds.deployScript,
      );
      evaluateLimit(failures, "signedTxBytes", report.deployEstimate.signedTxBytes, thresholds.signedTx);
    }
  } else if (requireDeployEstimate) {
    failures.push("deploy estimate was required but not attempted (missing WIF)");
  }

  console.log("Rust size gate report:");
  console.log(JSON.stringify({ thresholds, report }, null, 2));

  if (failures.length > 0) {
    console.error("\nSize gate FAILED:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("\nSize gate PASSED");
}

main().catch((err) => {
  console.error("ERROR:", err?.message || err);
  process.exit(1);
});
