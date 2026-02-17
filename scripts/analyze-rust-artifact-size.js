#!/usr/bin/env node

/**
 * Analyze Rust Neo N3 artifact sizes and (optionally) estimate deploy tx/script size
 * via ContractManagement.deploy dry-run.
 *
 * Usage:
 *   node scripts/analyze-rust-artifact-size.js
 *   RPC_URL=... DEPLOYER_WIF=... node scripts/analyze-rust-artifact-size.js
 */

const fs = require("fs");
const path = require("path");
const Neon = require("@cityofzion/neon-js");

const CONTRACT_MANAGEMENT = "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd";
const DEFAULT_RPC_URL = "https://testnet1.neo.coz.io:443";

function parseOptionalNumber(name, raw) {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a valid number, got: ${raw}`);
  }
  return n;
}

function statSize(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.statSync(filePath).size;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

async function getNetworkMagic(rpcClient) {
  const res = await rpcClient.execute(new Neon.rpc.Query({ method: "getversion", params: [] }));
  const magic = res?.protocol?.network;
  if (!Number.isFinite(Number(magic))) {
    throw new Error("failed to resolve network magic from getversion");
  }
  return Number(magic);
}

async function estimateDeployPayload({ rpcUrl, networkMagic, wif, nefBytes, manifestStr, deployData }) {
  const account = new Neon.wallet.Account(wif);
  const rpcClient = new Neon.rpc.RPCClient(rpcUrl);

  const resolvedMagic = Number.isFinite(networkMagic) ? networkMagic : await getNetworkMagic(rpcClient);

  const callArgs = [
    { type: "ByteArray", value: nefBytes.toString("base64") },
    { type: "String", value: manifestStr },
  ];
  if (deployData) {
    callArgs.push(deployData);
  }

  const signer = { account: account.scriptHash, scopes: "CalledByEntry" };
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokefunction",
      params: [CONTRACT_MANAGEMENT, "deploy", callArgs, [signer]],
    }),
  );

  if (dryRun.state !== "HALT") {
    throw new Error(`deploy dry-run fault: ${dryRun.exception || dryRun.state}`);
  }

  const scriptBytes = Buffer.from(dryRun.script, "base64");
  const scriptHex = scriptBytes.toString("hex");

  const currentHeight = await rpcClient.getBlockCount();
  const tx = new Neon.tx.Transaction({
    signers: [{ account: account.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });

  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.5));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  tx.sign(account, resolvedMagic);

  return {
    rpcUrl,
    networkMagic: resolvedMagic,
    account: {
      address: account.address,
      scriptHash: account.scriptHash,
    },
    dryRunState: dryRun.state,
    gasConsumed: String(dryRun.gasconsumed),
    deployScriptBytes: scriptBytes.length,
    signedTxBytes: tx.serialize(true).length / 2,
  };
}

async function analyzeRustArtifactSize(options = {}) {
  const root = options.rootDir || path.resolve(__dirname, "..");

  const artifactPaths = {
    wasm: options.wasmPath || path.resolve(root, "contracts-rust/red-envelope-neo/target/wasm32-unknown-unknown/release/red_envelope_neo_rust.wasm"),
    nef: options.nefPath || path.resolve(root, "contracts-rust/red-envelope-neo/build/RedEnvelopeRust.nef"),
    manifest:
      options.manifestPath || path.resolve(root, "contracts-rust/red-envelope-neo/build/RedEnvelopeRust.manifest.json"),
  };

  const sizes = {
    wasmBytes: statSize(artifactPaths.wasm),
    nefBytes: statSize(artifactPaths.nef),
    manifestBytes: statSize(artifactPaths.manifest),
  };

  const missing = Object.entries(artifactPaths)
    .filter(([, p]) => !fs.existsSync(p))
    .map(([k]) => k);
  if (missing.length > 0) {
    const err = new Error(`missing required artifact(s): ${missing.join(", ")}`);
    err.code = "MISSING_ARTIFACT";
    err.artifactPaths = artifactPaths;
    throw err;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    artifactPaths,
    artifacts: sizes,
    ratios: {
      nefToWasm: ratio(sizes.nefBytes, sizes.wasmBytes),
      manifestToWasm: ratio(sizes.manifestBytes, sizes.wasmBytes),
    },
    deployEstimate: {
      attempted: false,
    },
  };

  if (options.includeDeployEstimate) {
    report.deployEstimate.attempted = true;
    if (!options.wif) {
      report.deployEstimate = {
        attempted: true,
        ok: false,
        error: "deploy estimate requires WIF (set --wif or DEPLOYER_WIF/KEY1_WIF/SIZE_GATE_WIF)",
      };
      return report;
    }
    try {
      const nefBytes = fs.readFileSync(artifactPaths.nef);
      const manifestObj = JSON.parse(fs.readFileSync(artifactPaths.manifest, "utf8"));
      const manifestStr = JSON.stringify(manifestObj);
      const estimate = async (manifestPayload, manifestNameOverride = null) => ({
        attempted: true,
        ok: true,
        ...(await estimateDeployPayload({
          rpcUrl: options.rpcUrl || DEFAULT_RPC_URL,
          networkMagic: options.networkMagic,
          wif: options.wif,
          nefBytes,
          manifestStr: manifestPayload,
          deployData: options.deployData || null,
        })),
        ...(manifestNameOverride ? { manifestNameOverride } : {}),
      });

      try {
        report.deployEstimate = await estimate(manifestStr);
      } catch (err) {
        const message = String(err?.message || err);
        if (!/contract already exists/i.test(message)) {
          throw err;
        }

        const retryManifest = {
          ...manifestObj,
          name: `${manifestObj.name || "RedEnvelopeRust"}_sizecheck_${Date.now()}`,
        };
        report.deployEstimate = await estimate(JSON.stringify(retryManifest), retryManifest.name);
      }
    } catch (err) {
      report.deployEstimate = {
        attempted: true,
        ok: false,
        error: err?.message || String(err),
      };
    }
  }

  return report;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--no-deploy") {
      opts.includeDeployEstimate = false;
    } else if (a === "--with-deploy") {
      opts.includeDeployEstimate = true;
    } else if (a === "--rpc" && args[i + 1]) {
      opts.rpcUrl = args[i + 1];
      i += 1;
    } else if (a === "--wif" && args[i + 1]) {
      opts.wif = args[i + 1];
      i += 1;
    } else if (a === "--network-magic" && args[i + 1]) {
      opts.networkMagic = Number(args[i + 1]);
      i += 1;
    } else if (a === "--wasm" && args[i + 1]) {
      opts.wasmPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (a === "--nef" && args[i + 1]) {
      opts.nefPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (a === "--manifest" && args[i + 1]) {
      opts.manifestPath = path.resolve(args[i + 1]);
      i += 1;
    }
  }

  return opts;
}

async function main() {
  const cli = parseArgs(process.argv);

  const envRpc = process.env.RPC_URL || DEFAULT_RPC_URL;
  const envWif = process.env.SIZE_GATE_WIF || process.env.DEPLOYER_WIF || process.env.KEY1_WIF || null;
  const envNetworkMagic = parseOptionalNumber("NETWORK_MAGIC", process.env.NETWORK_MAGIC);

  const includeDeployEstimate =
    typeof cli.includeDeployEstimate === "boolean" ? cli.includeDeployEstimate : Boolean(cli.wif || envWif);

  const report = await analyzeRustArtifactSize({
    rpcUrl: cli.rpcUrl || envRpc,
    wif: cli.wif || envWif,
    networkMagic: Number.isFinite(cli.networkMagic) ? cli.networkMagic : envNetworkMagic,
    includeDeployEstimate,
    wasmPath: cli.wasmPath,
    nefPath: cli.nefPath,
    manifestPath: cli.manifestPath,
  });

  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("ERROR:", err?.message || err);
    process.exit(1);
  });
}

module.exports = {
  analyzeRustArtifactSize,
};
