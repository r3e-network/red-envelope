#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Neon = require("@cityofzion/neon-js");

const RPC_URL = process.env.RPC_URL || "https://testnet1.neo.coz.io:443";
const NETWORK_MAGIC = Number(process.env.NETWORK_MAGIC || 894710606);
const CONTRACT_MANAGEMENT = "0xfffdc93764dbaddd97c48f252a53ea4643faa3fd";
const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";

const DEPLOYER_WIF = process.env.DEPLOYER_WIF || process.env.KEY1_WIF;
if (!DEPLOYER_WIF) {
  console.error("ERROR: DEPLOYER_WIF (or KEY1_WIF) is required");
  process.exit(1);
}

const deployer = new Neon.wallet.Account(DEPLOYER_WIF);
const rpcClient = new Neon.rpc.RPCClient(RPC_URL);

const rustArtifact = {
  label: "Rust",
  nef: path.resolve(__dirname, "../contracts-rust/red-envelope-neo/build/RedEnvelopeRust.nef"),
  manifest: path.resolve(__dirname, "../contracts-rust/red-envelope-neo/build/RedEnvelopeRust.manifest.json"),
};

function i(value) {
  return { type: "Integer", value: String(value) };
}

function h(scriptHash) {
  return { type: "Hash160", value: scriptHash };
}

function configArray(packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType) {
  return {
    type: "Array",
    value: [
      i(packetCount),
      i(expiryMs),
      { type: "String", value: String(message || "") },
      i(minNeoRequired),
      i(minHoldSeconds),
      i(envelopeType),
    ],
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseStack(item) {
  if (!item) return null;

  switch (item.type) {
    case "Integer":
      return BigInt(item.value || "0");
    case "Boolean":
      return Boolean(item.value);
    case "ByteString":
    case "Buffer":
      return item.value ? Buffer.from(item.value, "base64").toString("hex") : "";
    case "String":
      return item.value || "";
    case "Array":
      return (item.value || []).map(parseStack);
    case "Struct":
      return (item.value || []).map(parseStack);
    case "Any":
      return null;
    default:
      return item.value ?? null;
  }
}

function asNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  return Number(value || 0);
}

function errorMessage(err) {
  if (!err) return "unknown error";
  if (err?.response?.data?.message) return String(err.response.data.message);
  if (err?.response?.data?.error?.message) return String(err.response.data.error.message);
  if (err?.message) return String(err.message);
  return String(err);
}

function parseDeployHashFromNotifications(notifications) {
  for (const n of notifications || []) {
    if (n.eventname !== "Deploy") continue;
    const hashB64 = n.state?.value?.[0]?.value;
    if (!hashB64) continue;
    const rawHex = Buffer.from(hashB64, "base64").toString("hex");
    return "0x" + Neon.u.reverseHex(rawHex);
  }
  return null;
}

async function waitForTx(txid, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await rpcClient.execute(new Neon.rpc.Query({ method: "getapplicationlog", params: [txid] }));
      if (res) return res;
    } catch (err) {
      const message = String(err?.message || "");
      if (err?.response?.status !== 404 && !message.includes("Unknown script container")) {
        console.debug(`[waitForTx] ${message || err}`);
      }
    }
    await sleep(2000);
  }
  return null;
}

async function ensureGasBalance(minGas = 20) {
  const res = await rpcClient.invokeFunction(GAS_HASH, "balanceOf", [{ type: "Hash160", value: deployer.scriptHash }]);
  const gas = Number(res.stack?.[0]?.value || 0) / 1e8;
  if (gas < minGas) {
    throw new Error(`insufficient GAS balance: ${gas.toFixed(4)} GAS`);
  }
  return gas;
}

async function invokeRead(contractHash, operation, args = []) {
  const res = await rpcClient.execute(
    new Neon.rpc.Query({ method: "invokefunction", params: [contractHash, operation, args] }),
  );
  if (res.state !== "HALT") {
    throw new Error(`read ${operation} fault: ${res.exception || res.state}`);
  }
  return res;
}

