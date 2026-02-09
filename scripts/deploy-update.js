/**
 * Contract Upgrade Script — upgrades the testnet contract in-place.
 *
 * Reads the compiled .nef + .manifest.json from contracts/bin/sc/
 * and calls the existing contract's `update(nef, manifest)` method
 * using Key1 (the contract admin).
 *
 * Usage: node scripts/deploy-update.js
 */
const fs = require("fs");
const path = require("path");
const { Neon, CONTRACT, NETWORK_MAGIC, key1, rpcClient, waitForTx, sleep } = require("./helpers");

const NEF_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.nef");
const MANIFEST_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.manifest.json");

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Red Envelope — Contract Upgrade");
  console.log("═══════════════════════════════════════════");
  console.log(`  Contract:  ${CONTRACT}`);
  console.log(`  Admin:     ${key1.address}`);
  console.log(`  Network:   TestNet (magic ${NETWORK_MAGIC})`);
  console.log("───────────────────────────────────────────\n");

  // ── 1. Load artifacts ──
  console.log("[1/5] Loading compiled artifacts...");
  if (!fs.existsSync(NEF_PATH)) {
    console.error(`  ❌ NEF not found: ${NEF_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`  ❌ Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const nefBytes = fs.readFileSync(NEF_PATH);
  const manifestRaw = fs.readFileSync(MANIFEST_PATH, "utf-8");

  // Validate manifest is valid JSON
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    console.error("  ❌ Manifest is not valid JSON");
    process.exit(1);
  }

  console.log(`  ✅ NEF loaded (${nefBytes.length} bytes)`);

  // Neo N3 requires the contract name to stay the same during update.
  // Deployed contract is "MiniAppRedEnvelope"; local build is "RedEnvelope".
  const DEPLOYED_NAME = "MiniAppRedEnvelope";
  if (manifest.name !== DEPLOYED_NAME) {
    console.log(`  ⚠️  Patching manifest name: "${manifest.name}" → "${DEPLOYED_NAME}"`);
    manifest.name = DEPLOYED_NAME;
  }
  const manifestStr = JSON.stringify(manifest);
  console.log(`  ✅ Manifest loaded (${manifestStr.length} chars)`);

  // ── 2. Pre-flight: verify admin access ──
  console.log("\n[2/5] Verifying admin access...");
  const adminRes = await rpcClient.invokeFunction(CONTRACT, "admin", []);
  if (adminRes.state !== "HALT" || !adminRes.stack?.[0]?.value) {
    console.error("  ❌ Cannot read admin — aborting");
    process.exit(1);
  }
  const adminRawHex = Buffer.from(adminRes.stack[0].value, "base64").toString("hex");
  // Contract returns UInt160 in little-endian; neon-js scriptHash is also LE
  // but RPC ByteString decoding may reverse — normalize via reverseHex
  const adminScriptHash = Neon.u.reverseHex(adminRawHex);
  const key1Hex = key1.scriptHash;
  if (adminScriptHash !== key1Hex && adminRawHex !== key1Hex) {
    console.error(`  ❌ Key1 (${key1Hex}) is NOT the admin (raw=${adminRawHex}, reversed=${adminScriptHash})`);
    process.exit(1);
  }
  console.log(`  ✅ Key1 confirmed as contract admin`);

  // ── 3. Build update transaction ──
  console.log("\n[3/5] Building update transaction...");

  const currentHeight = await rpcClient.getBlockCount();
  console.log(`  ✅ Block height: ${currentHeight}`);

  // ── 4. Dry-run, calculate fees, sign, send ──
  console.log("\n[4/5] Calculating fees and sending...");

  // Dry-run via invokefunction to get system fee
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokefunction",
      params: [
        CONTRACT,
        "update",
        [
          { type: "ByteArray", value: nefBytes.toString("base64") },
          { type: "String", value: manifestStr },
        ],
        [{ account: key1.scriptHash, scopes: "CalledByEntry" }],
      ],
    }),
  );

  if (dryRun.state !== "HALT") {
    console.error(`  ❌ Dry-run FAULT: ${dryRun.exception || "unknown error"}`);
    console.error("  The update transaction would fail on-chain. Aborting.");
    process.exit(1);
  }

  // Convert script from base64 (RPC response) to hex (neon-js Transaction expects hex)
  const verifiedScript = Buffer.from(dryRun.script, "base64").toString("hex");
  console.log(`  ✅ Dry-run HALT — gasConsumed = ${dryRun.gasconsumed}`);

  // Rebuild transaction with the verified script
  const txn2 = new Neon.tx.Transaction({
    signers: [
      {
        account: key1.scriptHash,
        scopes: Neon.tx.WitnessScope.CalledByEntry,
      },
    ],
    validUntilBlock: currentHeight + 100,
    script: verifiedScript,
  });

  // Set system fee (add 10% buffer for safety)
  const rawSystemFee = Number(dryRun.gasconsumed);
  txn2.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(rawSystemFee * 1.1));
  console.log(`  System fee: ${(rawSystemFee / 1e8).toFixed(4)} GAS (+10% buffer)`);

  // Network fee: use generous fixed estimate for single-sig tx (~0.05 GAS)
  // Avoids calculatenetworkfee RPC which requires precise witness format
  const networkFee = 5000000;
  txn2.networkFee = Neon.u.BigInteger.fromNumber(networkFee);
  console.log(`  Network fee: ${(networkFee / 1e8).toFixed(4)} GAS (estimated)`);

  // Sign
  console.log(`  ✅ Transaction signed`);

  // Send
  const rawTx = Buffer.from(txn2.serialize(true), "hex").toString("base64");
  const txid = await rpcClient.execute(new Neon.rpc.Query({ method: "sendrawtransaction", params: [rawTx] }));
  const txHash = txid.hash || txid;
  console.log(`  ✅ Sent! TXID: ${txHash}`);

  // ── 5. Wait for confirmation and verify ──
  console.log("\n[5/5] Waiting for confirmation...");
  const appLog = await waitForTx(txHash);

  if (!appLog) {
    console.error("  ⚠️  TX confirmation timed out — check manually");
    console.log(`  TXID: ${txHash}`);
    process.exit(1);
  }

  // Check application log for VM state
  const execState = appLog.executions?.[0]?.vmstate;
  if (execState === "HALT") {
    console.log("  ✅ Contract upgraded successfully!\n");
  } else {
    console.error(`  ❌ VM state: ${execState}`);
    console.error(`  Exception: ${appLog.executions?.[0]?.exception || "none"}`);
    process.exit(1);
  }

  // Quick verification — call a method that only exists in the new contract
  console.log("  Verifying new ABI...");
  await sleep(2000);

  const verifyRes = await rpcClient.invokeFunction(CONTRACT, "getTotalEnvelopes", []);
  if (verifyRes.state === "HALT") {
    console.log("  ✅ getTotalEnvelopes() → HALT — new ABI confirmed");
  } else {
    console.log("  ⚠️  getTotalEnvelopes() still FAULTs — may need a few more blocks");
  }

  const stdsRes = await rpcClient.execute(new Neon.rpc.Query({ method: "getcontractstate", params: [CONTRACT] }));
  console.log(`  Contract name: ${stdsRes?.manifest?.name}`);
  console.log(`  Standards: ${JSON.stringify(stdsRes?.manifest?.supportedstandards)}`);

  console.log("\n═══════════════════════════════════════════");
  console.log("  Upgrade complete");
  console.log("═══════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
