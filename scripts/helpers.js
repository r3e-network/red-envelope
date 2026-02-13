/**
 * Shared helpers for end-to-end scripts.
 * Uses @cityofzion/neon-js v5.
 */
const Neon = require("@cityofzion/neon-js");

const NETWORK_PRESETS = {
  testnet: {
    RPC_URL: "https://testnet1.neo.coz.io:443",
    CONTRACT: "0x116b5217bf0916e5c7069770cf40ceee7917d349",
    NETWORK_MAGIC: 894710606,
  },
  mainnet: {
    RPC_URL: "https://mainnet1.neo.coz.io:443",
    CONTRACT: "0x215099698349ba405400b3b2fe97bb96941c0f9b",
    NETWORK_MAGIC: 860833102,
  },
};

const requestedNetwork = String(process.env.NETWORK || "mainnet").trim().toLowerCase();
const preset = NETWORK_PRESETS[requestedNetwork] || NETWORK_PRESETS.mainnet;
if (!(requestedNetwork in NETWORK_PRESETS)) {
  console.warn(`[helpers] Unknown NETWORK=\"${requestedNetwork}\", defaulting to \"mainnet\"`);
}

const NETWORK = requestedNetwork in NETWORK_PRESETS ? requestedNetwork : "mainnet";
const RPC_URL = process.env.RPC_URL || preset.RPC_URL;
const CONTRACT = process.env.CONTRACT || preset.CONTRACT;
const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const NEO_HASH = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";
const NETWORK_MAGIC = Number(process.env.NETWORK_MAGIC || preset.NETWORK_MAGIC);

// SECURITY: Load private keys from environment variables. Never hardcode keys in source.
// Scripts that need signing should call requireSignerKeys().
const KEY1_WIF = process.env.KEY1_WIF;
const KEY2_WIF = process.env.KEY2_WIF;
if (!Number.isFinite(NETWORK_MAGIC)) {
  console.error("ERROR: NETWORK_MAGIC must be a valid number.");
  process.exit(1);
}

const key1 = KEY1_WIF ? new Neon.wallet.Account(KEY1_WIF) : null;
const key2 = KEY2_WIF ? new Neon.wallet.Account(KEY2_WIF) : null;
const rpcClient = new Neon.rpc.RPCClient(RPC_URL);

function requireKey1(scriptName = "this script") {
  if (!key1) {
    console.error("ERROR: KEY1_WIF environment variable is required.");
    console.error(`Export it before running ${scriptName}: export KEY1_WIF=...`);
    process.exit(1);
  }
}

function requireKey2(scriptName = "this script") {
  if (!key2) {
    console.error("ERROR: KEY2_WIF environment variable is required.");
    console.error(`Export it before running ${scriptName}: export KEY2_WIF=...`);
    process.exit(1);
  }
}

function requireSignerKeys(scriptName = "this script") {
  requireKey1(scriptName);
  requireKey2(scriptName);
}

/** Poll until TX is confirmed (application log available) */
async function waitForTx(txid, maxMs = 90000) {
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
      // Log non-404 errors for debugging; 404 means TX not yet confirmed
      if (err?.response?.status !== 404) {
        console.debug(`[waitForTx] polling error: ${err.message || err}`);
      }
    }
    await sleep(3000);
    process.stdout.write(".");
  }
  console.log(" ⚠️ timeout");
  return null;
}

/** Read-only contract invoke */
async function invokeRead(operation, args = []) {
  return rpcClient.invokeFunction(CONTRACT, operation, args);
}

/** Parse a Map stack item into a JS object */
function parseMap(stackItem) {
  if (stackItem.type !== "Map") return null;
  const map = {};
  for (const entry of stackItem.value) {
    const key =
      entry.key.type === "ByteString" ? Buffer.from(entry.key.value, "base64").toString() : String(entry.key.value);
    const val = entry.value;
    if (val.type === "Integer") map[key] = Number(val.value);
    else if (val.type === "Boolean") map[key] = val.value;
    else if (val.type === "ByteString") map[key] = val.value ? Buffer.from(val.value, "base64").toString() : "";
    else map[key] = val.value;
  }
  return map;
}

/** Get envelope state as parsed object */
async function getEnvelopeState(id) {
  const res = await invokeRead("getEnvelopeState", [{ type: "Integer", value: String(id) }]);
  if (!res.stack || !res.stack[0]) return null;
  return parseMap(res.stack[0]);
}

/** Get GAS balance (human-readable) */
async function getGasBalance(address) {
  const res = await rpcClient.invokeFunction(GAS_HASH, "balanceOf", [
    { type: "Hash160", value: Neon.wallet.getScriptHashFromAddress(address) },
  ]);
  return Number(res.stack[0].value) / 1e8;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  Neon,
  NETWORK,
  RPC_URL,
  CONTRACT,
  GAS_HASH,
  NEO_HASH,
  NETWORK_MAGIC,
  key1,
  key2,
  requireKey1,
  requireKey2,
  requireSignerKeys,
  rpcClient,
  waitForTx,
  invokeRead,
  parseMap,
  getEnvelopeState,
  getGasBalance,
  sleep,
};
