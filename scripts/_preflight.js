/**
 * Pre-flight check — verify account states and script building before E2E test.
 */
const { Neon, rpcClient, CONTRACT, GAS_HASH, key1, key2, NETWORK_MAGIC } = require("./helpers");

async function main() {
  const neoHash = "0xef4073a0f2b305a38ec4050e4d3d28bc40ea63f5";

  // 1. NEO account state for Key2
  const stateRes = await rpcClient.invokeFunction(neoHash, "getAccountState", [
    { type: "Hash160", value: Neon.wallet.getScriptHashFromAddress(key2.address) },
  ]);
  console.log("Key2 NEO account state:", JSON.stringify(stateRes.stack, null, 2));

  // 2. Contract paused?
  const pausedRes = await rpcClient.invokeFunction(CONTRACT, "isPaused", []);
  console.log("Contract paused:", pausedRes.stack[0]?.value);

  // 3. Owner check
  const ownerRes = await rpcClient.invokeFunction(CONTRACT, "getOwner", []);
  const stack = ownerRes?.stack;
  if (!stack || !stack[0]) {
    console.error("Failed to read contract owner");
    process.exit(1);
  }
  const ownerHex = Buffer.from(stack[0].value, "base64").toString("hex");
  console.log("Contract owner (hex):", ownerHex);
  console.log("Key1 scriptHash:", key1.scriptHash);
  console.log("Key2 scriptHash:", key2.scriptHash);
  const reversed = Neon.u.reverseHex(ownerHex);
  console.log("Key1 is owner:", ownerHex === key1.scriptHash || reversed === key1.scriptHash);
  console.log("Key2 is owner:", ownerHex === key2.scriptHash || reversed === key2.scriptHash);

  // 4. Test createScript for GAS transfer with envelope data
  const sc = Neon.sc;
  const testScript = sc.createScript({
    scriptHash: GAS_HASH,
    operation: "transfer",
    args: [
      sc.ContractParam.hash160(key2.scriptHash),
      sc.ContractParam.hash160(CONTRACT.replace("0x", "")),
      sc.ContractParam.integer(100000000), // 1 GAS
      sc.ContractParam.array(
        sc.ContractParam.integer(1), // packetCount
        sc.ContractParam.integer(60000), // expiryMs (60s)
        sc.ContractParam.string("test"), // message
        sc.ContractParam.integer(0), // minNeoRequired
        sc.ContractParam.integer(0), // minHoldSeconds
        sc.ContractParam.integer(0), // type: spreading
      ),
    ],
  });
  console.log("Script hex length:", testScript.length);

  // 5. Dry-run
  const scriptB64 = Buffer.from(testScript, "hex").toString("base64");
  const dryRun = await rpcClient.execute(
    new Neon.rpc.Query({
      method: "invokescript",
      params: [scriptB64, [{ account: key2.scriptHash, scopes: "CalledByEntry" }]],
    }),
  );
  console.log("Dry-run state:", dryRun.state);
  console.log("Dry-run gas:", dryRun.gasconsumed);
  if (dryRun.state !== "HALT") {
    console.log("Exception:", dryRun.exception);
    console.log("Stack:", JSON.stringify(dryRun.stack));
  } else {
    console.log("Stack:", JSON.stringify(dryRun.stack));
    // Check notifications for OnEnvelopeCreated
    if (dryRun.notifications) {
      for (const n of dryRun.notifications) {
        console.log("Notification:", n.eventname, JSON.stringify(n.state));
      }
    }
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
