/**
 * Deploy New Contract to Neo N3 MainNet.
 *
 * Self-contained script — does not depend on helpers.js (which is testnet-oriented).
 * Reads compiled .nef + .manifest.json and calls ContractManagement.deploy().
 *
 * Usage: DEPLOYER_WIF=... node scripts/deploy-mainnet.js
 */
const fs = require("fs");
const path = require("path");
const Neon = require("@cityofzion/neon-js");

// ── MainNet constants ──
const RPC_URL = "https://mainnet1.neo.coz.io:443";
const NETWORK_MAGIC = 860833102;
const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const CONTRACT_MANAGEMENT = "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd";

const NEF_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.nef");
const MANIFEST_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.manifest.json");

// ── Load deployer key from env ──
const DEPLOYER_WIF = process.env.DEPLOYER_WIF;
if (!DEPLOYER_WIF) {
  console.error("ERROR: DEPLOYER_WIF environment variable is required.");
  console.error("Export it before running: export DEPLOYER_WIF=...");
  process.exit(1);
}

const deployer = new Neon.wallet.Account(DEPLOYER_WIF);
const rpcClient = new Neon.rpc.RPCClient(RPC_URL);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTx(txid, maxMs = 120000) {
  const deadline = Date.now() + maxMs;
  process.stdout.write(`  ⏳ Waiting for TX ${txid.slice(0, 12)}...`);
  while (Date.now() < deadline) {
    try {
      const res = await rpcClient.execute(new Neon.rpc.Query({ method: "getapplicationlog", params: [txid] }));
      if (res) {
        console.log(" ✅ confirmed");
        return res;
      }
    } catch (err) {
      if (err?.response?.status !== 404) {
        console.debug(`[waitForTx] polling error: ${err.message || err}`);
      }
    }
    await sleep(5000);
    process.stdout.write(".");
  }
  console.log(" ⚠️ timeout");
  return null;
}

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  Red Envelope — MainNet Deploy");
  console.log("═══════════════════════════════════════════");
  console.log(`  Deployer: ${deployer.address} (${deployer.scriptHash})`);
  console.log(`  Network:  MainNet (magic ${NETWORK_MAGIC})`);
  console.log(`  RPC:      ${RPC_URL}`);
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
  const manifestStr = JSON.stringify(manifest);
  console.log(`  ✅ Manifest loaded (name="${manifest.name}", ${manifestStr.length} chars)`);

  // Verify Update method exists in manifest (upgradability check)
  const hasUpdate = manifest.abi?.methods?.some((m) => m.name === "update");
  if (hasUpdate) {
    console.log("  ✅ Contract has update() method — upgradable");
  } else {
    console.error("  ❌ Contract missing update() method — NOT upgradable. Aborting.");
    process.exit(1);
  }

  // ── 2. Check deployer balance ──
  console.log("\n[2/5] Checking deployer GAS balance...");
  const gasRes = await rpcClient.invokeFunction(GAS_HASH, "balanceOf", [
    { type: "Hash160", value: Neon.wallet.getScriptHashFromAddress(deployer.address) },
  ]);
  const gasBalance = Number(gasRes.stack[0].value) / 1e8;
  console.log(`  Deployer GAS: ${gasBalance.toFixed(4)}`);

  if (gasBalance < 15) {
    console.error("  ❌ Insufficient GAS for deployment (need ~15 GAS). Aborting.");
    process.exit(1);
  }

  // ── 3. Dry-run ──
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
        [{ account: deployer.scriptHash, scopes: "CalledByEntry" }],
      ],
    }),
  );

  if (dryRun.state !== "HALT") {
    console.error(`  ❌ Dry-run FAULT: ${dryRun.exception || "unknown"}`);
    if (dryRun.stack) console.error(`  Stack: ${JSON.stringify(dryRun.stack)}`);
    process.exit(1);
  }

  console.log(`  ✅ Dry-run HALT — gasConsumed = ${dryRun.gasconsumed}`);

  // Extract predicted contract hash from dry-run notifications
  let newContractHash = null;
  const dryNotifications = dryRun.notifications || [];
  for (const n of dryNotifications) {
    if (n.eventname === "Deploy") {
      const hashVal = n.state?.value?.[0]?.value;
      if (hashVal) {
        newContractHash = "0x" + Neon.u.reverseHex(Buffer.from(hashVal, "base64").toString("hex"));
      }
    }
  }
  if (newContractHash) {
    console.log(`  Predicted contract hash: ${newContractHash}`);
  }

  // ── 4. Build, sign, send ──
  console.log("\n[4/5] Building and sending transaction...");
  const verifiedScript = Buffer.from(dryRun.script, "base64").toString("hex");
  const currentHeight = await rpcClient.getBlockCount();

  const tx = new Neon.tx.Transaction({
    signers: [{ account: deployer.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: verifiedScript,
  });

  const rawSystemFee = Number(dryRun.gasconsumed);
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(rawSystemFee * 1.5)); // 50% buffer
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000); // 0.05 GAS
  console.log(`  System fee: ${(rawSystemFee / 1e8).toFixed(4)} GAS (+50% buffer)`);
  console.log(`  Network fee: 0.0500 GAS`);

  tx.sign(deployer, NETWORK_MAGIC);
  console.log("  ✅ Transaction signed");

  const result = await rpcClient.sendRawTransaction(tx);
  const txHash = result.hash || result;
  console.log(`  ✅ Sent! TXID: ${txHash}`);

  // ── 5. Wait and verify ──
  console.log("\n[5/5] Waiting for confirmation...");
  const appLog = await waitForTx(txHash, 180000); // 3 min timeout for mainnet

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

  // Extract contract hash from confirmed app log
  const notifications = appLog.executions?.[0]?.notifications || [];
  for (const n of notifications) {
    if (n.eventname === "Deploy") {
      const hashVal = n.state?.value?.[0]?.value;
      if (hashVal) {
        newContractHash = "0x" + Neon.u.reverseHex(Buffer.from(hashVal, "base64").toString("hex"));
      }
    }
  }

  if (newContractHash) {
    console.log(`\n  ╔═══════════════════════════════════════════╗`);
    console.log(`  ║  MAINNET CONTRACT HASH:                   ║`);
    console.log(`  ║  ${newContractHash}  ║`);
    console.log(`  ╚═══════════════════════════════════════════╝`);
  }

  // Verify
  await sleep(3000);
  if (newContractHash) {
    console.log("\n  Verifying new contract...");

    const stateRes = await rpcClient.execute(
      new Neon.rpc.Query({ method: "getcontractstate", params: [newContractHash] }),
    );
    if (stateRes) {
      console.log(`  ✅ Contract name: ${stateRes.manifest?.name}`);
      console.log(`  ✅ Standards: ${JSON.stringify(stateRes.manifest?.supportedstandards)}`);
    }

    const ownerRes = await rpcClient.invokeFunction(newContractHash, "getOwner", []);
    if (ownerRes.state === "HALT" && ownerRes.stack?.[0]?.value) {
      const ownerHex = Buffer.from(ownerRes.stack[0].value, "base64").toString("hex");
      const ownerReversed = Neon.u.reverseHex(ownerHex);
      const isDeployer = ownerHex === deployer.scriptHash || ownerReversed === deployer.scriptHash;
      console.log(`  ${isDeployer ? "✅" : "❌"} Owner = Deployer: ${isDeployer}`);
    }

    // Verify update method is callable
    const updateCheck = await rpcClient.invokeFunction(newContractHash, "getTotalEnvelopes", []);
    if (updateCheck.state === "HALT") {
      console.log(`  ✅ getTotalEnvelopes = ${updateCheck.stack?.[0]?.value ?? 0}`);
    }
  }

  console.log("\n═══════════════════════════════════════════");
  console.log("  MainNet Deploy Complete");
  console.log("═══════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
