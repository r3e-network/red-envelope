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
const receiverAccount = new Neon.wallet.Account(Neon.wallet.generatePrivateKey());
const receiver = receiverAccount.scriptHash;
const rpcClient = new Neon.rpc.RPCClient(RPC_URL);

const csharpArtifact = {
  label: "CSharp",
  nef: path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.nef"),
  manifest: path.resolve(__dirname, "../contracts/bin/sc/RedEnvelope.manifest.json"),
};

const solidityArtifact = {
  label: "Solidity",
  nef: path.resolve(__dirname, "../contracts-solidity/build/RedEnvelope.nef"),
  manifest: path.resolve(__dirname, "../contracts-solidity/build/RedEnvelope.manifest.json"),
  deployData: { type: "ByteArray", value: Buffer.from(deployer.scriptHash, "hex").toString("base64") },
};

const CONSTANT_KEYS = [
  "minAmount",
  "maxPackets",
  "minPerPacket",
  "maxSinglePacketBps",
  "maxSinglePacketAvgBps",
  "percentBase",
  "maxSinglePacketPercent",
  "densePacketThreshold",
  "mediumPacketThreshold",
  "denseVolatilityLowBps",
  "denseVolatilityHighBps",
  "mediumVolatilityLowBps",
  "mediumVolatilityHighBps",
  "sparseVolatilityLowBps",
  "sparseVolatilityHighBps",
  "defaultExpiryMs",
  "maxExpiryMs",
  "defaultMinNeo",
  "defaultMinHoldSeconds",
  "typeSpreading",
  "typePool",
  "typeClaim",
  "currentTime",
];

const ENVELOPE_STATE_KEYS = [
  "id",
  "creator",
  "totalAmount",
  "packetCount",
  "openedCount",
  "claimedCount",
  "remainingAmount",
  "remainingPackets",
  "minNeoRequired",
  "minHoldSeconds",
  "active",
  "expiryTime",
  "currentTime",
  "isExpired",
  "isDepleted",
  "message",
  "envelopeType",
  "parentEnvelopeId",
  "currentHolder",
];

const CLAIM_STATE_KEYS = ["id", "poolId", "holder", "amount", "opened", "message", "expiryTime"];

const ELIGIBILITY_KEYS = ["eligible", "reason", "neoBalance", "minNeoRequired", "minHoldSeconds", "holdDuration", "holdDays"];

function i(value) {
  return { type: "Integer", value: String(value) };
}

function h(scriptHash) {
  return { type: "Hash160", value: scriptHash };
}

function b(buffer) {
  return { type: "ByteArray", value: Buffer.from(buffer || []).toString("base64") };
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

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRpcError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("etimedout") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("504") ||
    msg.includes("enotfound")
  );
}

