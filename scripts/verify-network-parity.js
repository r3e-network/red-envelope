/**
 * Verify testnet/mainnet contract parity for ABI and core read behavior.
 *
 * Checks:
 * - Manifest method signatures match
 * - Manifest events match
 * - Supported standards match
 * - getCalculationConstants matches (excluding currentTime)
 * - Core read methods HALT on both networks
 *
 * Usage: node scripts/verify-network-parity.js
 */

const NETWORKS = {
  testnet: {
    rpc: "https://testnet1.neo.coz.io:443",
    contract: "0x116b5217bf0916e5c7069770cf40ceee7917d349",
  },
  mainnet: {
    rpc: "https://mainnet1.neo.coz.io:443",
    contract: "0x215099698349ba405400b3b2fe97bb96941c0f9b",
  },
};

const ZERO_HASH = "0000000000000000000000000000000000000000";

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

function parseStackItem(item) {
  if (!item) return null;
  switch (item.type) {
    case "Integer":
      return String(item.value);
    case "Boolean":
      return Boolean(item.value);
    case "ByteString":
      return Buffer.from(item.value, "base64").toString("utf8");
    case "Map": {
      const out = {};
      for (const entry of item.value || []) {
        const k = String(parseStackItem(entry.key));
        out[k] = parseStackItem(entry.value);
      }
      return out;
    }
    case "Array":
      return (item.value || []).map(parseStackItem);
    default:
      return item.value ?? null;
  }
}

function jsonEq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function loadNetworkSnapshot(name, config) {
  const state = await rpc(config.rpc, "getcontractstate", [config.contract]);
  const methods = (state.manifest?.abi?.methods || [])
    .map((m) => `${m.name}/${Array.isArray(m.parameters) ? m.parameters.length : 0}`)
    .sort();
  const events = (state.manifest?.abi?.events || [])
    .map((e) => `${e.name}/${Array.isArray(e.parameters) ? e.parameters.length : 0}`)
    .sort();
  const standards = (state.manifest?.supportedstandards || []).slice().sort();

  const constantsRes = await rpc(config.rpc, "invokefunction", [config.contract, "getCalculationConstants", []]);
  if (constantsRes.state !== "HALT") {
    throw new Error(`[${name}] getCalculationConstants failed: ${constantsRes.state}`);
  }
  const constants = parseStackItem(constantsRes.stack?.[0]) || {};
  delete constants.currentTime;

  const readCases = [
    { op: "getTotalEnvelopes", args: [] },
    { op: "getTotalDistributed", args: [] },
    { op: "getEnvelopeState", args: [{ type: "Integer", value: "999999" }] },
    { op: "getClaimState", args: [{ type: "Integer", value: "999999" }] },
    { op: "hasOpened", args: [{ type: "Integer", value: "999999" }, { type: "Hash160", value: ZERO_HASH }] },
    {
      op: "hasClaimedFromPool",
      args: [{ type: "Integer", value: "999999" }, { type: "Hash160", value: ZERO_HASH }],
    },
    {
      op: "getPoolClaimedAmount",
      args: [{ type: "Integer", value: "999999" }, { type: "Hash160", value: ZERO_HASH }],
    },
    { op: "getOpenedAmount", args: [{ type: "Integer", value: "999999" }, { type: "Hash160", value: ZERO_HASH }] },
    { op: "checkEligibility", args: [{ type: "Integer", value: "999999" }, { type: "Hash160", value: ZERO_HASH }] },
  ];

  const readStates = {};
  for (const c of readCases) {
    const res = await rpc(config.rpc, "invokefunction", [config.contract, c.op, c.args]);
    readStates[c.op] = res.state;
  }

  return {
    methods,
    events,
    standards,
    constants,
    readStates,
  };
}

async function main() {
  const [testnet, mainnet] = await Promise.all([
    loadNetworkSnapshot("testnet", NETWORKS.testnet),
    loadNetworkSnapshot("mainnet", NETWORKS.mainnet),
  ]);

  const failures = [];
  if (!jsonEq(testnet.methods, mainnet.methods)) failures.push("Method signatures differ between networks");
  if (!jsonEq(testnet.events, mainnet.events)) failures.push("Event signatures differ between networks");
  if (!jsonEq(testnet.standards, mainnet.standards)) failures.push("Supported standards differ between networks");
  if (!jsonEq(testnet.constants, mainnet.constants)) failures.push("Calculation constants differ between networks");

  const readOps = Object.keys(testnet.readStates);
  for (const op of readOps) {
    if (testnet.readStates[op] !== "HALT" || mainnet.readStates[op] !== "HALT") {
      failures.push(`Read method ${op} did not HALT on both networks`);
    }
  }

  if (failures.length > 0) {
    console.error("❌ Network parity check failed:");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nSnapshots:");
    console.error(JSON.stringify({ testnet, mainnet }, null, 2));
    process.exit(1);
  }

  console.log("✅ Network parity verified (testnet == mainnet ABI/constants/read behavior)");
  console.log(`Methods: ${testnet.methods.length}, Events: ${testnet.events.length}`);
}

main().catch((err) => {
  console.error("❌ Parity check crashed:", err?.message || err);
  process.exit(1);
});
