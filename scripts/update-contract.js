/**
 * Update the RedEnvelope contract on Neo N3 TestNet.
 * Reads compiled NEF + manifest and calls contract.Update(nef, manifest).
 */
const fs = require("fs");
const path = require("path");
const { Neon, CONTRACT, NETWORK_MAGIC, RPC_URL, key1, rpcClient, waitForTx } = require("./helpers");

const NEF_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.nef");
const MANIFEST_PATH = path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.manifest.json");

async function main() {
  console.log("=== RedEnvelope Contract Update ===");
  console.log("Contract:", CONTRACT);
  console.log("Owner:   ", key1.address);
  console.log("RPC:     ", RPC_URL);
  console.log();

  // Read artifacts
  const nefBytes = fs.readFileSync(NEF_PATH);
  const manifestStr = fs.readFileSync(MANIFEST_PATH, "utf-8");
  const manifestCompact = JSON.stringify(JSON.parse(manifestStr));

  console.log("NEF size:      ", nefBytes.length, "bytes");
  console.log("Manifest size: ", manifestCompact.length, "chars");
  console.log();

  // Build invocation script
  const nefBase64 = nefBytes.toString("base64");
  const sb = new Neon.sc.ScriptBuilder();
  sb.emitContractCall({
    scriptHash: CONTRACT,
    operation: "update",
    args: [Neon.sc.ContractParam.byteArray(nefBase64), Neon.sc.ContractParam.string(manifestCompact)],
  });
  const script = sb.build();

  // ── Phase 1: Estimate system fee via invokeScript ──
  console.log("⏳ Estimating system fee...");
  const scriptBase64 = Buffer.from(script, "hex").toString("base64");
  const invokeResult = await rpcClient.invokeScript(scriptBase64, [
    { account: "0x" + key1.scriptHash, scopes: "CalledByEntry" },
  ]);

  if (invokeResult.state === "FAULT") {
    console.error("❌ Invoke simulation FAULT:", invokeResult.exception);
    process.exit(1);
  }

  const systemFee = invokeResult.gasconsumed;
  console.log("System fee:", systemFee);

  // ── Phase 2: Build dummy-signed TX to calculate network fee ──
  const currentHeight = await rpcClient.getBlockCount();

  const dummyTx = new Neon.tx.Transaction({
    signers: [{ account: key1.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    script,
    validUntilBlock: currentHeight + 100,
    systemFee: Neon.u.BigInteger.fromNumber(systemFee),
    networkFee: 0,
  });
  dummyTx.sign(key1, NETWORK_MAGIC);

  // Serialize signed TX → base64 for calculatenetworkfee RPC
  const dummyHex = dummyTx.serialize(true);
  const dummyB64 = Buffer.from(dummyHex, "hex").toString("base64");

  console.log("⏳ Calculating network fee...");
  const feeResp = await rpcClient.execute(new Neon.rpc.Query({ method: "calculatenetworkfee", params: [dummyB64] }));
  const networkFee = feeResp.networkfee;
  console.log("Network fee:", networkFee);

  // ── Phase 3: Build final TX with correct fees, re-sign ──
  const finalTx = new Neon.tx.Transaction({
    signers: [{ account: key1.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    script,
    validUntilBlock: currentHeight + 100,
    systemFee: Neon.u.BigInteger.fromNumber(systemFee),
    networkFee: Neon.u.BigInteger.fromNumber(networkFee),
  });
  finalTx.sign(key1, NETWORK_MAGIC);

  // ── Phase 4: Send ──
  console.log();
  console.log("📤 Sending update transaction...");
  const finalHex = finalTx.serialize(true);
  const finalB64 = Buffer.from(finalHex, "hex").toString("base64");

  const txid = await rpcClient.execute(new Neon.rpc.Query({ method: "sendrawtransaction", params: [finalB64] }));
  const hash = txid.hash || txid;
  console.log("TX sent:", hash);

  // ── Phase 5: Wait for confirmation ──
  const appLog = await waitForTx(hash);
  if (appLog) {
    const exec = appLog.executions?.[0];
    if (exec?.vmstate === "HALT") {
      console.log("✅ Contract updated successfully!");
    } else {
      console.error("❌ VM FAULT:", exec?.exception || "unknown");
      process.exit(1);
    }
  } else {
    console.warn("⚠️  TX confirmation timed out. Check manually.");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
