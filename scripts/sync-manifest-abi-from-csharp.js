#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {
    source: "",
    target: "",
    injectMissingMethods: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      out.source = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--target") {
      out.target = argv[i + 1] || "";
      i += 1;
    } else if (arg === "--inject-missing-methods") {
      out.injectMissingMethods = true;
    }
  }

  return out;
}

function keyByNameAndArity(entry) {
  const params = Array.isArray(entry?.parameters) ? entry.parameters : [];
  return `${entry?.name || ""}/${params.length}`;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function alignMethodShape(targetMethod, sourceMethod) {
  let changed = 0;

  if (targetMethod.returntype !== sourceMethod.returntype) {
    targetMethod.returntype = sourceMethod.returntype;
    changed += 1;
  }

  const targetParams = Array.isArray(targetMethod.parameters) ? targetMethod.parameters : [];
  const sourceParams = Array.isArray(sourceMethod.parameters) ? sourceMethod.parameters : [];
  const count = Math.min(targetParams.length, sourceParams.length);
  for (let i = 0; i < count; i += 1) {
    if (targetParams[i].type !== sourceParams[i].type) {
      targetParams[i].type = sourceParams[i].type;
      changed += 1;
    }
    if (targetParams[i].name !== sourceParams[i].name) {
      targetParams[i].name = sourceParams[i].name;
      changed += 1;
    }
  }

  return changed;
}

function alignEventShape(targetEvent, sourceEvent) {
  let changed = 0;

  const targetParams = Array.isArray(targetEvent.parameters) ? targetEvent.parameters : [];
  const sourceParams = Array.isArray(sourceEvent.parameters) ? sourceEvent.parameters : [];
  const count = Math.min(targetParams.length, sourceParams.length);
  for (let i = 0; i < count; i += 1) {
    if (targetParams[i].type !== sourceParams[i].type) {
      targetParams[i].type = sourceParams[i].type;
      changed += 1;
    }
    if (targetParams[i].name !== sourceParams[i].name) {
      targetParams[i].name = sourceParams[i].name;
      changed += 1;
    }
  }

  return changed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.source || !args.target) {
    console.error(
      "Usage: node scripts/sync-manifest-abi-from-csharp.js --source <csharp-manifest> --target <target-manifest> [--inject-missing-methods]",
    );
    process.exit(1);
  }

  const sourcePath = path.resolve(args.source);
  const targetPath = path.resolve(args.target);
  if (!fs.existsSync(sourcePath)) {
    console.error(`Source manifest not found: ${sourcePath}`);
    process.exit(1);
  }
  if (!fs.existsSync(targetPath)) {
    console.error(`Target manifest not found: ${targetPath}`);
    process.exit(1);
  }

  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));

  const sourceMethods = Array.isArray(source?.abi?.methods) ? source.abi.methods : [];
  const targetMethods = Array.isArray(target?.abi?.methods) ? target.abi.methods : [];
  const sourceMethodMap = new Map(sourceMethods.map((m) => [keyByNameAndArity(m), m]));

  let methodChanges = 0;
  for (const method of targetMethods) {
    const key = keyByNameAndArity(method);
    const sourceMethod = sourceMethodMap.get(key);
    if (!sourceMethod) {
      continue;
    }
    methodChanges += alignMethodShape(method, sourceMethod);
  }

  let addedMethods = 0;
  if (args.injectMissingMethods) {
    const targetKeySet = new Set(targetMethods.map((m) => keyByNameAndArity(m)));
    for (const sourceMethod of sourceMethods) {
      const key = keyByNameAndArity(sourceMethod);
      if (targetKeySet.has(key)) {
        continue;
      }
      targetMethods.push(deepClone(sourceMethod));
      targetKeySet.add(key);
      addedMethods += 1;
    }
  }

  const sourceEvents = Array.isArray(source?.abi?.events) ? source.abi.events : [];
  const targetEvents = Array.isArray(target?.abi?.events) ? target.abi.events : [];
  const sourceEventMap = new Map(sourceEvents.map((e) => [keyByNameAndArity(e), e]));

  let eventChanges = 0;
  for (const event of targetEvents) {
    const key = keyByNameAndArity(event);
    const sourceEvent = sourceEventMap.get(key);
    if (!sourceEvent) {
      continue;
    }
    eventChanges += alignEventShape(event, sourceEvent);
  }

  let standardsChanged = 0;
  const sourceStandards = Array.isArray(source.supportedstandards) ? source.supportedstandards : [];
  const targetStandards = Array.isArray(target.supportedstandards) ? target.supportedstandards : [];
  if (JSON.stringify(sourceStandards) !== JSON.stringify(targetStandards)) {
    target.supportedstandards = deepClone(sourceStandards);
    standardsChanged = 1;
  }

  fs.writeFileSync(targetPath, `${JSON.stringify(target, null, 2)}\n`);

  console.log(
    `Synced manifest ABI from C#: target=${targetPath}, methodChanges=${methodChanges}, eventChanges=${eventChanges}, standardsChanged=${standardsChanged}, addedMethods=${addedMethods}`,
  );
}

main();
