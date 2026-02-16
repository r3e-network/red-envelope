#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Neon = require("@cityofzion/neon-js");

const RPC_URL = "https://testnet1.neo.coz.io:443";
const NETWORK_MAGIC = 894710606;
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

const solidityArtifact = {
  label: "Solidity",
  nef: path.resolve(__dirname, "../contracts-solidity/build/RedEnvelope.nef"),
  manifest: path.resolve(__dirname, "../contracts-solidity/build/RedEnvelope.manifest.json"),
  deployData: { type: "ByteArray", value: "" },
};

function i(value) {
  return { type: "Integer", value: String(value) };
}

function h(scriptHash) {
  return { type: "Hash160", value: scriptHash };
}

function b(buffer) {
  return { type: "ByteArray", value: Buffer.from(buffer || []).toString("base64") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileSize(filePath) {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : -1;
}

function normalizeHash(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^0x/, "");
}

function sameHash(a, b) {
  const ah = normalizeHash(a);
  const bh = normalizeHash(b);
  if (!ah || !bh) return false;
  return ah === bh || ah === normalizeHash(Neon.u.reverseHex(bh));
}

function u256(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error(`negative uint256: ${value}`);
  const hex = n.toString(16);
  if (hex.length > 64) throw new Error(`uint256 overflow: ${value}`);
  return Buffer.from(hex.padStart(64, "0"), "hex");
}

function padRight32(buffer) {
  const rem = buffer.length % 32;
  if (rem === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(32 - rem)]);
}

function encodePaymentConfig(packetCount, expiryMs, message, minNeoRequired, minHoldSeconds, envelopeType) {
  const msg = Buffer.from(message || "", "utf8");
  const head = Buffer.concat([
    u256(packetCount),
    u256(expiryMs),
    u256(32n * 6n),
    u256(minNeoRequired),
    u256(minHoldSeconds),
    u256(envelopeType),
  ]);
  const tail = Buffer.concat([u256(msg.length), padRight32(msg)]);
  return Buffer.concat([head, tail]);
}

async function waitForTx(txid, timeoutMs = 150000) {
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
    case "Map": {
      const out = {};
      for (const entry of item.value || []) {
        const key = parseStack(entry.key);
        out[String(key)] = parseStack(entry.value);
      }
      return out;
    }
    case "Any":
      return null;
    default:
      return item.value ?? null;
  }
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

function asNumber(value) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  return Number(value || 0);
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function errorMessage(err) {
  if (!err) return "unknown error";
  if (err?.response?.data?.message) return String(err.response.data.message);
  if (err?.response?.data?.error?.message) return String(err.response.data.error.message);
  if (err?.response?.data?.code) return `rpc error code ${err.response.data.code}`;
  if (err?.message) return String(err.message);
  return String(err);
}

async function ensureGasBalance(minGas = 20) {
  const scriptHash = Neon.wallet.getScriptHashFromAddress(deployer.address);
  const res = await rpcClient.invokeFunction(GAS_HASH, "balanceOf", [{ type: "Hash160", value: scriptHash }]);
  const gas = Number(res.stack?.[0]?.value || 0) / 1e8;
  if (gas < minGas) {
    throw new Error(`insufficient GAS balance for deployment/testing: ${gas.toFixed(4)} GAS`);
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

  const sendRes = await rpcClient.sendRawTransaction(tx);
  const txid = sendRes.hash || sendRes;
  const appLog = await waitForTx(txid);
  if (!appLog) {
    throw new Error(`write ${operation} confirmation timeout: ${txid}`);
  }

  const vmState = appLog.executions?.[0]?.vmstate;
  if (vmState !== "HALT") {
    throw new Error(`write ${operation} vmstate=${vmState} exception=${appLog.executions?.[0]?.exception || "none"}`);
  }

  return {
    txid,
    dryRun,
    appLog,
    returnValue: parseStack(dryRun.stack?.[0]),
  };
}

async function invokeGasTransfer(fromScriptHash, toContractHash, amount, dataParam) {
  return invokeWrite(GAS_HASH, "transfer", [h(fromScriptHash), h(toContractHash), i(amount), dataParam]);
}

async function buildDeployTx(nefBytes, manifestStr, deployData) {
  const callArgs = [
    { type: "ByteArray", value: nefBytes.toString("base64") },
    { type: "String", value: manifestStr },
  ];
  if (deployData) {
    callArgs.push(deployData);
  }

  const signer = { account: deployer.scriptHash, scopes: "CalledByEntry" };
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokefunction",
      params: [CONTRACT_MANAGEMENT, "deploy", callArgs, [signer]],
    }),
  );

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
    scriptBytes: Buffer.from(dryRun.script, "base64").length,
    txBytes: tx.serialize(true).length / 2,
    predictedHash: parseDeployHashFromNotifications(dryRun.notifications || []),
  };
}

