import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PolicyService } from "../src/policy.js";
import { StateStore } from "../src/state.js";

test("manual grants must point at the configured agent vault", async () => {
  await withTempHome(async () => {
    const policy = new PolicyService(new StateStore());

    await assert.rejects(
      policy.createManual({
        title: "Private GitHub",
        secretRef: "op://Private/GitHub/password",
        sites: ["github.com"],
      }),
      /Only items in MCPVAULT/,
    );

    const grant = await policy.createManual({
      title: "Agent GitHub",
      secretRef: "op://MCPVAULT/GitHub/password",
      sites: ["github.com"],
    });

    assert.equal(grant.vaultName, undefined);
    const publicGrants = await policy.listPublicGrants();
    assert.equal(publicGrants.length, 1);
    assert.equal(publicGrants[0].title, "Agent GitHub");
  });
});

async function withTempHome(run: () => Promise<void>): Promise<void> {
  const previousHome = process.env.ONEPASSWORD_MCP_HOME;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-policy-test-"));
  process.env.ONEPASSWORD_MCP_HOME = home;
  try {
    await run();
  } finally {
    if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME;
    else process.env.ONEPASSWORD_MCP_HOME = previousHome;
    await fs.rm(home, { recursive: true, force: true });
  }
}
