/**
 * End-to-End Logic Test — exercises all contract operations on testnet.
 *
 * Tests: create envelopes (spreading + pool), open, claim, transfer, reclaim.
 * Uses Key1 and Key2 from helpers.js.
 *
 * Usage:
 *   KEY1_WIF=... KEY2_WIF=... node scripts/test-e2e.js               # default NETWORK=testnet
 *   NETWORK=mainnet KEY1_WIF=... KEY2_WIF=... node scripts/test-e2e.js
 */
process.env.NETWORK = process.env.NETWORK || "testnet";

const {
  Neon,
  NETWORK,
  CONTRACT,
  GAS_HASH,
  NETWORK_MAGIC,
  key1,
  key2,
  requireSignerKeys,
  rpcClient,
  waitForTx,
  invokeRead,
  parseMap,
  getEnvelopeState,
  getGasBalance,
  sleep,
} = require("./helpers");

const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";
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
  return ok;
}

// ─────────────────────────────────────────────────────────────
// Transaction helpers
// ─────────────────────────────────────────────────────────────

/** Build script hex, dry-run, sign, send, wait for confirmation. */
async function sendTx(account, scriptHex, label) {
  // 1. Dry-run via invokescript
  const scriptB64 = Buffer.from(scriptHex, "hex").toString("base64");
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokescript",
      params: [scriptB64, [{ account: account.scriptHash, scopes: "CalledByEntry" }]],
    }),
  );

  if (dryRun.state !== "HALT") {
    console.log(`  ${FAIL} ${label} dry-run FAULT: ${dryRun.exception || "unknown"}`);
    failed++;
    return null;
  }
  console.log(`  ${INFO} ${label} dry-run OK (gas=${dryRun.gasconsumed})`);

  // 2. Build transaction
  const currentHeight = await rpcClient.getBlockCount();
  const tx = new Neon.tx.Transaction({
    signers: [
      {
        account: account.scriptHash,
        scopes: Neon.tx.WitnessScope.CalledByEntry,
      },
    ],
    validUntilBlock: currentHeight + 100,
    script: scriptHex,
  });

  // 3. Fees
  const rawSystemFee = Number(dryRun.gasconsumed);
  tx.systemFee = Neon.u.BigInteger.fromNumber(Math.ceil(rawSystemFee * 1.1));
  tx.networkFee = Neon.u.BigInteger.fromNumber(5000000); // 0.05 GAS

  // 4. Sign
  tx.sign(account, NETWORK_MAGIC);

  // 5. Send
  let result;
  try {
    result = await rpcClient.sendRawTransaction(tx);
  } catch (e) {
    console.log(`  ${FAIL} ${label} send failed: ${e.message || e}`);
    failed++;
    return null;
  }
  const txHash = result.hash || result;
  console.log(`  ${INFO} ${label} sent: ${txHash}`);

  // 6. Wait for confirmation
  const appLog = await waitForTx(txHash);
  if (!appLog) {
    console.log(`  ${FAIL} ${label} TX timeout`);
    failed++;
    return null;
  }

  const vmState = appLog.executions?.[0]?.vmstate;
  if (vmState !== "HALT") {
    console.log(`  ${FAIL} ${label} VM state: ${vmState}`);
    console.log(`    Exception: ${appLog.executions?.[0]?.exception}`);
    failed++;
    return null;
  }

  console.log(`  ${PASS} ${label} confirmed (HALT)`);
  passed++;
  return appLog;
}

/** Top up Key1 from Key2 if GAS is below threshold. */
async function ensureKey1Gas(minGas = 2) {
  const bal = await getGasBalance(key1.address);
  if (bal < minGas) {
    console.log(`  ⚠️  Key1 GAS low (${bal.toFixed(4)}) — topping up 10 GAS from Key2...`);
    const sc = Neon.sc;
    const topUpScript = sc.createScript({
      scriptHash: GAS_HASH,
      operation: "transfer",
      args: [
        sc.ContractParam.hash160(key2.scriptHash),
        sc.ContractParam.hash160(key1.scriptHash),
        sc.ContractParam.integer(1000000000), // 10 GAS
        sc.ContractParam.any(null),
      ],
    });
    await sendTx(key2, topUpScript, "MidTestTopUp");
  }
}

