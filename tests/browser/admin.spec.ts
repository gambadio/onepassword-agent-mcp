import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const defaults = { mcpVaultName: "MCPVAULT", opPath: "op", account: "", clipboardClearSeconds: 20, allowPasteWithoutSite: false, allowAgentItemCreate: false, autoApproveAgentItems: false };
const result = (query = "") => ({ items: [], total: 0, matched: 0, shown: 0, activeGroup: "all", groups: {}, query });

async function setup(page: Page) {
  const state = { settings: { ...defaults }, candidateCalls: [] as string[], failStatus: false, authenticated: true };
  await page.route("http://opmcp.test/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/status") {
      if (state.failStatus) return route.fulfill({ status: 503, json: { error: "Synthetic reload failure" } });
      return route.fulfill({ json: { settings: state.settings, grants: 0, enabledGrants: 0, audit: [], cli: {
        installed: true, authenticated: state.authenticated, version: "fixture", authError: state.authenticated ? null : "Locked",
        mcpVault: { name: state.settings.mcpVaultName, exists: state.authenticated },
        vaults: [{ id: "source", name: "Source" }, { id: "mcp", name: state.settings.mcpVaultName }],
      } } });
    }
    if (url.pathname === "/api/settings") {
      Object.assign(state.settings, route.request().postDataJSON());
      return route.fulfill({ json: state.settings });
    }
    if (url.pathname === "/api/menubar") return route.fulfill({ json: { supported: false } });
    if (url.pathname === "/api/grants" || url.pathname === "/api/profile") return route.fulfill({ json: [] });
    if (url.pathname === "/api/op/candidates") {
      state.candidateCalls.push(url.searchParams.get("vault")!);
      return route.fulfill({ json: result(url.searchParams.get("q") || "") });
    }
    const file = path.join(process.cwd(), "public", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html";
    return route.fulfill({ body: await fs.readFile(file), contentType });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://opmcp.test/");
  await expect(page.locator("#statusLine")).toContainText("authorized");
  await expect.poll(() => state.candidateCalls.length).toBeGreaterThan(0);
  return { state, errors };
}

test("global Refresh reloads both candidate lists after authorization recovers", async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.locator("#sourceVaultSelect").selectOption("source");
  await expect.poll(() => state.candidateCalls.filter(v => v === "source").length).toBe(1);
  state.authenticated = false;
  await page.locator("#refreshBtn").click();
  await expect(page.locator("#mcpCandidates")).toContainText("cannot reach");
  const before = state.candidateCalls.length;
  state.authenticated = true;
  await page.locator("#refreshBtn").click();
  await expect.poll(() => state.candidateCalls.length).toBeGreaterThan(before + 1);
  await expect(page.locator("#mcpCandidates")).not.toContainText("cannot reach");
  expect(errors).toEqual([]);
});

for (const pane of ["mcp", "source"]) {
 for (const staleFailure of [true, false]) {
  test(`${pane} search ignores an older ${staleFailure ? "failure" : "successful response"}`, async ({ page }) => {
    const { errors } = await setup(page);
    if (pane === "source") await page.locator("#sourceVaultSelect").selectOption("source");
    const requests: { route: Route; query: string }[] = [];
    await page.route("**/api/op/candidates?**", async route => {
      const query = new URL(route.request().url()).searchParams.get("q") || "";
      if (!query) return route.fallback();
      requests.push({ route, query });
    });
    const input = page.locator(`#${pane}SearchInput`);
    await input.fill("older");
    await expect.poll(() => requests.some(r => r.query === "older")).toBe(true);
    await input.fill("newer");
    await expect.poll(() => requests.some(r => r.query === "newer")).toBe(true);
    await requests.find(r => r.query === "newer")!.route.fulfill({ json: { ...result("newer"), total: 222, shown: 222, matched: 222, items: [{ id: "new", itemId: "new", title: "Newer", itemTitle: "Newer", kind: "password", fieldLabel: "password", sites: [], token: "fixture" }] } });
    await expect(page.locator(`#${pane}Summary`)).toContainText("222");
    await requests.find(r => r.query === "older")!.route.fulfill(staleFailure
      ? { status: 500, json: { error: "STALE ERROR" } }
      : { json: { ...result("older"), total: 111, shown: 111, items: [{ itemId: "old", title: "Older", itemTitle: "Older", kind: "password", fieldLabel: "password", sites: [], token: "fixture" }] } });
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#message")).not.toContainText("STALE ERROR");
    await expect(page.locator(`#${pane}Summary`)).toContainText("222");
    expect(errors).toEqual([]);
  });
 }
}

test("Refresh preserves unsaved settings; saved settings remain saved if reload fails", async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.locator("details").filter({ has: page.locator("#settingsForm") }).locator("summary").click();
  const checkbox = page.locator("[name='allowAgentItemCreate']");
  await checkbox.check();
  await expect(page.locator("#settingsSaveState")).toContainText("Unsaved changes");
  await page.locator("#refreshBtn").click();
  await expect(checkbox).toBeChecked();
  expect(state.settings.allowAgentItemCreate).toBe(false);
  state.failStatus = true;
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toContainText("Settings saved. Reload failed");
  expect(state.settings.allowAgentItemCreate).toBe(true);
  await expect(checkbox).toBeChecked();
  expect(errors).toEqual([]);
});

test("auto approval can be enabled, reloaded, and disabled in settings", async ({ page }) => {
  const { state, errors } = await setup(page);
  const details = page.locator("details").filter({ has: page.locator("#settingsForm") });
  await details.locator("summary").click();
  const checkbox = page.getByRole("checkbox", { name: "Automatically approve items agents create" });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await expect(page.locator("#settingsSaveState")).toContainText("Unsaved changes");
  await page.locator("#refreshBtn").click();
  await expect(checkbox).toBeChecked();
  expect(state.settings.autoApproveAgentItems).toBe(false);
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toHaveText("Settings saved.");
  expect(state.settings.autoApproveAgentItems).toBe(true);
  await page.reload();
  await details.locator("summary").click();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toHaveText("Settings saved.");
  expect(state.settings.autoApproveAgentItems).toBe(false);
  expect(errors).toEqual([]);
});
