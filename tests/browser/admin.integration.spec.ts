import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createAdminApp } from "../../src/admin.js";
import { StateStore } from "../../src/state.js";

test("production dashboard saves permissions and encrypted access through its real guarded API", async ({ page }) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-browser-api-"));
  const previousHome = process.env.ONEPASSWORD_MCP_HOME;
  const previousToken = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  process.env.ONEPASSWORD_MCP_HOME = home;
  delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
  await new StateStore().update(file => { file.settings.opPath = path.join(home, "unavailable-cli"); });
  const server = (await createAdminApp()).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const secret = "ops_SYNTHETIC_BROWSER_ONLY_123456789";
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${address.port}/#permissions`);
    await page.locator('input[name="allowAgentItemCreate"]').check();
    await page.locator('input[name="allowClipboardSave"]').check();
    await page.getByRole("button", { name: "Save Settings", exact: true }).click();
    await expect(page.locator("#settingsSaveState")).toContainText(/saved/i);
    expect((await new StateStore().load()).settings.allowClipboardSave).toBe(true);
    await page.getByLabel("Service account token", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Save encrypted token", exact: true }).click();
    await expect(page.getByLabel("Service account token", { exact: true })).toHaveValue("");
    await expect.poll(async () => (await page.request.get(`http://127.0.0.1:${address.port}/api/access`)).json()).toMatchObject({ enabled: true, source: "local" });
    expect(await fs.readFile(path.join(home, "access.json"), "utf8")).not.toContain(secret);
    await page.reload();
    await expect(page.locator('input[name="allowClipboardSave"]')).toBeChecked();
    expect(await page.locator("body").innerText()).not.toContain(secret);
    expect(errors).toEqual([]);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previousHome === undefined) delete process.env.ONEPASSWORD_MCP_HOME; else process.env.ONEPASSWORD_MCP_HOME = previousHome;
    if (previousToken === undefined) delete process.env.OP_SERVICE_ACCOUNT_TOKEN; else process.env.OP_SERVICE_ACCOUNT_TOKEN = previousToken;
    await fs.rm(home, { recursive: true, force: true });
  }
});
