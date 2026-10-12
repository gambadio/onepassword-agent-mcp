import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MCPB_TOOL = "@anthropic-ai/mcpb@2.1.2";
const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function json(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function copyRuntime(source, target, accept) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) throw new Error(`Bundle input must not be a symlink: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(target, { recursive: true });
    for (const name of (await fs.readdir(source)).sort()) {
      if (!name.startsWith(".")) await copyRuntime(path.join(source, name), path.join(target, name), accept);
    }
  } else if (stat.isFile() && accept(source)) {
    await fs.copyFile(source, target);
    await fs.chmod(target, 0o644);
  }
}

// An explicit runtime allowlist never visits the user's state, local node_modules,
// environment files, test fixtures, or npm configuration.
export async function prepareBundle(projectRoot, staging) {
  const pkg = await json(path.join(projectRoot, "package.json"));
  const manifest = await json(path.join(projectRoot, "manifest.json"));
  const lock = await json(path.join(projectRoot, "package-lock.json"));
  if (manifest.name !== pkg.name || manifest.version !== pkg.version || lock.version !== pkg.version
    || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error("MCPB manifest, package.json, and package-lock.json must have matching names and versions.");
  }
  if (manifest.server?.type !== "node" || manifest.server?.entry_point !== "dist/src/mcp.js"
    || manifest.server?.mcp_config?.command !== "node"
    || JSON.stringify(manifest.server?.mcp_config?.args) !== JSON.stringify(["${__dirname}/dist/src/mcp.js"])) {
    throw new Error("MCPB must run the local dist/src/mcp.js stdio entry point.");
  }
  await fs.mkdir(staging, { recursive: true });
  for (const file of ["package.json", "package-lock.json", "manifest.json", "README.md", "LICENSE"]) {
    await copyRuntime(path.join(projectRoot, file), path.join(staging, file), () => true);
  }
  await copyRuntime(path.join(projectRoot, "dist/src"), path.join(staging, "dist/src"), file => file.endsWith(".js"));
  await fs.access(path.join(staging, "dist/src/mcp.js"));
  await copyRuntime(path.join(projectRoot, "public"), path.join(staging, "public"), file => /\.(html|css|js|svg|png|ico|webp|woff2)$/.test(file));
  await fs.mkdir(path.join(staging, "native"), { recursive: true });
  for (const file of ["MenuBarApp.swift", "AppIcon.icns"]) {
    await copyRuntime(path.join(projectRoot, "native", file), path.join(staging, "native", file), () => true);
  }
  return { pkg, lock };
}

export async function finishProductionInstall(staging, pkg, lock) {
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (location.startsWith("node_modules/") && entry.dev === true) {
      try {
        await fs.lstat(path.join(staging, location));
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      throw new Error(`Development dependency was installed in the MCPB: ${location}`);
    }
  }
  // Keep runtime package metadata; remove scripts, developer tooling and install metadata.
  const runtimePackage = Object.fromEntries(
    ["name", "version", "description", "type", "license", "repository", "homepage", "bugs", "engines", "dependencies"]
      .filter(key => pkg[key] !== undefined).map(key => [key, pkg[key]]),
  );
  await fs.writeFile(path.join(staging, "package.json"), `${JSON.stringify(runtimePackage, null, 2)}\n`);
  await fs.rm(path.join(staging, "package-lock.json"));
  await fs.rm(path.join(staging, "node_modules/.package-lock.json"), { force: true });
  await fs.rm(path.join(staging, "node_modules/.bin"), { force: true, recursive: true });
}

// MCPB 2.1.2 puts the build time in ZIP headers. Normalize only metadata, leaving
// compressed contents and CRCs untouched. The fixed DOS date is 1980-01-01.
export function normalizeArchive(input) {
  const archive = Buffer.from(input);
  let end = archive.length - 22;
  while (end >= Math.max(0, archive.length - 65_557) && archive.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || archive.readUInt32LE(end) !== 0x06054b50
    || archive.readUInt16LE(end + 4) !== 0 || archive.readUInt16LE(end + 6) !== 0) {
    throw new Error("Invalid or unsupported MCPB ZIP archive.");
  }
  const count = archive.readUInt16LE(end + 10);
  if (count === 0xffff) throw new Error("ZIP64 MCPB archives are not supported.");
  let offset = archive.readUInt32LE(end + 16);
  const names = new Set();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid MCPB ZIP directory.");
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").includes("..") || names.has(name)) {
      throw new Error("Unsafe or duplicate MCPB ZIP entry.");
    }
    names.add(name);
    const local = archive.readUInt32LE(offset + 42);
    if (local + 30 > offset || archive.readUInt32LE(local) !== 0x04034b50) throw new Error("Invalid MCPB ZIP entry.");
    archive.writeUInt16LE(0, local + 10);
    archive.writeUInt16LE(33, local + 12);
    archive.writeUInt16LE(0, offset + 12);
    archive.writeUInt16LE(33, offset + 14);
    archive.writeUInt16LE(0x0314, offset + 4);
    archive.writeUInt32LE(0o644 << 16, offset + 38);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end) throw new Error("Unexpected MCPB ZIP directory length.");
  return archive;
}

export async function buildBundle(output) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "onepassword-mcpb-"));
  const staging = path.join(temporary, "bundle");
  const cache = process.env.NPM_CONFIG_CACHE || path.join(os.tmpdir(), "onepassword-mcpb-npm-cache");
  const run = (args, cwd = root) => execFileSync(npm, args, {
    cwd, stdio: "inherit", env: { ...process.env, NPM_CONFIG_CACHE: cache, npm_config_ignore_scripts: "true" },
  });
  try {
    run(["run", "build"]);
    const { pkg, lock } = await prepareBundle(root, staging);
    run(["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], staging);
    await finishProductionInstall(staging, pkg, lock);
    const packed = path.join(temporary, "bundle.mcpb");
    run(["exec", "--yes", "--package", MCPB_TOOL, "--", "mcpb", "pack", staging, packed], temporary);
    const archive = normalizeArchive(await fs.readFile(packed));
    const destination = path.resolve(output || path.join(root, "dist", `${pkg.name}-${pkg.version}.mcpb`));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, archive);
    console.log(`MCPB ready: ${destination}`);
    console.log(`SHA-256: ${createHash("sha256").update(archive).digest("hex")}`);
    return destination;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--output" || !args[1])) {
    throw new Error("Usage: node scripts/build-mcpb.mjs [--output path/to/server.mcpb]");
  }
  await buildBundle(args[1]);
}
