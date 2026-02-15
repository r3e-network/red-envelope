/**
 * Smoke test — verifies contract connectivity and read-only operations.
 * Works without signer private keys.
 * Usage:
 *   node scripts/test-testnet.js               # default NETWORK=testnet
 *   NETWORK=mainnet node scripts/test-testnet.js
 */
process.env.NETWORK = process.env.NETWORK || "testnet";

const {
  Neon,
  NETWORK,
  RPC_URL,
  CONTRACT,
  GAS_HASH,
  NEO_HASH,
  key1,
  key2,
  rpcClient,
  invokeRead,
  parseMap,
  getEnvelopeState,
  getGasBalance,
} = require("./helpers");

const PASS = "✅";
const FAIL = "❌";
const WARN = "⚠️";
let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ${PASS} ${label}${detail ? " — " + detail : ""}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function main() {
  const key1Address = key1?.address || process.env.KEY1_ADDRESS || null;
  const key2Address = key2?.address || process.env.KEY2_ADDRESS || null;
  const networkLabel = NETWORK === "testnet" ? "TestNet" : NETWORK === "mainnet" ? "MainNet" : "Custom";

  console.log("═══════════════════════════════════════════");
  console.log(`  Red Envelope — ${networkLabel} Smoke Test`);
  console.log("═══════════════════════════════════════════");
  console.log(`  RPC:      ${RPC_URL}`);
  console.log(`  Contract: ${CONTRACT}`);
  console.log(`  Key1:     ${key1Address || "(not set)"}`);
  console.log(`  Key2:     ${key2Address || "(not set)"}`);
  console.log("───────────────────────────────────────────");

  // ── 1. RPC Connectivity ──
  console.log("\n[1/6] RPC Connectivity");
  try {
    const blockCount = await rpcClient.getBlockCount();
    check("RPC reachable", blockCount > 0, `block height = ${blockCount}`);
  } catch (e) {
    check("RPC reachable", false, e.message);
  }

  // ── 2. Contract Exists ──
  console.log("\n[2/6] Contract Existence");
  try {
    const state = await rpcClient.execute(new Neon.rpc.Query({ method: "getcontractstate", params: [CONTRACT] }));
    const name = state?.manifest?.name ?? "unknown";
    check("Contract deployed", !!state, `name = "${name}"`);
    check(
      "NEP-11 standard",
      state?.manifest?.supportedstandards?.includes("NEP-11"),
      JSON.stringify(state?.manifest?.supportedstandards),
    );
  } catch (e) {
    check("Contract deployed", false, e.message);
    check("NEP-11 standard", false, "skipped");
  }

  // ── 3. Read-Only: Constants ──
  console.log("\n[3/6] GetCalculationConstants");
  try {
    const res = await invokeRead("getCalculationConstants");
    check("VM state HALT", res.state === "HALT", `state = ${res.state}`);
    const constants = parseMap(res.stack[0]);
    check("Constants parsed", !!constants);
    if (constants) {
      check("minAmount = 100000000 (1 GAS)", constants.minAmount === 100000000);
      check("maxPackets = 100", constants.maxPackets === 100);
      check("minPerPacket = 10000000 (0.1 GAS)", constants.minPerPacket === 10000000);
      check("maxSinglePacketPercent = 20", constants.maxSinglePacketPercent === 20);
      check("percentBase = 10000", constants.percentBase === 10000);
      check("defaultExpiryMs = 604800000 (7d)", constants.defaultExpiryMs === 604800000);
      check("maxExpiryMs = 604800000 (7d)", constants.maxExpiryMs === 604800000);
      check("typeSpreading = 0", constants.typeSpreading === 0);
      check("typePool = 1", constants.typePool === 1);
      check("typeClaim = 2", constants.typeClaim === 2);
      console.log(`    currentTime = ${constants.currentTime} (${new Date(constants.currentTime).toISOString()})`);
    }
  } catch (e) {
    check("getCalculationConstants", false, e.message);
  }

  // ── 4. Read-Only: Stats ──
  console.log("\n[4/6] Contract Stats");
  let totalEnvelopes = 0;
  try {
    const envRes = await invokeRead("getTotalEnvelopes");
    totalEnvelopes = Number(envRes.stack?.[0]?.value ?? 0);
    check("getTotalEnvelopes", envRes.state === "HALT", `total = ${totalEnvelopes}`);

    const distRes = await invokeRead("getTotalDistributed");
    const totalDist = Number(distRes.stack?.[0]?.value ?? 0);
    check("getTotalDistributed", distRes.state === "HALT", `total = ${(totalDist / 1e8).toFixed(2)} GAS`);
  } catch (e) {
    check("Contract stats", false, e.message);
  }

  // ── 5. Envelope State (if any exist) ──
  console.log("\n[5/6] Envelope State Query");
  if (totalEnvelopes > 0) {
    try {
      const env = await getEnvelopeState(1);
      check("getEnvelopeState(1)", !!env);
      if (env) {
        console.log(
          `    type=${env.envelopeType}, active=${env.active}, packets=${env.packetCount}, opened=${env.openedCount}`,
        );
        console.log(
          `    totalAmount=${(env.totalAmount / 1e8).toFixed(2)} GAS, remaining=${(env.remainingAmount / 1e8).toFixed(2)} GAS`,
        );
      }
    } catch (e) {
      check("getEnvelopeState(1)", false, e.message);
    }

    // Also test latest envelope
    if (totalEnvelopes > 1) {
      try {
        const latest = await getEnvelopeState(totalEnvelopes);
        check(`getEnvelopeState(${totalEnvelopes}) [latest]`, !!latest);
        if (latest) {
          console.log(
            `    type=${latest.envelopeType}, active=${latest.active}, packets=${latest.packetCount}, opened=${latest.openedCount}`,
          );
        }
      } catch (e) {
        check(`getEnvelopeState(${totalEnvelopes})`, false, e.message);
      }
    }
  } else {
    console.log(`  ${WARN} No envelopes created yet — skipping state queries`);
  }

  // ── 6. Account Balances ──
  console.log("\n[6/6] Test Account Balances");
  if (!key1Address && !key2Address) {
    console.log(`  ${WARN} Skipped: set KEY1_WIF/KEY2_WIF or KEY1_ADDRESS/KEY2_ADDRESS to include balance checks`);
  } else {
    try {
      if (key1Address) {
        const gas1 = await getGasBalance(key1Address);
        check("Key1 GAS balance", gas1 >= 0, `${gas1.toFixed(4)} GAS`);
      } else {
        console.log(`  ${WARN} Key1 address not set — skipping Key1 balance checks`);
      }

      if (key2Address) {
        const gas2 = await getGasBalance(key2Address);
        check("Key2 GAS balance", gas2 >= 0, `${gas2.toFixed(4)} GAS`);
      } else {
        console.log(`  ${WARN} Key2 address not set — skipping Key2 balance checks`);
      }

      if (key1Address) {
        const neo1Res = await rpcClient.invokeFunction(NEO_HASH, "balanceOf", [
          { type: "Hash160", value: Neon.wallet.getScriptHashFromAddress(key1Address) },
        ]);
        const neo1 = Number(neo1Res.stack?.[0]?.value ?? 0);
        check("Key1 NEO balance", neo1 >= 0, `${neo1} NEO`);
      }
    } catch (e) {
      check("Account balances", false, e.message);
    }
  }

  // ── Summary ──
  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
