import { readFile, writeFile } from "node:fs/promises";

const packagePath = new URL("../package.json", import.meta.url);
const serverPath = new URL("../server.json", import.meta.url);

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const serverJson = JSON.parse(await readFile(serverPath, "utf8"));
const [command = "check", tag] = process.argv.slice(2);

function registryPackageVersions() {
  return (serverJson.packages ?? [])
    .filter((entry) => entry.registryType === "npm" && entry.identifier === packageJson.name)
    .map((entry) => entry.version);
}

if (command === "sync") {
  serverJson.version = packageJson.version;
  for (const entry of serverJson.packages ?? []) {
    if (entry.registryType === "npm" && entry.identifier === packageJson.name) {
      entry.version = packageJson.version;
    }
  }

  await writeFile(serverPath, `${JSON.stringify(serverJson, null, 2)}\n`);
  console.log(`Synchronized server.json to ${packageJson.version}.`);
  process.exit(0);
}

if (command !== "check") {
  throw new Error(`Unknown release-version command: ${command}`);
}

const versions = [serverJson.version, ...registryPackageVersions()];
if (versions.some((version) => version !== packageJson.version)) {
  throw new Error(
    `Release versions do not match: package.json=${packageJson.version}, server.json=${versions.join(",")}`,
  );
}

if (tag && tag !== `v${packageJson.version}`) {
  throw new Error(`Tag ${tag} does not match package version v${packageJson.version}.`);
}

console.log(`Release metadata is consistent at ${packageJson.version}.`);
