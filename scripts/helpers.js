/**
 * Shared helpers for end-to-end testnet testing.
 * Uses @cityofzion/neon-js v5.
 */
const Neon = require("@cityofzion/neon-js");

const RPC_URL = "https://testnet1.neo.coz.io:443";
const CONTRACT = "0x36a46aa95413029e340e57365cdadd3ae29244ff";
const GAS_HASH = "0xd2a4cff31913016155e38e474a2c06d08be276cf";
const NEO_HASH = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";
const NETWORK_MAGIC = 894710606; // Neo N3 TestNet

const KEY1_WIF = "Kx2BeyUv1dBr99QtjrRsE7xxQqcHHZJmEWXvV8ivyShgWq7BbA4U";
const KEY2_WIF = "KzjaqMvqzF1uup6KrTKRxTgjcXE7PbKLRH84e6ckyXDt3fu7afUb";

const key1 = new Neon.wallet.Account(KEY1_WIF);
const key2 = new Neon.wallet.Account(KEY2_WIF);
const rpcClient = new Neon.rpc.RPCClient(RPC_URL);

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
    } catch {}
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
  RPC_URL,
  CONTRACT,
  GAS_HASH,
  NEO_HASH,
  NETWORK_MAGIC,
  key1,
  key2,
  rpcClient,
  waitForTx,
  invokeRead,
  parseMap,
  getEnvelopeState,
  getGasBalance,
  sleep,
};