async function invokeWrite(contractHash, operation, args = [], signerAccount = deployer) {
  const signer = { account: signerAccount.scriptHash, scopes: "CalledByEntry" };
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({ method: "invokefunction", params: [contractHash, operation, args, [signer]] }),
  );

  if (dryRun.state !== "HALT") {
    throw new Error(`write ${operation} dry-run fault: ${dryRun.exception || dryRun.state}`);
  }

  const scriptHex = Buffer.from(dryRun.script, "base64").toString("hex");
  const currentHeight = await rpcClient.getBlockCount();
  const tx = new Neon.tx.Transaction({
    signers: [{ account: signerAccount.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.3));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  tx.sign(signerAccount, NETWORK_MAGIC);

  let sendRes;
  try {
    sendRes = await rpcClient.sendRawTransaction(tx);
  } catch (err) {
    throw new Error(`send ${operation} failed: ${errorMessage(err)}`);
  }
  const txid = sendRes.hash || sendRes;
  const appLog = await waitForTx(txid);
  if (!appLog) {
    throw new Error(`write ${operation} confirmation timeout: ${txid}`);
  }
  if (appLog.executions?.[0]?.vmstate !== "HALT") {
    throw new Error(
      `write ${operation} vmstate=${appLog.executions?.[0]?.vmstate} exception=${appLog.executions?.[0]?.exception || "none"}`,
    );
  }

  return {
    txid,
    dryRun,
    appLog,
    returnValue: parseStack(dryRun.stack?.[0]),
  };
}

async function invokeGasTransfer(toContractHash, amount, dataParam) {
  return invokeWrite(GAS_HASH, "transfer", [h(deployer.scriptHash), h(toContractHash), i(amount), dataParam]);
}

async function buildDeployTx(nefBytes, manifestStr) {
  const signer = { account: deployer.scriptHash, scopes: "CalledByEntry" };
  const params = [
    CONTRACT_MANAGEMENT,
    "deploy",
    [
      { type: "ByteArray", value: nefBytes.toString("base64") },
      { type: "String", value: manifestStr },
    ],
    [signer],
  ];

  const dryRun = await rpcClient.execute(new Neon.rpc.Query({ method: "invokefunction", params }));
  if (dryRun.state !== "HALT") {
    throw new Error(`deploy dry-run fault: ${dryRun.exception || dryRun.state}`);
  }

  const scriptHex = Buffer.from(dryRun.script, "base64").toString("hex");
  const currentHeight = await rpcClient.getBlockCount();
  const tx = new Neon.tx.Transaction({
    signers: [{ account: deployer.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.5));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  tx.sign(deployer, NETWORK_MAGIC);

  return {
    dryRun,
    tx,
    predictedHash: parseDeployHashFromNotifications(dryRun.notifications || []),
  };
}

async function deployRustContract() {
  if (!fs.existsSync(rustArtifact.nef)) {
    throw new Error(`Rust NEF not found: ${rustArtifact.nef}`);
  }
  if (!fs.existsSync(rustArtifact.manifest)) {
    throw new Error(`Rust manifest not found: ${rustArtifact.manifest}`);
  }

  const nefBytes = fs.readFileSync(rustArtifact.nef);
  const manifestObj = JSON.parse(fs.readFileSync(rustArtifact.manifest, "utf8"));
  manifestObj.name = `${manifestObj.name}_${Date.now()}`;

  const { tx, predictedHash } = await buildDeployTx(nefBytes, JSON.stringify(manifestObj));
  const sendRes = await rpcClient.sendRawTransaction(tx);
  const txid = sendRes.hash || sendRes;
  const appLog = await waitForTx(txid);
  if (!appLog) {
    throw new Error(`deploy confirmation timeout: ${txid}`);
  }
  if (appLog.executions?.[0]?.vmstate !== "HALT") {
    throw new Error(`deploy failed: ${appLog.executions?.[0]?.exception || appLog.executions?.[0]?.vmstate}`);
  }

  const confirmedHash = parseDeployHashFromNotifications(appLog.executions?.[0]?.notifications || []);
  const contractHash = confirmedHash || predictedHash;
  if (!contractHash) {
    throw new Error("deploy succeeded but contract hash was not found");
  }

  return { txid, contractHash, manifestName: manifestObj.name };
}

async function readTotals(contractHash) {
  const env = asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0]));
  const sup = asNumber(parseStack((await invokeRead(contractHash, "totalSupply", [])).stack?.[0]));
  return { env, sup };
}

function assertDelta(name, actual, expected) {
  if (actual.env !== expected.env || actual.sup !== expected.sup) {
    throw new Error(
      `${name} delta mismatch: expected env+${expected.env}/sup+${expected.sup}, got env+${actual.env}/sup+${actual.sup}`,
    );
  }
}

async function runCase(contractHash, testCase) {
  const before = await readTotals(contractHash);
  const tx = await invokeGasTransfer(contractHash, testCase.amount, testCase.data);
  const after = await readTotals(contractHash);
  const delta = { env: after.env - before.env, sup: after.sup - before.sup };
  assertDelta(testCase.name, delta, testCase.expectDelta);

  const result = {
    name: testCase.name,
    txid: tx.txid,
    before,
    after,
    delta,
  };

  return result;
}

async function main() {
  console.log("======================================");
  console.log("Rust onNEP17 parity matrix (testnet)");
  console.log("======================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Deployer: ${deployer.address} (${deployer.scriptHash})`);

  const gas = await ensureGasBalance(20);
  console.log(`Deployer GAS: ${gas.toFixed(4)} GAS`);

  const deployed = await deployRustContract();
  console.log(`Rust deploy tx: ${deployed.txid}`);
  console.log(`Rust contract : ${deployed.contractHash}`);

  const expiryMs = 120_000;
  const tests = [
    {
      name: "spread-object-array",
      amount: 300_000_000,
      data: configArray(2, expiryMs, "spread", 0, 0, 0),
      expectDelta: { env: 1, sup: 1 },
    },
    {
      name: "pool-object-array",
      amount: 300_000_000,
      data: configArray(2, expiryMs, "pool", 0, 0, 1),
      expectDelta: { env: 1, sup: 0 },
    },
    {
      name: "bad-packet-zero",
      amount: 300_000_000,
      data: configArray(0, expiryMs, "bad", 0, 0, 0),
      expectDelta: { env: 0, sup: 0 },
    },
    {
      name: "null-data-default",
      amount: 300_000_000,
      data: { type: "Any" },
      expectDelta: { env: 1, sup: 1 },
    },
    {
      name: "legacy-direct-21",
      amount: 300_000_000,
      data: i(21),
      expectDelta: { env: 1, sup: 0 },
    },
  ];

  const results = [];
  for (const testCase of tests) {
    const result = await runCase(deployed.contractHash, testCase);
    results.push(result);
    console.log(
      `[PASS] ${testCase.name}: env +${result.delta.env}, sup +${result.delta.sup}, tx=${result.txid}`,
    );
  }

  const summary = {
    network: "testnet",
    rpc: RPC_URL,
    deployer: {
      address: deployer.address,
      scriptHash: deployer.scriptHash,
    },
    contract: deployed,
    results,
  };

  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err);
  process.exit(1);
});
