#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const PATHS = {
  csharp: path.resolve(ROOT, "contracts/bin/sc/RedEnvelope.manifest.json"),
  solidity: path.resolve(ROOT, "contracts-solidity/build/RedEnvelope.manifest.json"),
  rust: path.resolve(ROOT, "contracts-rust/red-envelope-neo/build/RedEnvelopeRust.manifest.json"),
};

function loadJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`manifest not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function key(entry) {
  const params = Array.isArray(entry?.parameters) ? entry.parameters : [];
  return `${entry?.name || ""}/${params.length}`;
}

function signature(entry) {
  const params = Array.isArray(entry?.parameters) ? entry.parameters.map((p) => p.type).join(",") : "";
  return `${key(entry)}(${params})->${entry?.returntype || ""}`;
}

function eventSignature(entry) {
  const params = Array.isArray(entry?.parameters) ? entry.parameters.map((p) => p.type).join(",") : "";
  return `${key(entry)}(${params})`;
}

function compareByAbiSurface(reference, candidate, label, kind, options = {}) {
  const failures = [];
  const refEntries = Array.isArray(reference) ? reference : [];
  const candEntries = Array.isArray(candidate) ? candidate : [];
  const allowMissing = options.allowMissing || new Set();

  const candMap = new Map(candEntries.map((x) => [key(x), x]));
  for (const ref of refEntries) {
    const k = key(ref);
    const got = candMap.get(k);
    if (!got) {
      if (!allowMissing.has(k)) {
        failures.push(`${kind}: missing in ${label}: ${signature(ref)}`);
      }
      continue;
    }

    if (kind === "method") {
      const refSig = signature(ref);
      const gotSig = signature(got);
      if (refSig !== gotSig) {
        failures.push(`${kind}: mismatch in ${label}: expected ${refSig}, got ${gotSig}`);
      }
    } else {
      const refSig = eventSignature(ref);
      const gotSig = eventSignature(got);
      if (refSig !== gotSig) {
        failures.push(`${kind}: mismatch in ${label}: expected ${refSig}, got ${gotSig}`);
      }
    }
  }

  const refKeySet = new Set(refEntries.map((x) => key(x)));
  for (const cand of candEntries) {
    const k = key(cand);
    if (!refKeySet.has(k)) {
      if (kind === "method") {
        failures.push(`${kind}: extra in ${label}: ${signature(cand)}`);
      } else {
        failures.push(`${kind}: extra in ${label}: ${eventSignature(cand)}`);
      }
    }
  }

  return failures;
}

function compareStandards(reference, candidate, label) {
  const a = (reference || []).slice().sort();
  const b = (candidate || []).slice().sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    return [`supportedstandards mismatch in ${label}: expected ${JSON.stringify(a)}, got ${JSON.stringify(b)}`];
  }
  return [];
}

function main() {
  const csharp = loadJson(PATHS.csharp);
  const solidity = loadJson(PATHS.solidity);
  const rust = loadJson(PATHS.rust);

  const failures = [];

  failures.push(
    ...compareByAbiSurface(csharp.abi?.methods, solidity.abi?.methods, "solidity", "method"),
    ...compareByAbiSurface(csharp.abi?.events, solidity.abi?.events, "solidity", "event"),
    ...compareStandards(csharp.supportedstandards, solidity.supportedstandards, "solidity"),
  );

  failures.push(
    ...compareByAbiSurface(csharp.abi?.methods, rust.abi?.methods, "rust", "method", {
      allowMissing: new Set(["_deploy/2"]),
    }),
    ...compareByAbiSurface(csharp.abi?.events, rust.abi?.events, "rust", "event"),
    ...compareStandards(csharp.supportedstandards, rust.supportedstandards, "rust"),
  );

  if (failures.length > 0) {
    console.error("Local manifest parity check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log("Local manifest parity check passed (C# == Solidity == Rust ABI surface)");
}

main();