/** Build GAS transfer script to create an envelope via onNEP17Payment. */
function buildCreateEnvelopeScript(sender, amount, packetCount, expiryMs, message, minNeo, minHoldSec, envelopeType) {
  const sc = Neon.sc;
  return sc.createScript({
    scriptHash: GAS_HASH,
    operation: "transfer",
    args: [
      sc.ContractParam.hash160(sender.scriptHash),
      sc.ContractParam.hash160(CONTRACT.replace("0x", "")),
      sc.ContractParam.integer(amount),
      sc.ContractParam.array(
        sc.ContractParam.integer(packetCount),
        sc.ContractParam.integer(expiryMs),
        sc.ContractParam.string(message),
        sc.ContractParam.integer(minNeo),
        sc.ContractParam.integer(minHoldSec),
        sc.ContractParam.integer(envelopeType),
      ),
    ],
  });
}

/** Build contract invoke script. */
function buildInvokeScript(operation, args) {
  const sc = Neon.sc;
  return sc.createScript({
    scriptHash: CONTRACT,
    operation,
    args,
  });
}

/** Extract envelope ID from EnvelopeCreated notification in app log. */
function extractEnvelopeId(appLog, typeFilter = null) {
  const notifications = appLog.executions?.[0]?.notifications || [];
  for (const n of notifications) {
    if (n.eventname === "EnvelopeCreated") {
      const vals = n.state?.value;
      if (!vals) continue;
      const envType = vals[4] ? Number(vals[4].value) : null;
      // If typeFilter specified, only match that type
      if (typeFilter !== null && envType !== typeFilter) continue;
      return Number(vals[0].value);
    }
  }
  return null;
}

/** Extract all notification names from app log. */
function listNotifications(appLog) {
  const notifications = appLog.executions?.[0]?.notifications || [];
  return notifications.map((n) => n.eventname);
}

// ─────────────────────────────────────────────────────────────
// Main test sequence
// ─────────────────────────────────────────────────────────────