async function withRpcRetry(label, fn, attempts = 5, baseDelayMs = 1200) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientRpcError(err) || i === attempts - 1) {
        throw err;
      }
      const waitMs = baseDelayMs * (i + 1);
      console.warn(`[rpc-retry] ${label} failed (${errorMessage(err)}), retry in ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function errorMessage(err) {
  if (!err) return "unknown error";
  if (err?.response?.data?.message) return String(err.response.data.message);
  if (err?.response?.data?.error?.message) return String(err.response.data.error.message);
  if (err?.message) return String(err.message);
  return String(err);
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

function isZeroHash(value) {
  const v = normalizeHash(value);
  return v === "0000000000000000000000000000000000000000";
}

function parseByteString(base64, { mapKey = false } = {}) {
  const buf = Buffer.from(base64 || "", "base64");
  if (buf.length === 0) return "";
  if (buf.length === 20 && !mapKey) return `0x${buf.toString("hex")}`;

  const utf8 = buf.toString("utf8");
  if (/^[\x20-\x7e]+$/.test(utf8)) {
    return utf8;
  }
  return `0x${buf.toString("hex")}`;
}

function parseStack(item, { mapKey = false } = {}) {
  if (!item) return null;

  switch (item.type) {
    case "Integer": {
      const n = BigInt(item.value || "0");
      if (n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER)) {
        return Number(n);
      }
      return n.toString();
    }
    case "Boolean":
      return Boolean(item.value);
    case "Hash160":
      return `0x${String(item.value || "").toLowerCase()}`;
    case "ByteString":
    case "Buffer":
      return parseByteString(item.value, { mapKey });
    case "String":
      return item.value || "";
    case "Array":
    case "Struct":
      return (item.value || []).map((v) => parseStack(v));
    case "Map": {
      const out = {};
      for (const entry of item.value || []) {
        const key = String(parseStack(entry.key, { mapKey: true }));
        out[key] = parseStack(entry.value);
      }
      return out;
    }
    case "Any":
      return null;
    default:
      return item.value ?? null;
  }
}

function asNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return Number(value || 0);
}

function toObjectByKeys(value, keys) {
  if (Array.isArray(value)) {
    const out = {};
    for (let i = 0; i < keys.length; i += 1) {
      out[keys[i]] = value[i];
    }
    return out;
  }
  return value && typeof value === "object" ? value : {};
}

function normalizeConstants(value) {
  const obj = toObjectByKeys(value, CONSTANT_KEYS);
  const out = {};
  for (const key of CONSTANT_KEYS) {
    out[key] = obj[key];
  }
  return out;
}

function normalizeEnvelopeState(value) {
  return toObjectByKeys(value, ENVELOPE_STATE_KEYS);
}

function normalizeClaimState(value) {
  return toObjectByKeys(value, CLAIM_STATE_KEYS);
}

function normalizeEligibility(value) {
  return toObjectByKeys(value, ELIGIBILITY_KEYS);
}

function stripCurrentTime(constantsObj) {
  const out = { ...constantsObj };
  delete out.currentTime;
  return out;
}

function allValuesNull(obj) {
  return Object.values(obj || {}).every((v) => v === null || typeof v === "undefined");
}

function parseDeployHashFromNotifications(notifications) {
  for (const n of notifications || []) {
    if (n.eventname !== "Deploy") continue;
    const hashB64 = n.state?.value?.[0]?.value;
    if (!hashB64) continue;
    const rawHex = Buffer.from(hashB64, "base64").toString("hex");
    return `0x${Neon.u.reverseHex(rawHex)}`;
  }
  return null;
}

async function waitForTx(txid, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await withRpcRetry("getapplicationlog", () =>
        rpcClient.execute(new Neon.rpc.Query({ method: "getapplicationlog", params: [txid] })),
      );
      if (res) return res;
    } catch (err) {
      const msg = String(err?.message || "");
      if (err?.response?.status !== 404 && !msg.includes("Unknown script container")) {
        console.warn(`[waitForTx] ${msg || err}`);
      }
    }
    await sleep(2500);
  }
  return null;
}

async function invokeRead(contractHash, operation, args = []) {
  const res = await withRpcRetry(`read ${operation}`, () =>
    rpcClient.execute(new Neon.rpc.Query({ method: "invokefunction", params: [contractHash, operation, args] })),
  );
  if (res.state !== "HALT") {
    throw new Error(`read ${operation} fault: ${res.exception || res.state}`);
  }
  return res;
}

async function invokeWrite(contractHash, operation, args = [], signerAccount = deployer) {
  const signer = { account: signerAccount.scriptHash, scopes: "CalledByEntry" };
  const dryRun = await withRpcRetry(`dryrun ${operation}`, () =>
    rpcClient.execute(new Neon.rpc.Query({ method: "invokefunction", params: [contractHash, operation, args, [signer]] })),
  );
  if (dryRun.state !== "HALT") {
    throw new Error(`write ${operation} dry-run fault: ${dryRun.exception || dryRun.state}`);
  }

  const scriptHex = Buffer.from(dryRun.script, "base64").toString("hex");
  const currentHeight = await withRpcRetry("getBlockCount", () => rpcClient.getBlockCount());
  const tx = new Neon.tx.Transaction({
    signers: [{ account: signerAccount.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.3));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  tx.sign(signerAccount, NETWORK_MAGIC);

  const sendRes = await withRpcRetry(`send ${operation}`, () => rpcClient.sendRawTransaction(tx));
  const txid = sendRes.hash || sendRes;
  const appLog = await waitForTx(txid);
  if (!appLog) {
    throw new Error(`write ${operation} confirmation timeout: ${txid}`);
  }
  const vmState = appLog.executions?.[0]?.vmstate;
  if (vmState !== "HALT") {
    throw new Error(`write ${operation} vmstate=${vmState} exception=${appLog.executions?.[0]?.exception || "none"}`);
  }

  return { txid, returnValue: parseStack(dryRun.stack?.[0]) };
}

async function invokeGasTransfer(fromScriptHash, toContractHash, amount, dataParam) {
  return invokeWrite(GAS_HASH, "transfer", [h(fromScriptHash), h(toContractHash), i(amount), dataParam]);
}

async function buildDeployTx(nefBytes, manifestStr, deployData) {
  const args = [
    { type: "ByteArray", value: nefBytes.toString("base64") },
    { type: "String", value: manifestStr },
  ];
  if (deployData) args.push(deployData);

  const signer = { account: deployer.scriptHash, scopes: "CalledByEntry" };
  const dryRun = await withRpcRetry("dryrun deploy", () =>
    rpcClient.execute(new Neon.rpc.Query({ method: "invokefunction", params: [CONTRACT_MANAGEMENT, "deploy", args, [signer]] })),
  );
  if (dryRun.state !== "HALT") {
    throw new Error(`deploy dry-run fault: ${dryRun.exception || dryRun.state}`);
  }

  const scriptHex = Buffer.from(dryRun.script, "base64").toString("hex");
  const currentHeight = await withRpcRetry("getBlockCount", () => rpcClient.getBlockCount());
  const tx = new Neon.tx.Transaction({
    signers: [{ account: deployer.scriptHash, scopes: Neon.tx.WitnessScope.CalledByEntry }],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(Number(dryRun.gasconsumed) * 1.5));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000);
  tx.sign(deployer, NETWORK_MAGIC);

  return {
    tx,
    predictedHash: parseDeployHashFromNotifications(dryRun.notifications || []),
  };
}

async function deployContract(artifact) {
  if (!fs.existsSync(artifact.nef) || !fs.existsSync(artifact.manifest)) {
    throw new Error(`${artifact.label} artifacts not found`);
  }

  const nefBytes = fs.readFileSync(artifact.nef);
  const manifestObj = JSON.parse(fs.readFileSync(artifact.manifest, "utf8"));
  manifestObj.name = `${manifestObj.name}_${Date.now()}`;

  const { tx, predictedHash } = await buildDeployTx(nefBytes, JSON.stringify(manifestObj), artifact.deployData);
  const sendRes = await withRpcRetry(`deploy ${artifact.label}`, () => rpcClient.sendRawTransaction(tx));
  const txid = sendRes.hash || sendRes;

  const appLog = await waitForTx(txid, 240000);
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
    throw new Error(`${artifact.label} deploy succeeded but hash missing`);
  }

  return { txid, contractHash, manifestName: manifestObj.name };
}

async function ensureOwner(contractHash) {
  let owner = parseStack((await invokeRead(contractHash, "getOwner")).stack?.[0]);
  let bootstrapTx = null;
  if (isZeroHash(owner)) {
    const bootstrap = await invokeWrite(contractHash, "setOwner", [h(deployer.scriptHash)]);
    bootstrapTx = bootstrap.txid;
    owner = parseStack((await invokeRead(contractHash, "getOwner")).stack?.[0]);
  }
  assertCondition(sameHash(owner, deployer.scriptHash), `owner mismatch: ${owner} vs ${deployer.scriptHash}`);
  return { owner, bootstrapTx };
}

async function runPreExpiryFlow(contractHash, label, expiryWindow) {
  console.log(`[${label}] pre-expiry flow start`);
  const totalsBefore = {
    envelopes: asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes")).stack?.[0])),
    distributed: asNumber(parseStack((await invokeRead(contractHash, "getTotalDistributed")).stack?.[0])),
  };
  assertCondition(totalsBefore.envelopes === 0, `${label}: expected clean envelopes=0`);

  const spreadCreate = await invokeGasTransfer(
    deployer.scriptHash,
    contractHash,
    300_000_000,
    configArray(3, expiryWindow, "spread", 0, 0, 0),
  );
  const spreadCreated = Boolean(spreadCreate.returnValue);
  assertCondition(spreadCreated === true, `${label}: spread create returned false`);

  const envId = 1;
  await invokeWrite(contractHash, "openEnvelope", [i(envId), h(deployer.scriptHash)]);
  const open1 = asNumber(parseStack((await invokeRead(contractHash, "getOpenedAmount", [i(envId), h(deployer.scriptHash)])).stack?.[0]));
  assertCondition(open1 > 0, `${label}: openEnvelope creator amount <= 0`);

  await invokeGasTransfer(deployer.scriptHash, receiver, 50_000_000, { type: "Any" });
  await invokeWrite(contractHash, "transferEnvelope", [i(envId), h(deployer.scriptHash), h(receiver), b(Buffer.alloc(0))]);
  await invokeWrite(contractHash, "openEnvelope", [i(envId), h(receiver)], receiverAccount);
  const open2 = asNumber(parseStack((await invokeRead(contractHash, "getOpenedAmount", [i(envId), h(receiver)])).stack?.[0]));
  assertCondition(open2 > 0, `${label}: openEnvelope receiver amount <= 0`);

  const hasOpenedCreator = parseStack((await invokeRead(contractHash, "hasOpened", [i(envId), h(deployer.scriptHash)])).stack?.[0]);
  const hasOpenedReceiver = parseStack((await invokeRead(contractHash, "hasOpened", [i(envId), h(receiver)])).stack?.[0]);
  assertCondition(hasOpenedCreator === true, `${label}: hasOpened creator != true`);
  assertCondition(hasOpenedReceiver === true, `${label}: hasOpened receiver != true`);

  const poolCreate = await invokeGasTransfer(
    deployer.scriptHash,
    contractHash,
    400_000_000,
    configArray(2, expiryWindow, "pool", 0, 0, 1),
  );
  assertCondition(Boolean(poolCreate.returnValue) === true, `${label}: pool create returned false`);

  const poolId = 2;
  const claimId = asNumber((await invokeWrite(contractHash, "claimFromPool", [i(poolId), h(receiver)], receiverAccount)).returnValue);
  assertCondition(claimId > poolId, `${label}: claimFromPool invalid claimId`);

  const hasClaimed = parseStack((await invokeRead(contractHash, "hasClaimedFromPool", [i(poolId), h(receiver)])).stack?.[0]);
  assertCondition(hasClaimed === true, `${label}: hasClaimedFromPool != true`);

  const poolClaimedAmount = asNumber(
    parseStack((await invokeRead(contractHash, "getPoolClaimedAmount", [i(poolId), h(receiver)])).stack?.[0]),
  );
  assertCondition(poolClaimedAmount > 0, `${label}: getPoolClaimedAmount <= 0`);

  const claimIdByIndex = asNumber(parseStack((await invokeRead(contractHash, "getPoolClaimIdByIndex", [i(poolId), i(1)])).stack?.[0]));
  assertCondition(claimIdByIndex === claimId, `${label}: getPoolClaimIdByIndex mismatch`);

  await invokeWrite(contractHash, "transferClaim", [i(claimId), h(receiver), h(deployer.scriptHash)], receiverAccount);
  const claimOpen = asNumber((await invokeWrite(contractHash, "openClaim", [i(claimId), h(deployer.scriptHash)])).returnValue);
  assertCondition(claimOpen > 0, `${label}: openClaim amount <= 0`);

  const notFoundEligibility = normalizeEligibility(
    parseStack((await invokeRead(contractHash, "checkEligibility", [i(999999), h(deployer.scriptHash)])).stack?.[0]),
  );
  const notFoundOpenEligibility = normalizeEligibility(
    parseStack((await invokeRead(contractHash, "checkOpenEligibility", [i(999999), h(deployer.scriptHash)])).stack?.[0]),
  );
  const notFoundEligibilityUnsupported = allValuesNull(notFoundEligibility);
  const notFoundOpenEligibilityUnsupported = allValuesNull(notFoundOpenEligibility);

  return {
    envId,
    poolId,
    claimId,
    open1,
    open2,
    claimOpen,
    poolClaimedAmount,
    claimIdByIndex,
    notFoundEligibility,
    notFoundOpenEligibility,
    notFoundEligibilityUnsupported,
    notFoundOpenEligibilityUnsupported,
  };
}

async function runPostExpiryFlow(contractHash, label, ids) {
  console.log(`[${label}] post-expiry flow start`);
  const reclaim = asNumber((await invokeWrite(contractHash, "reclaimEnvelope", [i(ids.envId), h(deployer.scriptHash)])).returnValue);
  const poolReclaim = asNumber((await invokeWrite(contractHash, "reclaimPool", [i(ids.poolId), h(deployer.scriptHash)])).returnValue);

  const envelopeState = normalizeEnvelopeState(
    parseStack((await invokeRead(contractHash, "getEnvelopeState", [i(ids.envId)])).stack?.[0]),
  );
  const claimState = normalizeClaimState(parseStack((await invokeRead(contractHash, "getClaimState", [i(ids.claimId)])).stack?.[0]));
  const constants = normalizeConstants(parseStack((await invokeRead(contractHash, "getCalculationConstants")).stack?.[0]));
  const totals = {
    envelopes: asNumber(parseStack((await invokeRead(contractHash, "getTotalEnvelopes")).stack?.[0])),
    distributed: asNumber(parseStack((await invokeRead(contractHash, "getTotalDistributed")).stack?.[0])),
  };

  return {
    reclaim,
    poolReclaim,
    envelopeState,
    claimState,
    constants,
    constantsUnsupported: allValuesNull(stripCurrentTime(constants)),
    envelopeStateUnsupported: allValuesNull(envelopeState),
    claimStateUnsupported: allValuesNull(claimState),
    totals,
  };
}

function pickParityView(flow, post) {
  return {
    ids: {
      envId: flow.envId,
      poolId: flow.poolId,
      claimId: flow.claimId,
    },
    constants: stripCurrentTime(post.constants),
    constantsUnsupported: post.constantsUnsupported,
    totals: post.totals,
    envelopeState: {
      id: asNumber(post.envelopeState.id),
      packetCount: asNumber(post.envelopeState.packetCount),
      openedCount: asNumber(post.envelopeState.openedCount),
      remainingAmount: asNumber(post.envelopeState.remainingAmount),
      remainingPackets: asNumber(post.envelopeState.remainingPackets),
      active: Boolean(post.envelopeState.active),
      envelopeType: asNumber(post.envelopeState.envelopeType),
      parentEnvelopeId: asNumber(post.envelopeState.parentEnvelopeId),
    },
    envelopeStateUnsupported: post.envelopeStateUnsupported,
    claimState: {
      id: asNumber(post.claimState.id),
      poolId: asNumber(post.claimState.poolId),
      opened: Boolean(post.claimState.opened),
      amount: asNumber(post.claimState.amount),
    },
    claimStateUnsupported: post.claimStateUnsupported,
    poolClaimedAmount: flow.poolClaimedAmount,
    claimIdByIndex: flow.claimIdByIndex,
    notFoundEligibility: {
      eligible: Boolean(flow.notFoundEligibility.eligible),
      reason: String(flow.notFoundEligibility.reason || ""),
    },
    notFoundEligibilityUnsupported: flow.notFoundEligibilityUnsupported,
    notFoundOpenEligibility: {
      eligible: Boolean(flow.notFoundOpenEligibility.eligible),
      reason: String(flow.notFoundOpenEligibility.reason || ""),
    },
    notFoundOpenEligibilityUnsupported: flow.notFoundOpenEligibilityUnsupported,
  };
}

function assertFlowInvariants(label, flow, post) {
  const spreadTotal = flow.open1 + flow.open2 + post.reclaim;
  const poolTotal = flow.claimOpen + post.poolReclaim;
  assertCondition(spreadTotal === 300_000_000, `${label}: spread conservation mismatch (${spreadTotal})`);
  assertCondition(poolTotal === 400_000_000, `${label}: pool conservation mismatch (${poolTotal})`);
  assertCondition(post.totals.envelopes === 2, `${label}: total envelopes mismatch (${post.totals.envelopes})`);
  assertCondition(post.totals.distributed === 700_000_000, `${label}: total distributed mismatch (${post.totals.distributed})`);
}

function deepEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertParity(csharp, solidity) {
  if (!csharp.constantsUnsupported && !solidity.constantsUnsupported) {
    assertCondition(deepEq(csharp.constants, solidity.constants), "constants mismatch between C# and Solidity");
  }
  assertCondition(deepEq(csharp.totals, solidity.totals), "totals mismatch between C# and Solidity");
  if (!csharp.envelopeStateUnsupported && !solidity.envelopeStateUnsupported) {
    assertCondition(deepEq(csharp.envelopeState, solidity.envelopeState), "envelopeState mismatch between C# and Solidity");
  }
  if (!csharp.claimStateUnsupported && !solidity.claimStateUnsupported) {
    assertCondition(deepEq(csharp.claimState, solidity.claimState), "claimState mismatch between C# and Solidity");
  }
  assertCondition(csharp.claimIdByIndex === csharp.ids.claimId, "C# claim index id mismatch");
  assertCondition(solidity.claimIdByIndex === solidity.ids.claimId, "Solidity claim index id mismatch");
  assertCondition(csharp.poolClaimedAmount > 0, "C# poolClaimedAmount invalid");
  assertCondition(solidity.poolClaimedAmount > 0, "Solidity poolClaimedAmount invalid");
  if (!csharp.notFoundEligibilityUnsupported && !solidity.notFoundEligibilityUnsupported) {
    assertCondition(
      deepEq(csharp.notFoundEligibility, solidity.notFoundEligibility),
      "checkEligibility(not-found) mismatch between C# and Solidity",
    );
  }
  if (!csharp.notFoundOpenEligibilityUnsupported && !solidity.notFoundOpenEligibilityUnsupported) {
    assertCondition(
      deepEq(csharp.notFoundOpenEligibility, solidity.notFoundOpenEligibility),
      "checkOpenEligibility(not-found) mismatch between C# and Solidity",
    );
  }
}

async function main() {
  console.log("===========================================");
  console.log("C# vs Solidity parity validation (testnet)");
  console.log("===========================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Deployer: ${deployer.address} (${deployer.scriptHash})`);
  console.log(`Receiver: ${receiverAccount.address} (${receiver})`);

  const csharp = await deployContract(csharpArtifact);
  console.log(`C# deploy tx : ${csharp.txid}`);
  console.log(`C# contract  : ${csharp.contractHash}`);

  const solidity = await deployContract(solidityArtifact);
  console.log(`Solidity deploy tx: ${solidity.txid}`);
  console.log(`Solidity contract : ${solidity.contractHash}`);

  const csharpOwner = await ensureOwner(csharp.contractHash);
  const solidityOwner = await ensureOwner(solidity.contractHash);

  const expiryWindow = 180_000;
  const csharpPre = await runPreExpiryFlow(csharp.contractHash, "CSharp", expiryWindow);
  const solidityPre = await runPreExpiryFlow(solidity.contractHash, "Solidity", expiryWindow);

  console.log(`Waiting ${expiryWindow + 5000}ms for expiry windows...`);
  await sleep(expiryWindow + 5000);

  const csharpPost = await runPostExpiryFlow(csharp.contractHash, "CSharp", csharpPre);
  const solidityPost = await runPostExpiryFlow(solidity.contractHash, "Solidity", solidityPre);

  assertFlowInvariants("CSharp", csharpPre, csharpPost);
  assertFlowInvariants("Solidity", solidityPre, solidityPost);

  const csharpParity = pickParityView(csharpPre, csharpPost);
  const solidityParity = pickParityView(solidityPre, solidityPost);
  assertParity(csharpParity, solidityParity);

  console.log("✅ C# and Solidity parity validated on testnet");
  console.log(
    JSON.stringify(
      {
        network: "testnet",
        rpc: RPC_URL,
        deployer: { address: deployer.address, scriptHash: deployer.scriptHash },
        receiver: { address: receiverAccount.address, scriptHash: receiver },
        deployments: {
          csharp,
          solidity,
        },
        owners: {
          csharp: csharpOwner,
          solidity: solidityOwner,
        },
        csharp: {
          flow: csharpPre,
          post: csharpPost,
          parity: csharpParity,
        },
        solidity: {
          flow: solidityPre,
          post: solidityPost,
          parity: solidityParity,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("❌ C# vs Solidity parity validation failed:", err?.message || err);
  process.exit(1);
});
