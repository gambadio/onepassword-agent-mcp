#!/usr/bin/env node
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadOrCreateKey } from "./cryptoBox.js";
import { OpCli } from "./opCli.js";
import { publicDir } from "./paths.js";
import { PolicyService } from "./policy.js";
import { StateStore } from "./state.js";

const store = new StateStore();
const policyService = new PolicyService(store);

export async function createAdminApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", adminGuard);

  app.get("/api/status", async (_req, res) => {
    const file = await store.load();
    const op = new OpCli(file.settings);
    let cli: Record<string, unknown>;
    try {
      const version = await op.version();
      let vaults: Array<{ id?: string; name?: string; items?: number }> = [];
      let authError = null;
      try {
        vaults = await op.listVaults();
      } catch (error) {
        authError = (error as Error).message;
      }
      cli = {
        installed: true,
        authenticated: vaults.length > 0,
        version,
        vaults: vaults.map((vault) => ({ id: vault.id, name: vault.name, items: vault.items })),
        authError,
      };
    } catch (error) {
      cli = {
        installed: false,
        authenticated: false,
        error: (error as Error).message,
      };
    }
    res.json({
      cli,
      settings: file.settings,
      grants: file.grants.length,
      enabledGrants: file.grants.filter((grant) => grant.enabled).length,
      audit: file.audit.slice(0, 30),
    });
  });

  app.get("/api/settings", async (_req, res) => {
    const file = await store.load();
    res.json(file.settings);
  });

  app.put("/api/settings", async (req, res) => {
    const patch = req.body as Record<string, unknown>;
    const updated = await store.update((file) => {
      file.settings = {
        ...file.settings,
        opPath: stringValue(patch.opPath, file.settings.opPath),
        account: stringValue(patch.account, file.settings.account),
        defaultVault: stringValue(patch.defaultVault, file.settings.defaultVault),
        clipboardClearSeconds: numberValue(
          patch.clipboardClearSeconds,
          file.settings.clipboardClearSeconds,
          1,
          300,
        ),
        autoPasteByDefault: booleanValue(patch.autoPasteByDefault, file.settings.autoPasteByDefault),
        allowPasteWithoutSite: booleanValue(patch.allowPasteWithoutSite, file.settings.allowPasteWithoutSite),
      };
      file.audit.unshift({
        id: `audit_${Date.now()}`,
        type: "settings.updated",
        message: "Updated settings",
        createdAt: new Date().toISOString(),
      });
      file.audit = file.audit.slice(0, 200);
    });
    res.json(updated.settings);
  });

  app.get("/api/grants", async (_req, res) => {
    res.json(await policyService.listPublicGrants());
  });

  app.post("/api/grants/manual", async (req, res) => {
    const grant = await policyService.createManual({
      title: requireString(req.body.title, "title"),
      secretRef: requireString(req.body.secretRef, "secretRef"),
      sites: requireSites(req.body.sites),
      username: optionalString(req.body.username),
      fieldLabel: optionalString(req.body.fieldLabel) || "password",
      kind: req.body.kind || "password",
      note: optionalString(req.body.note),
      enabled: req.body.enabled ?? true,
    });
    res.status(201).json(await publicGrant(grant.id));
  });

  app.post("/api/grants/import", async (req, res) => {
    const grant = await policyService.createFromCandidate(requireString(req.body.token, "token"), {
      title: optionalString(req.body.title),
      username: optionalString(req.body.username),
      sites: Array.isArray(req.body.sites) ? req.body.sites : undefined,
      enabled: req.body.enabled ?? true,
      note: optionalString(req.body.note),
    });
    res.status(201).json(await publicGrant(grant.id));
  });

  app.patch("/api/grants/:id", async (req, res) => {
    const patch = req.body as Record<string, unknown>;
    const grant = await policyService.updateGrant(req.params.id, {
      title: optionalString(patch.title),
      username: optionalString(patch.username),
      fieldLabel: optionalString(patch.fieldLabel),
      sites: Array.isArray(patch.sites) ? patch.sites.map(String).filter(Boolean) : undefined,
      enabled: typeof patch.enabled === "boolean" ? patch.enabled : undefined,
      note: optionalString(patch.note),
    });
    res.json(await publicGrant(grant.id));
  });

  app.delete("/api/grants/:id", async (req, res) => {
    await policyService.deleteGrant(req.params.id);
    res.status(204).send();
  });

  app.get("/api/op/candidates", async (req, res) => {
    const file = await store.load();
    const key = await loadOrCreateKey();
    const candidates = await new OpCli(file.settings).listCandidates({
      key,
      vault: optionalString(req.query.vault) || file.settings.defaultVault,
      limit: Number(req.query.limit || 50),
      query: optionalString(req.query.q),
    });
    res.json(candidates);
  });

  app.use(express.static(publicDir()));
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(publicDir(), "index.html"));
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: error.message });
  });

  return app;
}

export async function startAdmin(): Promise<void> {
  const file = await store.load();
  const app = await createAdminApp();
  app.listen(file.settings.adminPort, file.settings.adminHost, () => {
    console.log(`1Password Agent MCP admin UI: http://${file.settings.adminHost}:${file.settings.adminPort}`);
  });
}

function adminGuard(req: Request, res: Response, next: NextFunction) {
  const token = process.env.ONEPASSWORD_MCP_ADMIN_TOKEN;
  if (!token) {
    next();
    return;
  }
  const supplied = req.header("x-admin-token") || req.query.token;
  if (supplied === token) {
    next();
    return;
  }
  res.status(401).json({ error: "Admin token required." });
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function requireSites(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("sites must be an array.");
  const sites = value.map(String).map((site) => site.trim()).filter(Boolean);
  if (!sites.length) throw new Error("At least one site is required.");
  return sites;
}

async function publicGrant(id: string) {
  const grants = await policyService.listPublicGrants();
  return grants.find((grant) => grant.id === id);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  startAdmin().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