async function deployContract(artifact, { uniqueManifestName = false } = {}) {
  if (!fs.existsSync(artifact.nef)) {
    throw new Error(`${artifact.label} NEF not found: ${artifact.nef}`);
  }
  if (!fs.existsSync(artifact.manifest)) {
    throw new Error(`${artifact.label} manifest not found: ${artifact.manifest}`);
  }

  const nefBytes = fs.readFileSync(artifact.nef);
  const manifestObj = JSON.parse(fs.readFileSync(artifact.manifest, "utf8"));
  if (uniqueManifestName) {
    manifestObj.name = `${manifestObj.name}_${Date.now()}`;
  }

  const { dryRun, tx, scriptBytes, txBytes, predictedHash } = await buildDeployTx(
    nefBytes,
    JSON.stringify(manifestObj),
    artifact.deployData,
  );

  let sendRes;
  try {
    sendRes = await rpcClient.sendRawTransaction(tx);
  } catch (err) {
    const e = new Error(`${artifact.label} deploy send failed: ${errorMessage(err)}`);
    e.scriptBytes = scriptBytes;
    e.txBytes = txBytes;
    e.rpcError = err?.response?.data || null;
    throw e;
  }

  const txid = sendRes.hash || sendRes;
  const appLog = await waitForTx(txid, 180000);
  if (!appLog) {
    throw new Error(`${artifact.label} deploy confirmation timeout: ${txid}`);
  }

  const vmState = appLog.executions?.[0]?.vmstate;
  if (vmState !== "HALT") {
    throw new Error(`${artifact.label} deploy vmstate=${vmState} exception=${appLog.executions?.[0]?.exception || "none"}`);
  }

  const confirmedHash = parseDeployHashFromNotifications(appLog.executions?.[0]?.notifications || []);
  const contractHash = confirmedHash || predictedHash;
  if (!contractHash) {
    throw new Error(`${artifact.label} deploy succeeded but contract hash was not found in notifications`);
  }

  return {
    artifact,
    txid,
    contractHash,
    manifestName: manifestObj.name,
    scriptBytes,
    txBytes,
    gasConsumed: dryRun.gasconsumed,
  };
}

async function tryDeployRust() {
  const details = {
    nefBytes: fileSize(rustArtifact.nef),
    manifestBytes: fileSize(rustArtifact.manifest),
  };

  try {
    const deployed = await deployContract(rustArtifact, { uniqueManifestName: false });
    return { status: "deployed", deployed, details };
  } catch (err) {
    return {
      status: "blocked",
      error: err.message || String(err),
      scriptBytes: err.scriptBytes || null,
      txBytes: err.txBytes || null,
      rpcError: err.rpcError || null,
      details,
    };
  }
}

