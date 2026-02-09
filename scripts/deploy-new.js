/**
 * Deploy New Contract — deploys a fresh RedEnvelope contract instance.
 *
 * Used when the existing contract's admin is bricked (owner storage lost
 * after upgrade with missing migration logic).
 *
 * Reads compiled .nef + .manifest.json from contracts/bin/sc/
 * and calls ContractManagement.deploy(nef, manifest) using Key1 (admin).
 *
 * Usage: node scripts/deploy-new.js
 */
const fs = require("fs");
const path = require("path");
const { Neon, NETWORK_MAGIC, key1, key2, rpcClient, waitForTx, sleep } = require("./helpers");

const NEF_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.nef");
const MANIFEST_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.manifest.json");

// ContractManagement native contract hash (same on all Neo N3 networks)
const CONTRACT_MANAGEMENT = "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd";

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Red Envelope — Deploy New Contract");
  console.log("═══════════════════════════════════════════");
  console.log(`  Deployer: ${key1.address} (${key1.scriptHash})`);
  console.log(`  Network:  TestNet (magic ${NETWORK_MAGIC})`);
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

  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    console.error("  ❌ Manifest is not valid JSON");
    process.exit(1);
  }

  console.log(`  ✅ NEF loaded (${nefBytes.length} bytes)`);

  // Use the contract name from manifest as-is for fresh deploy
  const manifestStr = JSON.stringify(manifest);
  console.log(`  ✅ Manifest loaded (name="${manifest.name}", ${manifestStr.length} chars)`);

  // ── 2. Check deployer balance ──
  console.log("\n[2/5] Checking deployer balance...");
  const sc = Neon.sc;

  const gasRes = await rpcClient.invokeFunction("0xd2a4cff31913016155e38e474a2c06d08be276cf", "balanceOf", [
    { type: "Hash160", value: Neon.wallet.getScriptHashFromAddress(key1.address) },
  ]);
  const gasBalance = Number(gasRes.stack[0].value) / 1e8;
  console.log(`  Key1 GAS: ${gasBalance.toFixed(4)}`);

  if (gasBalance < 15) {
    console.log("  ⚠️  Key1 GAS low — topping up 20 GAS from Key2...");
    const topUpScript = sc.createScript({
      scriptHash: "0xd2a4cff31913016155e38e474a2c06d08be276cf",
      operation: "transfer",
      args: [
        sc.ContractParam.hash160(key2.scriptHash),
        sc.ContractParam.hash160(key1.scriptHash),
        sc.ContractParam.integer(2000000000), // 20 GAS
        sc.ContractParam.any(null),
      ],
    });

    // Build and send top-up TX from Key2
    const scriptB64 = Buffer.from(topUpScript, "hex").toString("base64");
    const dryRun = await rpcClient.execute(
      new Neon.rpc.Query({
        method: "invokescript",
        params: [scriptB64, [{ account: key2.scriptHash, scopes: "CalledByEntry" }]],
      }),
    );
    if (dryRun.state !== "HALT") {
      console.error(`  ❌ Top-up dry-run FAULT: ${dryRun.exception}`);
      process.exit(1);
    }

    const currentHeight = await rpcClient.getBlockCount();
    const topUpTx = new Neon.tx.Transaction({
      signers: [{ account: key2.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
      validUntilBlock: currentHeight + 100,
      script: topUpScript,
    });
    topUpTx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.1));
    topUpTx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
    topUpTx.sign(key2, NETWORK_MAGIC);

    const topUpResult = await rpcClient.sendRawTransaction(topUpTx);
    const topUpHash = topUpResult.hash || topUpResult;
    console.log(`  ⏳ Top-up TX: ${topUpHash}`);
    await waitForTx(topUpHash);
    console.log("  ✅ Top-up confirmed");
  }

  // ── 3. Dry-run via invokefunction ──
  console.log("\n[3/5] Dry-run via invokefunction...");

  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokefunction",
      params: [
        CONTRACT_MANAGEMENT,
        "deploy",
        [
          { type: "ByteArray", value: nefBytes.toString("base64") },
          { type: "String", value: manifestStr },
        ],
        [{ account: key1.scriptHash, scopes: "CalledByEntry" }],
      ],
    }),
  );

  // ── 4. Build TX from verified script ──
  console.log("\n[4/5] Building and sending transaction...");

  if (dryRun.state !== "HALT") {
    console.error(`  ❌ Dry-run FAULT: ${dryRun.exception || "unknown"}`);
    if (dryRun.stack) console.error(`  Stack: ${JSON.stringify(dryRun.stack)}`);
    process.exit(1);
  }

  console.log(`  ✅ Dry-run HALT — gasConsumed = ${dryRun.gasconsumed}`);

  // Extract new contract hash from notifications
  const deployNotifications = dryRun.notifications || [];
  let newContractHash = null;
  for (const n of deployNotifications) {
    if (n.eventname === "Deploy") {
      const hashVal = n.state?.value?.[0]?.value;
      if (hashVal) {
        newContractHash = "0x" + Buffer.from(hashVal, "base64").toString("hex");
        // Reverse to get standard format
        newContractHash = "0x" + Neon.u.reverseHex(Buffer.from(hashVal, "base64").toString("hex"));
      }
    }
  }

  // Use verified script from dry-run response (same pattern as deploy-update.js)
  const verifiedScript = Buffer.from(dryRun.script, "base64").toString("hex");

  const currentHeight = await rpcClient.getBlockCount();
  const tx = new Neon.tx.Transaction({
    signers: [{ account: key1.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: verifiedScript,
  });

  const rawSystemFee = Number(dryRun.gasconsumed);
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(rawSystemFee * 1.5)); // 50% buffer for deploy
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  console.log(`  System fee: ${(rawSystemFee / 1e8).toFixed(4)} GAS (+50% buffer)`);

  tx.sign(key1, NETWORK_MAGIC);
  console.log("  ✅ Transaction signed");

  const result = await rpcClient.sendRawTransaction(tx);
  const txHash = result.hash || result;
  console.log(`  ✅ Sent! TXID: ${txHash}`);

  // ── 5. Wait and verify ──
  console.log("\n[5/5] Waiting for confirmation...");
  const appLog = await waitForTx(txHash);

  if (!appLog) {
    console.error("  ⚠️  TX confirmation timed out — check manually");
    console.log(`  TXID: ${txHash}`);
    process.exit(1);
  }

  const execState = appLog.executions?.[0]?.vmstate;
  if (execState !== "HALT") {
    console.error(`  ❌ VM state: ${execState}`);
    console.error(`  Exception: ${appLog.executions?.[0]?.exception || "none"}`);
    process.exit(1);
  }

  console.log("  ✅ Contract deployed successfully!");

  // Extract contract hash from Deploy notification in app log
  const notifications = appLog.executions?.[0]?.notifications || [];
  for (const n of notifications) {
    if (n.eventname === "Deploy") {
      const hashVal = n.state?.value?.[0]?.value;
      if (hashVal) {
        const rawHex = Buffer.from(hashVal, "base64").toString("hex");
        newContractHash = "0x" + Neon.u.reverseHex(rawHex);
      }
    }
  }

  if (newContractHash) {
    console.log(`\n  ╔═══════════════════════════════════════════╗`);
    console.log(`  ║  NEW CONTRACT HASH:                       ║`);
    console.log(`  ║  ${newContractHash}  ║`);
    console.log(`  ╚═══════════════════════════════════════════╝`);
  }

  // Verify the new contract
  await sleep(2000);
  if (newContractHash) {
    console.log("\n  Verifying new contract...");

    const stateRes = await rpcClient.execute(
      new Neon.rpc.Query({ method: "getcontractstate", params: [newContractHash] }),
    );
    if (stateRes) {
      console.log(`  ✅ Contract name: ${stateRes.manifest?.name}`);
      console.log(`  ✅ Standards: ${JSON.stringify(stateRes.manifest?.supportedstandards)}`);
    }

    // Verify owner is set correctly
    const ownerRes = await rpcClient.invokeFunction(newContractHash, "getOwner", []);
    if (ownerRes.state === "HALT" && ownerRes.stack?.[0]?.value) {
      const ownerHex = Buffer.from(ownerRes.stack[0].value, "base64").toString("hex");
      const ownerReversed = Neon.u.reverseHex(ownerHex);
      const isKey1 = ownerHex === key1.scriptHash || ownerReversed === key1.scriptHash;
      console.log(`  ${isKey1 ? "✅" : "❌"} Owner = Key1: ${isKey1}`);
    } else {
      console.log("  ❌ Could not verify owner");
    }

    // Verify basic read operations
    const envRes = await rpcClient.invokeFunction(newContractHash, "getTotalEnvelopes", []);
    if (envRes.state === "HALT") {
      console.log(`  ✅ getTotalEnvelopes = ${envRes.stack?.[0]?.value ?? 0}`);
    }

    console.log("\n  ⚠️  ACTION REQUIRED:");
    console.log(`  Update CONTRACT in scripts/helpers.js to: "${newContractHash}"`);
    console.log(`  Update contract hash in src/config/networks.ts`);
    console.log(`  Update contract hash in public/neo-manifest.json`);
  } else {
    console.log("\n  ⚠️  Could not extract new contract hash from notifications");
    console.log("  Check the TX manually to find the new contract address");
    console.log(`  TXID: ${txHash}`);
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  Deploy complete");
  console.log("═══════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
