import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const defaults = { mcpVaultName: "MCPVAULT", opPath: "op", account: "", clipboardClearSeconds: 20, allowPasteWithoutSite: false, allowAgentItemCreate: false, allowClipboardSave: false, autoApproveAgentItems: false };
const result = (query = "") => ({ items: [], total: 0, matched: 0, shown: 0, activeGroup: "all", groups: {}, query });

async function setup(page: Page) {
  const state = { settings: { ...defaults }, candidateCalls: [] as string[], failStatus: false, authenticated: true, access: { mode: "desktop", configured: false, enabled: false, source: "none" }, accessCalls: [] as { method: string; body: unknown }[], failAccess: false };
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
    if (url.pathname === "/api/access/test") return route.fulfill({ json: { ok: true, vaultVisible: true, canWrite: "not_tested" } });
    if (url.pathname === "/api/access") {
      const method = route.request().method();
      if (method !== "GET") {
        state.accessCalls.push({ method, body: method === "DELETE" ? null : route.request().postDataJSON() });
        if (state.failAccess) return route.fulfill({ status: 400, json: { error: "Sensitive backend failure ops_synthetic_browser_test" } });
        if (method === "PUT") state.access = { mode: "service_account", configured: true, enabled: true, source: "local" };
        if (method === "PATCH") Object.assign(state.access, { enabled: route.request().postDataJSON().enabled, mode: route.request().postDataJSON().enabled ? "service_account" : "desktop" });
        if (method === "DELETE") state.access = { mode: "desktop", configured: false, enabled: false, source: "none" };
      }
      return route.fulfill({ json: state.access });
    }
    if (url.pathname === "/api/menubar") return route.fulfill({ json: { supported: false } });
    if (url.pathname === "/api/grants" || url.pathname === "/api/profile") return route.fulfill({ json: [] });
    if (url.pathname === "/api/op/candidates") {
      state.candidateCalls.push(url.searchParams.get("vault")!);
      return route.fulfill({ json: result(url.searchParams.get("q") || "") });
    }
    const file = path.join(process.cwd(), "public", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : "text/html";
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
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
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
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
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
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  await expect(checkbox).toBeChecked();
  await checkbox.uncheck();
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toHaveText("Settings saved.");
  expect(state.settings.autoApproveAgentItems).toBe(false);
  expect(errors).toEqual([]);
});


test("clipboard capture is explicit, persisted, and can be turned off", async ({ page }) => {
  const { state, errors } = await setup(page);
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  const capture = page.getByRole("checkbox", { name: "Save secrets from the clipboard", exact: true });
  await expect(capture).not.toBeChecked();
  await capture.check();
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toHaveText("Settings saved.");
  expect(state.settings.allowClipboardSave).toBe(true);
  await page.reload();
  await expect(capture).toBeChecked();
  await capture.uncheck();
  await page.getByRole("button", { name: "Save Settings", exact: true }).click();
  await expect(page.locator("#settingsSaveState")).toHaveText("Settings saved.");
  expect(state.settings.allowClipboardSave).toBe(false);
  expect(errors).toEqual([]);
});

test("unattended access clears the token and supports testing, disabling, and removing", async ({ page }, testInfo) => {
  const { state, errors } = await setup(page);
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("permissions-desktop.png"), fullPage: true });
  const token = page.getByLabel("Service account token", { exact: true });
  await expect(page.locator("#accessForm")).toHaveAttribute("method", "post");
  await expect(token).toHaveAttribute("type", "password");
  await expect(token).toHaveAttribute("autocomplete", "off");
  await token.fill("ops_synthetic_browser_test");
  await page.getByRole("button", { name: "Save encrypted token", exact: true }).click();
  await expect(token).toHaveValue("");
  await expect(page.locator("#accessStatus")).toHaveText("Unattended access on");
  expect(state.accessCalls[0]).toEqual({ method: "PUT", body: { token: "ops_synthetic_browser_test" } });
  await expect(page.locator("body")).not.toContainText("ops_synthetic_browser_test");
  await page.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(page.locator("#accessMessage")).toContainText("Vault is reachable");
  await expect(page.locator("#accessMessage")).toContainText("Write permission was not tested");
  await page.getByRole("checkbox", { name: "Use saved service account", exact: true }).uncheck();
  await expect(page.locator("#accessStatus")).toHaveText("Saved token paused");
  expect(state.access.enabled).toBe(false);
  await page.getByRole("checkbox", { name: "Use saved service account", exact: true }).check();
  await expect(page.locator("#accessStatus")).toHaveText("Unattended access on");
  await page.getByRole("button", { name: "Remove saved token", exact: true }).click();
  await expect(page.locator("#accessStatus")).toHaveText("Desktop authorization");
  expect(state.access.configured).toBe(false);
  expect(errors).toEqual([]);
});

test("failed token save does not leave or echo the token in the page", async ({ page }) => {
  const { state, errors } = await setup(page);
  state.failAccess = true;
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  await page.getByLabel("Service account token", { exact: true }).fill("ops_synthetic_browser_test");
  await page.getByRole("button", { name: "Save encrypted token", exact: true }).click();
  await expect(page.getByLabel("Service account token", { exact: true })).toHaveValue("");
  await expect(page.locator("#accessMessage")).toContainText("could not be saved");
  await expect(page.locator("body")).not.toContainText("ops_synthetic_browser_test");
  expect(errors).toEqual([]);
});

test("navigation stays usable on mobile without horizontal overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { errors } = await setup(page);
  await expect(page.getByRole("link", { name: "Permissions", exact: true })).toBeVisible();
  for (const name of ["Vault", "Permissions", "Profile", "Activity"]) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (name === "Vault" || name === "Permissions") await page.screenshot({ path: testInfo.outputPath(`${name.toLowerCase()}-mobile.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});


test("environment credentials are described without offering local overrides", async ({ page }) => {
  const { state, errors } = await setup(page);
  state.access = { mode: "environment", configured: true, enabled: true, source: "environment" };
  await page.locator("#refreshBtn").click();
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  await expect(page.locator("#accessStatus")).toHaveText("Managed by environment");
  await expect(page.getByLabel("Service account token", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Use saved service account", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Remove saved token", exact: true })).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Test connection", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("vault overview renders with desktop navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  const { errors } = await setup(page);
  await expect(page.getByRole("heading", { name: "Your vault. Your rules." })).toBeVisible();
  expect(await page.locator(".brand img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator("#approvedMetric")).toHaveText("0");
  await page.screenshot({ path: testInfo.outputPath("vault-desktop.png"), fullPage: true });
  expect(errors).toEqual([]);
});


test("token clears while its save request is still pending", async ({ page }) => {
  const { errors } = await setup(page);
  let pending: Route | undefined;
  await page.route("**/api/access", route => {
    if (route.request().method() === "PUT") { pending = route; return; }
    return route.fallback();
  });
  await page.getByRole("link", { name: "Permissions", exact: true }).click();
  const token = page.getByLabel("Service account token", { exact: true });
  await token.fill("ops_synthetic_browser_test");
  await page.getByRole("button", { name: "Save encrypted token", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(token).toHaveValue("");
  await expect(token).toBeDisabled();
  await pending!.fulfill({ status: 400, json: { error: "Synthetic failure" } });
  await expect(token).toBeEnabled();
  await expect(page.locator("#accessMessage")).toContainText("could not be saved");
  expect(errors).toEqual([]);
});