async function runSolidityFlow(contractHash) {
  const creator = deployer.scriptHash;
  const receiverAccount = new Neon.wallet.Account(Neon.wallet.generatePrivateKey());
  const receiver = receiverAccount.scriptHash;

  let ownerRaw = parseStack((await invokeRead(contractHash, "getOwner", [])).stack?.[0]);
  let ownerHex = typeof ownerRaw === "string" ? ownerRaw : "";
  let ownerBootstrapTx = null;
  if (normalizeHash(ownerHex) === normalizeHash("0x0000000000000000000000000000000000000000")) {
    const bootstrap = await invokeWrite(contractHash, "setOwner", [h(creator)]);
    ownerBootstrapTx = bootstrap.txid;
    ownerRaw = parseStack((await invokeRead(contractHash, "getOwner", [])).stack?.[0]);
    ownerHex = typeof ownerRaw === "string" ? ownerRaw : "";
  }
  assertCondition(sameHash(ownerHex, creator), `Solidity owner mismatch: ${ownerHex} vs ${creator}`);

  const constants = parseStack((await invokeRead(contractHash, "getCalculationConstants", [])).stack?.[0]);
  const expiryWindow = 90_000;

  const spreadBefore = asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0]));
  const spreadConfig = b(encodePaymentConfig(3, expiryWindow, "spread", 0, 0, 0));
  const spreadCreate = await invokeGasTransfer(creator, contractHash, 300_000_000, spreadConfig);
  const spreadAfter = asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0]));

  assertCondition(spreadAfter === spreadBefore + 1, "Spreading envelope creation did not increment total envelope count");
  const envId = spreadBefore + 1;

  const open1 = asNumber((await invokeWrite(contractHash, "openEnvelope", [i(envId), h(creator)])).returnValue);
  assertCondition(open1 > 0, "openEnvelope(creator) returned non-positive amount");

  // Fund receiver so receiver-signed witness transactions can pay fees.
  const fundReceiver = await invokeGasTransfer(creator, receiver, 50_000_000, { type: "Any" });

  const transferEnv = await invokeWrite(contractHash, "transferEnvelope", [
    i(envId),
    h(creator),
    h(receiver),
    b(Buffer.alloc(0)),
  ]);

  const open2 = asNumber(
    (await invokeWrite(contractHash, "openEnvelope", [i(envId), h(receiver)], receiverAccount)).returnValue,
  );
  assertCondition(open2 > 0, "openEnvelope(receiver) returned non-positive amount");

  const hasOpenedCreator = parseStack((await invokeRead(contractHash, "hasOpened", [i(envId), h(creator)])).stack?.[0]);
  const hasOpenedReceiver = parseStack((await invokeRead(contractHash, "hasOpened", [i(envId), h(receiver)])).stack?.[0]);
  assertCondition(hasOpenedCreator === true, "hasOpened for creator should be true");
  assertCondition(hasOpenedReceiver === true, "hasOpened for receiver should be true");

  await sleep(expiryWindow + 5000);
  const reclaimTx = await invokeWrite(contractHash, "reclaimEnvelope", [i(envId), h(creator)]);
  const reclaim = asNumber(reclaimTx.returnValue);

  const poolBefore = asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0]));
  const poolConfig = b(encodePaymentConfig(2, expiryWindow, "pool", 0, 0, 1));
  const poolCreate = await invokeGasTransfer(creator, contractHash, 400_000_000, poolConfig);
  const poolAfter = asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0]));

  assertCondition(poolAfter === poolBefore + 1, "Pool envelope creation did not increment total envelope count");
  const poolId = poolBefore + 1;

  const claim = await invokeWrite(contractHash, "claimFromPool", [i(poolId), h(receiver)], receiverAccount);
  const claimId = asNumber(claim.returnValue);
  assertCondition(claimId > poolId, "claimFromPool did not mint a valid claim id");

  const hasClaimed = parseStack((await invokeRead(contractHash, "hasClaimedFromPool", [i(poolId), h(receiver)])).stack?.[0]);
  assertCondition(hasClaimed === true, "hasClaimedFromPool should be true for receiver");

  const transferClaim = await invokeWrite(
    contractHash,
    "transferClaim",
    [i(claimId), h(receiver), h(creator)],
    receiverAccount,
  );
  const claimOpen = asNumber((await invokeWrite(contractHash, "openClaim", [i(claimId), h(creator)])).returnValue);
  assertCondition(claimOpen > 0, "openClaim returned non-positive amount");

  await sleep(expiryWindow + 5000);
  const poolReclaimTx = await invokeWrite(contractHash, "reclaimPool", [i(poolId), h(creator)]);
  const poolReclaim = asNumber(poolReclaimTx.returnValue);

  const envelopeState = parseStack((await invokeRead(contractHash, "getEnvelopeState", [i(envId)])).stack?.[0]);
  const claimState = parseStack((await invokeRead(contractHash, "getClaimState", [i(claimId)])).stack?.[0]);

  const totals = {
    envelopes: asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes", [])).stack?.[0])),
    distributed: asNumber(parseStack((await invokeRead(contractHash, "getTotalDistributed", [])).stack?.[0])),
  };

  return {
    owner: {
      value: ownerHex,
      bootstrapTx: ownerBootstrapTx,
    },
    constants,
    timing: {
      expiryWindow,
    },
    flow: {
      envId,
      open1,
      open2,
      reclaim,
      poolId,
      claimId,
      claimOpen,
      poolReclaim,
    },
    reads: {
      envelopeState,
      claimState,
    },
    txids: {
      createSpreading: spreadCreate.txid,
      fundReceiver: fundReceiver.txid,
      transferEnvelope: transferEnv.txid,
      reclaimEnvelope: reclaimTx.txid,
      createPool: poolCreate.txid,
      claimFromPool: claim.txid,
      transferClaim: transferClaim.txid,
      reclaimPool: poolReclaimTx.txid,
    },
    totals,
  };
}

