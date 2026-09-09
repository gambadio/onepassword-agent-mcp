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

test("simultaneous updates preserve settings and every audit without temp collisions", async () => {
  await withTempHome(async () => {
    const store = new StateStore();
    await Promise.all(Array.from({ length: 30 }, (_, index) => new StateStore().update(async policy => {
      if (index === 0) policy.settings.allowAgentItemCreate = true;
      await new Promise(resolve => setTimeout(resolve, 2));
      policy.audit.push({ id: String(index), createdAt: new Date().toISOString(), type: "settings.updated", message: "Synthetic " + index });
    })));
    const state = await store.load();
    assert.equal(state.settings.allowAgentItemCreate, true);
    assert.equal(state.audit.length, 30);
    assert.equal(new Set(state.audit.map(event => event.id)).size, 30);
  });
});

test("separate processes serialize transactions and a stale audit cannot undo revocation", async () => {
  await withTempHome(async () => {
    const { spawn } = await import("node:child_process");
    const store = new StateStore();
    await store.update(policy => { policy.settings.allowAgentItemCreate = true; });
    const worker = (revoke: boolean) => new Promise<void>((resolve, reject) => {
      const code = `import { StateStore } from ${JSON.stringify(new URL("../src/state.ts", import.meta.url).href)};
        const store=new StateStore();
        for(let i=0;i<10;i++) await store.update(async state=>{
          await new Promise(r=>setTimeout(r,5));
          if(${revoke}) state.settings.allowAgentItemCreate=false;
          state.audit.push({id:process.pid+':'+i,type:'settings.updated',message:'synthetic',createdAt:new Date().toISOString()});
        });`;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
    });
    await Promise.all([worker(false), worker(true), worker(false)]);
    const state = await store.load();
    assert.equal(state.settings.allowAgentItemCreate, false);
    assert.equal(state.audit.length, 30);
  });
});
