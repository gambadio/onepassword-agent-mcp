import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { policyPath } from "../src/paths.js";
import { StateStore } from "../src/state.js";

test("load repairs a blank agent vault name", async () => {
  await withTempHome(async () => {
    const now = new Date().toISOString();
    await fs.mkdir(path.dirname(policyPath()), { recursive: true });
    await fs.writeFile(policyPath(), JSON.stringify({
      version: 1,
      createdAt: now,
      updatedAt: now,
      settings: {
        opPath: "op",
        account: "",
        adminHost: "127.0.0.1",
        adminPort: 7319,
        clipboardClearSeconds: 20,
        autoPasteByDefault: true,
        allowPasteWithoutSite: false,
        allowAgentItemCreate: false,
        defaultVault: "",
        mcpVaultName: "",
      },
      grants: [],
      audit: [],
    }));

    const file = await new StateStore().load();
    assert.equal(file.settings.mcpVaultName, "MCPVAULT");
    assert.deepEqual(file.profile, []);
  });
});

async function withTempHome(run: () => Promise<void>): Promise<void> {
  const previousHome = process.env.ONEPASSWORD_MCP_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-state-test-"));
  process.env.ONEPASSWORD_MCP_HOME = home;
  try {
    await run();
  } finally {
    if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
    else process.env.ONEPASSWORD_MCP_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
}