async function main() {
  console.log("=============================================");
  console.log("Red Envelope Rust/Solidity TestNet Deployment");
  console.log("=============================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Deployer: ${deployer.address} (${deployer.scriptHash})`);

  const gas = await ensureGasBalance(25);
  console.log(`Deployer GAS: ${gas.toFixed(4)} GAS`);

  console.log("\n[1/3] Attempting Rust deployment...");
  const rust = await tryDeployRust();
  if (rust.status === "deployed") {
    console.log(`Rust deploy tx: ${rust.deployed.txid}`);
    console.log(`Rust contract : ${rust.deployed.contractHash}`);
  } else {
    console.log("Rust deployment blocked.");
    console.log(`- error        : ${rust.error}`);
    console.log(`- nef bytes    : ${rust.details.nefBytes}`);
    console.log(`- manifest     : ${rust.details.manifestBytes}`);
    if (rust.scriptBytes) console.log(`- script bytes : ${rust.scriptBytes}`);
    if (rust.txBytes) console.log(`- tx bytes     : ${rust.txBytes}`);
  }

  console.log("\n[2/3] Deploying Solidity artifact...");
  const solidity = await deployContract(solidityArtifact, { uniqueManifestName: true });
  console.log(`Solidity deploy tx: ${solidity.txid}`);
  console.log(`Solidity contract : ${solidity.contractHash}`);

  console.log("\n[3/3] Executing Solidity flow checks...");
  const solidityChecks = await runSolidityFlow(solidity.contractHash);
  console.log(
    `Solidity flow ok: env=${solidityChecks.flow.envId}, pool=${solidityChecks.flow.poolId}, claim=${solidityChecks.flow.claimId}`,
  );

  const summary = {
    network: "testnet",
    deployer: {
      address: deployer.address,
      scriptHash: deployer.scriptHash,
    },
    rust,
    solidity: {
      contractHash: solidity.contractHash,
      deployTx: solidity.txid,
      manifestName: solidity.manifestName,
      checks: solidityChecks,
    },
  };

  console.log("\nDeployment + test summary:");
  console.log(JSON.stringify(summary, null, 2));

  if (rust.status !== "deployed") {
    throw new Error("Rust deployment blocked by Neo transaction/script size limits; Solidity checks passed.");
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err);
  process.exit(1);
});