async function main() {
  requireSignerKeys("node scripts/test-e2e.js");
  console.log("═══════════════════════════════════════════");
  console.log("  Red Envelope — End-to-End Logic Test");
  console.log("═══════════════════════════════════════════");
  console.log(`  Network:  ${NETWORK}`);
  console.log(`  Contract: ${CONTRACT}`);
  console.log(`  Key1:     ${key1.address} (${key1.scriptHash})`);
  console.log(`  Key2:     ${key2.address} (${key2.scriptHash})`);
  console.log("───────────────────────────────────────────\n");

  const sc = Neon.sc;

  // ── 0. Pre-flight ──
  console.log("[0] Pre-flight checks");
  const gas1 = await getGasBalance(key1.address);
  const gas2 = await getGasBalance(key2.address);
  console.log(`  Key1 GAS: ${gas1.toFixed(4)}`);
  console.log(`  Key2 GAS: ${gas2.toFixed(4)}`);
  check("Key2 has enough GAS (>5)", gas2 > 5);

  // Auto top-up Key1 if low on GAS (needs ~0.5 GAS per TX)
  if (gas1 < 3) {
    console.log("  ⚠️  Key1 GAS low — topping up 5 GAS from Key2...");
    const topUpScript = sc.createScript({
      scriptHash: GAS_HASH,
      operation: "transfer",
      args: [
        sc.ContractParam.hash160(key2.scriptHash),
        sc.ContractParam.hash160(key1.scriptHash),
        sc.ContractParam.integer(1500000000), // 15 GAS
        sc.ContractParam.any(null),
      ],
    });
    await sendTx(key2, topUpScript, "TopUpKey1");
  }

  const envBefore = Number((await invokeRead("getTotalEnvelopes")).stack?.[0]?.value ?? 0);
  console.log(`  Total envelopes before: ${envBefore}`);

  // ── Test 1: Admin Functions (Key1 is owner) ──
  console.log("\n[1/12] Admin Functions (Key1 = owner)");
  {
    // Verify isOwner
    const ownerRes = await invokeRead("isOwner");
    check("isOwner() callable", ownerRes.state === "HALT");

    const getOwnerRes = await invokeRead("getOwner");
    if (getOwnerRes.stack?.[0]?.value) {
      const ownerHex = Buffer.from(getOwnerRes.stack[0].value, "base64").toString("hex");
      const ownerReversed = Neon.u.reverseHex(ownerHex);
      const isKey1 = ownerHex === key1.scriptHash || ownerReversed === key1.scriptHash;
      check("Owner = Key1", isKey1);
    }

    // Test pause
    const pauseScript = buildInvokeScript("pause", []);
    const pauseLog = await sendTx(key1, pauseScript, "Pause");
    if (pauseLog) {
      const isPaused = await invokeRead("isPaused");
      check("Contract paused", isPaused.stack?.[0]?.value === true);
    }

    // Test resume
    const resumeScript = buildInvokeScript("resume", []);
    const resumeLog = await sendTx(key1, resumeScript, "Resume");
    if (resumeLog) {
      const isPaused2 = await invokeRead("isPaused");
      check("Contract resumed", isPaused2.stack?.[0]?.value === false);
    }
  }

  // ── Test 2: Owner status sanity check ──
  console.log("\n[2/12] Owner Status Check");
  {
    const ownerRes = await invokeRead("getOwner");
    if (ownerRes.stack?.[0]?.value) {
      const ownerHex = Buffer.from(ownerRes.stack[0].value, "base64").toString("hex");
      const ownerReversed = Neon.u.reverseHex(ownerHex);
      const isKey1 = ownerHex === key1.scriptHash || ownerReversed === key1.scriptHash;
      check("Key1 is owner", isKey1);
    } else {
      check("Key1 is owner", false, "getOwner returned empty");
    }
  }

  // ── Test 3: Create Spreading Envelope (Key2, 1 GAS, 1 packet) ──
  console.log("\n[3/12] Create Spreading Envelope");
  const spreadScript = buildCreateEnvelopeScript(
    key2,
    100000000, // 1 GAS
    1, // 1 packet
    600000, // 10 min expiry
    "E2E spreading test",
    0, // no NEO gate
    0, // no hold gate
    0, // type: spreading
  );
  const spreadLog = await sendTx(key2, spreadScript, "CreateSpreading");
  let spreadId = null;
  if (spreadLog) {
    spreadId = extractEnvelopeId(spreadLog);
    check("Envelope ID assigned", spreadId !== null, `id=${spreadId}`);
    console.log(`  Events: ${listNotifications(spreadLog).join(", ")}`);

    // Verify state
    const state = await getEnvelopeState(spreadId);
    if (state) {
      check("Type = spreading (0)", state.envelopeType === 0);
      check("Active = true", state.active === true || state.active === "true");
      check("PacketCount = 1", state.packetCount === 1);
      check("TotalAmount = 1 GAS", state.totalAmount === 100000000);
      check("RemainingAmount = 1 GAS", state.remainingAmount === 100000000);
      check("OpenedCount = 0", state.openedCount === 0);
    }
  }

  // ── Test 2: Open Spreading Envelope (Key2 is holder) ──
  console.log("\n[4/12] Open Spreading Envelope");
  if (spreadId) {
    const openScript = buildInvokeScript("openEnvelope", [
      sc.ContractParam.integer(spreadId),
      sc.ContractParam.hash160(key2.scriptHash),
    ]);
    const openLog = await sendTx(key2, openScript, "OpenSpreading");
    if (openLog) {
      console.log(`  Events: ${listNotifications(openLog).join(", ")}`);

      // Verify state after open
      const state2 = await getEnvelopeState(spreadId);
      if (state2) {
        check("OpenedCount = 1", state2.openedCount === 1);
        check("RemainingAmount = 0", state2.remainingAmount === 0);
        check("Active = false (depleted)", state2.active === false || state2.active === "false");
      }

      // Verify hasOpened
      const hoRes = await invokeRead("hasOpened", [
        { type: "Integer", value: String(spreadId) },
        { type: "Hash160", value: key2.scriptHash },
      ]);
      check("hasOpened(key2) = true", hoRes.stack?.[0]?.value === true);

      // Verify getOpenedAmount
      const oaRes = await invokeRead("getOpenedAmount", [
        { type: "Integer", value: String(spreadId) },
        { type: "Hash160", value: key2.scriptHash },
      ]);
      const openedAmt = Number(oaRes.stack?.[0]?.value ?? 0);
      check("getOpenedAmount = 1 GAS", openedAmt === 100000000, `${(openedAmt / 1e8).toFixed(4)} GAS`);

      // Even after depletion, NFT should still be transferable.
      const transferAfterOpenScript = buildInvokeScript("transferEnvelope", [
        sc.ContractParam.integer(spreadId),
        sc.ContractParam.hash160(key2.scriptHash),
        sc.ContractParam.hash160(key1.scriptHash),
        sc.ContractParam.any(null),
      ]);
      const transferAfterOpenLog = await sendTx(key2, transferAfterOpenScript, "TransferDepletedSpreading");
      if (transferAfterOpenLog) {
        console.log(`  Events: ${listNotifications(transferAfterOpenLog).join(", ")}`);
        check("Depleted spreading NFT remains transferable", true);
      }
    }
  } else {
    console.log("  ⚠️  Skipped — no spreading envelope created");
  }

  // ── Test 3: Create Pool Envelope (Key2, 2 GAS, 3 packets) ──
  console.log("\n[5/12] Create Pool Envelope");
  const poolScript = buildCreateEnvelopeScript(
    key2,
    200000000, // 2 GAS
    3, // 3 packets
    600000, // 10 min expiry
    "E2E pool test",
    0, // no NEO gate
    0, // no hold gate
    1, // type: pool
  );
  const poolLog = await sendTx(key2, poolScript, "CreatePool");
  let poolId = null;
  if (poolLog) {
    poolId = extractEnvelopeId(poolLog);
    check("Pool ID assigned", poolId !== null, `id=${poolId}`);
    console.log(`  Events: ${listNotifications(poolLog).join(", ")}`);

    const pState = await getEnvelopeState(poolId);
    if (pState) {
      check("Type = pool (1)", pState.envelopeType === 1);
      check("Active = true", pState.active === true || pState.active === "true");
      check("PacketCount = 3", pState.packetCount === 3);
      check("TotalAmount = 2 GAS", pState.totalAmount === 200000000);
      check("RemainingAmount = 2 GAS", pState.remainingAmount === 200000000);
    }
  }

  // ── Test 4: Claim from Pool (Key1) ──
  console.log("\n[6/12] Claim from Pool (Key1)");
  await ensureKey1Gas();
  let claimId1 = null;
  if (poolId) {
    const claimScript = buildInvokeScript("claimFromPool", [
      sc.ContractParam.integer(poolId),
      sc.ContractParam.hash160(key1.scriptHash),
    ]);
    const claimLog = await sendTx(key1, claimScript, "ClaimFromPool(key1)");
    if (claimLog) {
      console.log(`  Events: ${listNotifications(claimLog).join(", ")}`);

      // Extract claim NFT ID (type=2) from EnvelopeCreated notification
      claimId1 = extractEnvelopeId(claimLog, 2);
      check("Claim NFT minted", claimId1 !== null, `claimId=${claimId1}`);

      // Verify pool state updated
      const pState2 = await getEnvelopeState(poolId);
      if (pState2) {
        check("Pool openedCount = 1", pState2.openedCount === 1);
        check(
          "Pool remaining < 2 GAS",
          pState2.remainingAmount < 200000000,
          `${(pState2.remainingAmount / 1e8).toFixed(4)} GAS`,
        );
      }

      // Verify hasClaimedFromPool
      const hcRes = await invokeRead("hasClaimedFromPool", [
        { type: "Integer", value: String(poolId) },
        { type: "Hash160", value: key1.scriptHash },
      ]);
      check("hasClaimedFromPool(key1) = true", hcRes.stack?.[0]?.value === true);
    }
  } else {
    console.log("  ⚠️  Skipped — no pool created");
  }

  // ── Test 5: Open Claim NFT (Key1) ──
  console.log("\n[7/12] Open Claim NFT (Key1)");
  await ensureKey1Gas();
  if (claimId1) {
    const openClaimScript = buildInvokeScript("openClaim", [
      sc.ContractParam.integer(claimId1),
      sc.ContractParam.hash160(key1.scriptHash),
    ]);
    const ocLog = await sendTx(key1, openClaimScript, "OpenClaim(key1)");
    if (ocLog) {
      console.log(`  Events: ${listNotifications(ocLog).join(", ")}`);

      // Verify claim state
      const cState = await invokeRead("getClaimState", [{ type: "Integer", value: String(claimId1) }]);
      if (cState.state === "HALT" && cState.stack?.[0]) {
        const claim = parseMap(cState.stack[0]);
        if (claim) {
          check("Claim opened = true", claim.opened === true || claim.opened === "true" || claim.opened === 1);
          check("Claim amount > 0", (claim.amount || 0) > 0, `${((claim.amount || 0) / 1e8).toFixed(4)} GAS`);
        }
      }
    }
  } else {
    console.log("  ⚠️  Skipped — no claim NFT");
  }

  // ── Test 6: Claim from Pool (Key2 — creator claims own pool) ──
  console.log("\n[8/12] Claim from Pool (Key2)");
  let claimId2 = null;
  if (poolId) {
    const claimScript2 = buildInvokeScript("claimFromPool", [
      sc.ContractParam.integer(poolId),
      sc.ContractParam.hash160(key2.scriptHash),
    ]);
    const claimLog2 = await sendTx(key2, claimScript2, "ClaimFromPool(key2)");
    if (claimLog2) {
      console.log(`  Events: ${listNotifications(claimLog2).join(", ")}`);

      // Extract claim NFT ID (type=2)
      claimId2 = extractEnvelopeId(claimLog2, 2);
      check("Claim NFT minted for Key2", claimId2 !== null, `claimId=${claimId2}`);

      // Pool state after 2 claims
      const pState3 = await getEnvelopeState(poolId);
      if (pState3) {
        check("Pool openedCount = 2", pState3.openedCount === 2);
      }
    }
  } else {
    console.log("  ⚠️  Skipped (Test 6) — no pool created");
  }

  // ── Test 7: Transfer Claim NFT (Key2 → Key1), then Key1 opens it ──
  console.log("\n[9/12] Transfer Claim NFT (Key2 → Key1)");
  if (claimId2) {
    const tcScript = buildInvokeScript("transferClaim", [
      sc.ContractParam.integer(claimId2),
      sc.ContractParam.hash160(key2.scriptHash),
      sc.ContractParam.hash160(key1.scriptHash),
    ]);
    const tcLog = await sendTx(key2, tcScript, "TransferClaim");
    if (tcLog) {
      console.log(`  Events: ${listNotifications(tcLog).join(", ")}`);
      check("Claim transferred to Key1", true);

      // Key1 opens the transferred claim
      console.log("  Opening transferred claim (Key1)...");
      await ensureKey1Gas();
      const ocScript2 = buildInvokeScript("openClaim", [
        sc.ContractParam.integer(claimId2),
        sc.ContractParam.hash160(key1.scriptHash),
      ]);
      const ocLog2 = await sendTx(key1, ocScript2, "OpenTransferredClaim");
      if (ocLog2) {
        console.log(`  Events: ${listNotifications(ocLog2).join(", ")}`);
        check("Transferred claim opened by Key1", true);

        // Opened claim NFT should still be transferable.
        const transferOpenedClaimScript = buildInvokeScript("transferClaim", [
          sc.ContractParam.integer(claimId2),
          sc.ContractParam.hash160(key1.scriptHash),
          sc.ContractParam.hash160(key2.scriptHash),
        ]);
        const transferOpenedClaimLog = await sendTx(key1, transferOpenedClaimScript, "TransferOpenedClaim");
        if (transferOpenedClaimLog) {
          console.log(`  Events: ${listNotifications(transferOpenedClaimLog).join(", ")}`);
          check("Opened claim NFT remains transferable", true);
        }
      }
    }
  } else {
    console.log("  ⚠️  Skipped — no claim NFT from Key2");
  }

  // ── Test 8: Create Spreading Envelope with 2 packets, transfer to Key1 ──
  console.log("\n[10/12] Create Multi-Packet Spreading + Transfer");
  const spread2Script = buildCreateEnvelopeScript(
    key2,
    200000000, // 2 GAS
    2, // 2 packets
    600000, // 10 min expiry
    "E2E transfer test",
    0, // no NEO gate
    0, // no hold gate
    0, // type: spreading
  );
  const spread2Log = await sendTx(key2, spread2Script, "CreateSpreading2");
  let spread2Id = null;
  if (spread2Log) {
    spread2Id = extractEnvelopeId(spread2Log);
    check("Spreading2 ID assigned", spread2Id !== null, `id=${spread2Id}`);
  }

  // ── Test 9: Transfer Spreading Envelope (Key2 → Key1), Key1 opens ──
  console.log("\n[11/12] Transfer Spreading Envelope + Open");
  if (spread2Id) {
    const teScript = buildInvokeScript("transferEnvelope", [
      sc.ContractParam.integer(spread2Id),
      sc.ContractParam.hash160(key2.scriptHash),
      sc.ContractParam.hash160(key1.scriptHash),
      sc.ContractParam.any(null),
    ]);
    const teLog = await sendTx(key2, teScript, "TransferEnvelope");
    if (teLog) {
      console.log(`  Events: ${listNotifications(teLog).join(", ")}`);
      check("Envelope transferred to Key1", true);

      // Key1 opens the transferred envelope
      console.log("  Key1 opening transferred envelope...");
      await ensureKey1Gas();
      const oeScript = buildInvokeScript("openEnvelope", [
        sc.ContractParam.integer(spread2Id),
        sc.ContractParam.hash160(key1.scriptHash),
      ]);
      const oeLog = await sendTx(key1, oeScript, "OpenTransferred");
      if (oeLog) {
        console.log(`  Events: ${listNotifications(oeLog).join(", ")}`);

        const s2State = await getEnvelopeState(spread2Id);
        if (s2State) {
          check("OpenedCount = 1", s2State.openedCount === 1);
          check(
            "Remaining < 2 GAS",
            s2State.remainingAmount < 200000000,
            `${(s2State.remainingAmount / 1e8).toFixed(4)} GAS remaining`,
          );
        }
      }
    }
  } else {
    console.log("  ⚠️  Skipped — no spreading2 envelope");
  }

  // ── Test 10: Final Stats Verification ──
  console.log("\n[12/12] Final Stats Verification");
  const envAfter = Number((await invokeRead("getTotalEnvelopes")).stack?.[0]?.value ?? 0);
  const totalDist = Number((await invokeRead("getTotalDistributed")).stack?.[0]?.value ?? 0);
  const gas1After = await getGasBalance(key1.address);
  const gas2After = await getGasBalance(key2.address);

  console.log(`  Total envelopes: ${envBefore} → ${envAfter}`);
  console.log(`  Total distributed: ${(totalDist / 1e8).toFixed(4)} GAS`);
  console.log(`  Key1 GAS: ${gas1.toFixed(4)} → ${gas1After.toFixed(4)}`);
  console.log(`  Key2 GAS: ${gas2.toFixed(4)} → ${gas2After.toFixed(4)}`);

  check("Envelope count increased", envAfter > envBefore, `+${envAfter - envBefore} envelopes`);
  check("Total distributed > 0", totalDist > 0);

  // ── Summary ──
  console.log("\n═══════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════\n");

  if (failed > 0) {
    console.log("  ⚠️  Some tests failed — review output above");
  } else {
    console.log("  🎉 All tests passed!");
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
