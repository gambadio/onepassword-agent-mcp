import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("release metadata matches the package version and tag", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/release-version.mjs", "check", `v${packageJson.version}`],
    { encoding: "utf8" },
  );

  assert.match(output, new RegExp(`consistent at ${packageJson.version}`));
});

test("release metadata rejects a mismatched tag", () => {
  assert.throws(
    () =>
      execFileSync(process.execPath, ["scripts/release-version.mjs", "check", "v99.0.0"], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    /Command failed/,
  );
});
