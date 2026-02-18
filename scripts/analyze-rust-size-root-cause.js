#!/usr/bin/env node

/**
 * Deep root-cause analysis for Rust Neo N3 contract size.
 *
 * What it measures:
 * 1) Current optimized contract artifacts in this repo.
 * 2) Same contract compiled with default release profile (without custom size opts).
 * 3) Same ABI surface, empty business logic (stub contract).
 * 4) Minimal contract baseline.
 * 5) Same optimized WASM translated by clean upstream neo-llvm toolchain.
 * 6) (Optional) same optimized WASM after `wasm-opt -Oz`.
 *
 * Usage:
 *   node scripts/analyze-rust-size-root-cause.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const Neon = require("@cityofzion/neon-js");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_DIR = path.resolve(ROOT, "contracts-rust/red-envelope-neo");
const TOOLCHAIN_DIR = path.resolve(ROOT, ".toolchains/neo-llvm");
const CURRENT_ARTIFACTS = {
  wasm: path.resolve(CONTRACT_DIR, "target/wasm32-unknown-unknown/release/red_envelope_neo_rust.wasm"),
  nef: path.resolve(CONTRACT_DIR, "build/RedEnvelopeRust.nef"),
  manifest: path.resolve(CONTRACT_DIR, "build/RedEnvelopeRust.manifest.json"),
};
const OVERLAY_PATH = path.resolve(CONTRACT_DIR, "manifest.overlay.json");

function run(cmd, args, options = {}) {
  const proc = cp.spawnSync(cmd, args, {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (proc.status !== 0) {
    const out = [proc.stdout || "", proc.stderr || ""].filter(Boolean).join("\n");
    throw new Error(`command failed: ${cmd} ${args.join(" ")}\n${out}`.trim());
  }
  return (proc.stdout || "").trim();
}

function commandExists(cmd, args = ["--version"]) {
  const proc = cp.spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  return proc.status === 0;
}

function fileSize(filePath) {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : null;
}

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function nefScriptBytes(nefPath) {
  const nef = Neon.sc.NEF.fromBuffer(fs.readFileSync(nefPath));
  return Math.floor((nef.script || "").length / 2);
}

function ensureFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
}

function collectArtifactMetrics(label, paths) {
  ensureFile(paths.wasm, `${label} wasm`);
  ensureFile(paths.nef, `${label} nef`);
  ensureFile(paths.manifest, `${label} manifest`);

  return {
    label,
    paths,
    wasmBytes: fileSize(paths.wasm),
    nefBytes: fileSize(paths.nef),
    manifestBytes: fileSize(paths.manifest),
    nefScriptBytes: nefScriptBytes(paths.nef),
    wasmSha256: sha256(paths.wasm),
    nefSha256: sha256(paths.nef),
    manifestSha256: sha256(paths.manifest),
  };
}

function pctDelta(base, value) {
  if (!Number.isFinite(base) || base === 0 || !Number.isFinite(value)) return null;
  return Number((((value - base) / base) * 100).toFixed(2));
}

function copyDir(srcDir, dstDir) {
  fs.cpSync(srcDir, dstDir, { recursive: true });
}

function removeReleaseProfile(cargoTomlPath) {
  const lines = fs.readFileSync(cargoTomlPath, "utf8").split(/\r?\n/);
  const out = [];
  let inReleaseProfile = false;

  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (section) {
      const sectionName = section[1].trim();
      if (sectionName === "profile.release") {
        inReleaseProfile = true;
        continue;
      }
      inReleaseProfile = false;
    }
    if (!inReleaseProfile) {
      out.push(line);
    }
  }

  fs.writeFileSync(cargoTomlPath, `${out.join("\n").trim()}\n`);
}

function rustBuild(contractDir) {
  run("rustup", ["target", "add", "wasm32-unknown-unknown"]);
  run("cargo", ["build", "--manifest-path", path.resolve(contractDir, "Cargo.toml"), "--release", "--target", "wasm32-unknown-unknown"]);
}

function translateWithToolchain(toolchainDir, wasmPath, nefPath, manifestPath, name, overlayPath = null) {
  const args = [
    "run",
    "--manifest-path",
    path.resolve(toolchainDir, "wasm-neovm/Cargo.toml"),
    "--",
    "--input",
    wasmPath,
    "--nef",
    nefPath,
    "--manifest",
    manifestPath,
    "--name",
    name,
  ];
  if (overlayPath) {
    args.push("--manifest-overlay", overlayPath);
  }
  run("cargo", args);
}

function createMinimalContract(tempDir) {
  fs.mkdirSync(path.resolve(tempDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.resolve(tempDir, "Cargo.toml"),
    `[package]
name = "neo-rust-size-probe-mini"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
neo-devpack = { git = "https://github.com/r3e-network/neo-llvm.git", package = "neo-devpack", default-features = false }

[workspace]

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = "symbols"
`,
  );

  fs.writeFileSync(
    path.resolve(tempDir, "src/lib.rs"),
    `use neo_devpack::prelude::*;

neo_manifest_overlay!(
    r#"{
  "name": "SizeProbeMini",
  "features": { "storage": false },
  "supportedstandards": []
}"#
);

#[neo_contract]
pub struct SizeProbeMini;

#[neo_contract]
impl SizeProbeMini {
    #[neo_method(name = "ping")]
    pub fn ping() -> i64 {
        1
    }
}
`,
  );
}

function extractRustMethodsFromSource(sourceCode) {
  const re = /#\[neo_method\(name = "([^"]+)"\)\]\s*pub fn\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*(?:->\s*([^\{\n]+))?\s*\{/g;
  const methods = [];
  let m;

  while ((m = re.exec(sourceCode)) !== null) {
    methods.push({
      exportName: m[1],
      functionName: m[2],
      args: (m[3] || "").trim(),
      returnType: (m[4] || "").trim(),
    });
  }
  return methods;
}

function listRustSourceFiles(rootDir) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const dir = queue.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && full.endsWith(".rs")) {
        files.push(full);
      }
    }
  }

  files.sort();
  return files;
}

function createStubSurfaceContract(tempDir, sourceDir) {
  fs.mkdirSync(path.resolve(tempDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.resolve(tempDir, "Cargo.toml"),
    `[package]
name = "neo-rust-size-probe-stub"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
neo-devpack = { git = "https://github.com/r3e-network/neo-llvm.git", package = "neo-devpack", default-features = false }

[workspace]

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
panic = "abort"
strip = "symbols"
`,
  );

  const methodFiles = listRustSourceFiles(sourceDir);
  const methods = [];
  const seen = new Set();

  for (const methodFile of methodFiles) {
    const source = fs.readFileSync(methodFile, "utf8");
    for (const method of extractRustMethodsFromSource(source)) {
      const key = `${method.exportName}::${method.functionName}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      methods.push(method);
    }
  }

  if (methods.length === 0) {
    throw new Error(
      `failed to parse neo_method entries from Rust contract sources under: ${sourceDir}`,
    );
  }

  const lines = [];
  lines.push("use neo_devpack::prelude::*;");
  lines.push("");
  lines.push("neo_manifest_overlay!(");
  lines.push("    r#\"{");
  lines.push('  "name": "RedEnvelopeRust",');
  lines.push('  "features": { "storage": true },');
  lines.push('  "supportedstandards": ["NEP-11"]');
  lines.push("}\"#");
  lines.push(");");
  lines.push("");
  lines.push("#[neo_contract]");
  lines.push("pub struct RedEnvelopeRustContract;");
  lines.push("");
  lines.push("#[neo_contract]");
  lines.push("impl RedEnvelopeRustContract {");

  for (const method of methods) {
    const ret = method.returnType;
    let body = "";
    if (!ret) {
      body = "";
    } else if (ret === "bool") {
      body = "        false";
    } else if (ret === "i64") {
      body = "        0";
    } else {
      body = "        0";
    }

    lines.push(`    #[neo_method(name = "${method.exportName}")]`);
    lines.push(
      `    pub fn ${method.functionName}(${method.args})${ret ? ` -> ${ret}` : ""} {`,
    );
    if (body) lines.push(body);
    lines.push("    }");
    lines.push("");
  }
  lines.push("}");
  lines.push("");

  fs.writeFileSync(path.resolve(tempDir, "src/lib.rs"), lines.join("\n"));
}

function cloneCleanToolchain(cleanDir) {
  run("git", ["clone", "--depth", "1", "https://github.com/r3e-network/neo-llvm.git", cleanDir], { cwd: path.dirname(cleanDir) });
}

function reportComparison(name, base, target) {
  return {
    name,
    wasmBytesDelta: target.wasmBytes - base.wasmBytes,
    wasmBytesDeltaPct: pctDelta(base.wasmBytes, target.wasmBytes),
    nefBytesDelta: target.nefBytes - base.nefBytes,
    nefBytesDeltaPct: pctDelta(base.nefBytes, target.nefBytes),
    manifestBytesDelta: target.manifestBytes - base.manifestBytes,
    manifestBytesDeltaPct: pctDelta(base.manifestBytes, target.manifestBytes),
    nefScriptBytesDelta: target.nefScriptBytes - base.nefScriptBytes,
    nefScriptBytesDeltaPct: pctDelta(base.nefScriptBytes, target.nefScriptBytes),
  };
}

function main() {
  ensureFile(CURRENT_ARTIFACTS.wasm, "current wasm");
  ensureFile(CURRENT_ARTIFACTS.nef, "current nef");
  ensureFile(CURRENT_ARTIFACTS.manifest, "current manifest");
  ensureFile(OVERLAY_PATH, "manifest overlay");
  if (!fs.existsSync(TOOLCHAIN_DIR)) {
    throw new Error(`neo-llvm toolchain dir not found: ${TOOLCHAIN_DIR}`);
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "red-envelope-rust-size-"));

  const optimized = collectArtifactMetrics("optimized_current", CURRENT_ARTIFACTS);
  let wasmOpt = null;
  if (commandExists("wasm-opt")) {
    const wasmOptArtifacts = {
      wasm: path.resolve(workspace, "red_envelope_neo_rust.oz.wasm"),
      nef: path.resolve(workspace, "RedEnvelopeRust.oz.nef"),
      manifest: path.resolve(workspace, "RedEnvelopeRust.oz.manifest.json"),
    };
    run("wasm-opt", ["-Oz", CURRENT_ARTIFACTS.wasm, "-o", wasmOptArtifacts.wasm]);
    translateWithToolchain(
      TOOLCHAIN_DIR,
      wasmOptArtifacts.wasm,
      wasmOptArtifacts.nef,
      wasmOptArtifacts.manifest,
      "RedEnvelopeRust",
      OVERLAY_PATH,
    );
    wasmOpt = collectArtifactMetrics("optimized_wasm_opt_oz", wasmOptArtifacts);
  }

  const defaultProfileDir = path.resolve(workspace, "default-profile");
  copyDir(CONTRACT_DIR, defaultProfileDir);
  removeReleaseProfile(path.resolve(defaultProfileDir, "Cargo.toml"));
  rustBuild(defaultProfileDir);
  const defaultProfileOutDir = path.resolve(defaultProfileDir, "build-default");
  fs.mkdirSync(defaultProfileOutDir, { recursive: true });
  const defaultProfileArtifacts = {
    wasm: path.resolve(defaultProfileDir, "target/wasm32-unknown-unknown/release/red_envelope_neo_rust.wasm"),
    nef: path.resolve(defaultProfileOutDir, "RedEnvelopeRust.nef"),
    manifest: path.resolve(defaultProfileOutDir, "RedEnvelopeRust.manifest.json"),
  };
  translateWithToolchain(
    TOOLCHAIN_DIR,
    defaultProfileArtifacts.wasm,
    defaultProfileArtifacts.nef,
    defaultProfileArtifacts.manifest,
    "RedEnvelopeRust",
    path.resolve(defaultProfileDir, "manifest.overlay.json"),
  );
  const defaultProfile = collectArtifactMetrics("default_release_profile", defaultProfileArtifacts);

  const stubDir = path.resolve(workspace, "stub-surface");
  createStubSurfaceContract(stubDir, path.resolve(CONTRACT_DIR, "src"));
  rustBuild(stubDir);
  const stubArtifacts = {
    wasm: path.resolve(stubDir, "target/wasm32-unknown-unknown/release/neo_rust_size_probe_stub.wasm"),
    nef: path.resolve(stubDir, "RedEnvelopeRust.stub.nef"),
    manifest: path.resolve(stubDir, "RedEnvelopeRust.stub.manifest.json"),
  };
  translateWithToolchain(
    TOOLCHAIN_DIR,
    stubArtifacts.wasm,
    stubArtifacts.nef,
    stubArtifacts.manifest,
    "RedEnvelopeRust",
    OVERLAY_PATH,
  );
  const stubSurface = collectArtifactMetrics("stub_same_abi_surface", stubArtifacts);

  const minimalDir = path.resolve(workspace, "minimal");
  createMinimalContract(minimalDir);
  rustBuild(minimalDir);
  const minimalArtifacts = {
    wasm: path.resolve(minimalDir, "target/wasm32-unknown-unknown/release/neo_rust_size_probe_mini.wasm"),
    nef: path.resolve(minimalDir, "SizeProbeMini.nef"),
    manifest: path.resolve(minimalDir, "SizeProbeMini.manifest.json"),
  };
  translateWithToolchain(
    TOOLCHAIN_DIR,
    minimalArtifacts.wasm,
    minimalArtifacts.nef,
    minimalArtifacts.manifest,
    "SizeProbeMini",
  );
  const minimal = collectArtifactMetrics("minimal_contract", minimalArtifacts);

  const cleanToolchainDir = path.resolve(workspace, "neo-llvm-clean");
  cloneCleanToolchain(cleanToolchainDir);
  const cleanTranslationArtifacts = {
    wasm: CURRENT_ARTIFACTS.wasm,
    nef: path.resolve(workspace, "RedEnvelopeRust.clean.nef"),
    manifest: path.resolve(workspace, "RedEnvelopeRust.clean.manifest.json"),
  };
  translateWithToolchain(
    cleanToolchainDir,
    cleanTranslationArtifacts.wasm,
    cleanTranslationArtifacts.nef,
    cleanTranslationArtifacts.manifest,
    "RedEnvelopeRust",
    OVERLAY_PATH,
  );
  const cleanTranslation = collectArtifactMetrics("clean_upstream_toolchain_translation", cleanTranslationArtifacts);

  const report = {
    generatedAt: new Date().toISOString(),
    workspace,
    experiments: {
      optimized,
      wasmOpt,
      defaultProfile,
      stubSurface,
      minimal,
      cleanTranslation,
    },
    comparisons: {
      wasmOptVsOptimized: wasmOpt
        ? reportComparison("wasm_opt_vs_optimized", optimized, wasmOpt)
        : null,
      defaultVsOptimized: reportComparison("default_vs_optimized", optimized, defaultProfile),
      stubVsOptimized: reportComparison("stub_vs_optimized", optimized, stubSurface),
      minimalVsOptimized: reportComparison("minimal_vs_optimized", optimized, minimal),
      cleanToolchainVsOptimized: reportComparison("clean_toolchain_vs_optimized", optimized, cleanTranslation),
    },
    derived: {
      optimizedNefToWasmRatio: Number((optimized.nefBytes / optimized.wasmBytes).toFixed(4)),
      optimizedNefScriptToWasmRatio: Number((optimized.nefScriptBytes / optimized.wasmBytes).toFixed(4)),
      businessLogicNefBytesApprox: optimized.nefBytes - stubSurface.nefBytes,
      compilerProfileSavingsNefBytes: defaultProfile.nefBytes - optimized.nefBytes,
      compilerProfileSavingsWasmBytes: defaultProfile.wasmBytes - optimized.wasmBytes,
      wasmOptSavingsNefBytes: wasmOpt ? optimized.nefBytes - wasmOpt.nefBytes : null,
      wasmOptSavingsWasmBytes: wasmOpt ? optimized.wasmBytes - wasmOpt.wasmBytes : null,
      cleanToolchainNefByteDelta: cleanTranslation.nefBytes - optimized.nefBytes,
      cleanToolchainManifestByteDelta: cleanTranslation.manifestBytes - optimized.manifestBytes,
      cleanToolchainSameManifestHash:
        cleanTranslation.manifestSha256 === optimized.manifestSha256,
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

try {
  main();
} catch (err) {
  console.error("ERROR:", err && err.message ? err.message : err);
  process.exit(1);
}
