#!/usr/bin/env node
import express from "express";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadOrCreateKey, openJson } from "./cryptoBox.js";
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
        const publicGrants = await policyService.listPublicGrants();
        const op = new OpCli(file.settings);
        let cli;
        try {
            const version = await op.version();
            let vaults = [];
            let authError = null;
            try {
                vaults = await op.listVaults();
            }
            catch (error) {
                authError = error.message;
            }
            const mcpVault = describeMcpVault(file, vaults);
            cli = {
                installed: true,
                authenticated: vaults.length > 0,
                version,
                vaults: vaults.map((vault) => ({ id: vault.id, name: vault.name, items: vault.items })),
                mcpVault,
                authError,
            };
        }
        catch (error) {
            cli = {
                installed: false,
                authenticated: false,
                error: error.message,
            };
        }
        res.json({
            cli,
            settings: file.settings,
            grants: publicGrants.length,
            enabledGrants: publicGrants.filter((grant) => grant.enabled).length,
            audit: file.audit.slice(0, 30),
        });
    });
    app.get("/api/settings", async (_req, res) => {
        const file = await store.load();
        res.json(file.settings);
    });
    app.put("/api/settings", async (req, res) => {
        const patch = req.body;
        const updated = await store.update((file) => {
            file.settings = {
                ...file.settings,
                opPath: stringValue(patch.opPath, file.settings.opPath),
                account: stringValue(patch.account, file.settings.account),
                defaultVault: stringValue(patch.defaultVault, file.settings.defaultVault),
                mcpVaultName: nonEmptyStringValue(patch.mcpVaultName, file.settings.mcpVaultName),
                clipboardClearSeconds: numberValue(patch.clipboardClearSeconds, file.settings.clipboardClearSeconds, 1, 300),
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
        const file = await store.load();
        const key = await loadOrCreateKey();
        const candidate = openJson(requireString(req.body.token, "token"), key);
        const vaults = await new OpCli(file.settings).listVaults();
        const mcpVault = describeMcpVault(file, vaults);
        if (!candidateTargetsVault(candidate, mcpVault)) {
            throw new Error(`Copy or move this item into ${file.settings.mcpVaultName} before approving it for agents.`);
        }
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
        const patch = req.body;
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
    app.post("/api/op/mcp-vault", async (_req, res) => {
        const file = await store.load();
        const op = new OpCli(file.settings);
        const before = await op.listVaults();
        const existing = findVault(before, file.settings.mcpVaultName);
        if (existing) {
            res.json({ created: false, vault: existing });
            return;
        }
        const created = await op.createVault(file.settings.mcpVaultName);
        const after = await op.listVaults().catch(() => before);
        const vault = findVault(after, file.settings.mcpVaultName) || created;
        await store.addAudit({
            type: "vault.created",
            message: `Created ${file.settings.mcpVaultName}.`,
        });
        res.status(201).json({ created: true, vault });
    });
    app.post("/api/op/transfer", async (req, res) => {
        const mode = req.body.mode === "move" ? "move" : "copy";
        const file = await store.load();
        const key = await loadOrCreateKey();
        const candidate = openJson(requireString(req.body.token, "token"), key);
        if (!candidate.itemId) {
            throw new Error("This item cannot be transferred because 1Password did not return an item ID.");
        }
        const op = new OpCli(file.settings);
        const vaults = await op.listVaults();
        const mcpVault = describeMcpVault(file, vaults);
        if (!mcpVault.exists) {
            throw new Error(`Create ${file.settings.mcpVaultName} first.`);
        }
        if (candidateTargetsVault(candidate, mcpVault)) {
            throw new Error(`This item is already in ${file.settings.mcpVaultName}.`);
        }
        const currentVault = candidate.vaultId || candidate.vaultName;
        const destinationVault = mcpVault.id || mcpVault.name;
        if (!currentVault || !destinationVault) {
            throw new Error("1Password did not return enough vault information to transfer this item.");
        }
        if (mode === "move") {
            await op.moveItemToVault({
                itemId: candidate.itemId,
                currentVault,
                destinationVault,
            });
        }
        else {
            await op.copyItemToVault({
                itemId: candidate.itemId,
                currentVault,
                destinationVault,
                category: candidate.category,
            });
        }
        await store.addAudit({
            type: mode === "move" ? "item.moved" : "item.copied",
            message: `${mode === "move" ? "Moved" : "Copied"} ${candidate.title} into ${file.settings.mcpVaultName}.`,
        });
        res.status(201).json({ ok: true, mode });
    });
    app.post("/api/op/mcp-vault/items/delete", async (req, res) => {
        const file = await store.load();
        const key = await loadOrCreateKey();
        const candidate = openJson(requireString(req.body.token, "token"), key);
        if (!candidate.itemId) {
            throw new Error("This item cannot be deleted because 1Password did not return an item ID.");
        }
        const op = new OpCli(file.settings);
        const vaults = await op.listVaults();
        const mcpVault = describeMcpVault(file, vaults);
        if (!mcpVault.exists) {
            throw new Error(`Create ${file.settings.mcpVaultName} first.`);
        }
        if (!candidateTargetsVault(candidate, mcpVault)) {
            throw new Error(`Only items in ${file.settings.mcpVaultName} can be deleted here.`);
        }
        const vault = mcpVault.id || mcpVault.name;
        if (!vault) {
            throw new Error("1Password did not return enough vault information to delete this item.");
        }
        await op.deleteItem({ itemId: candidate.itemId, vault });
        const deletedGrants = await policyService.deleteGrantsForItem(candidate.itemId, candidate.vaultId, candidate.vaultName);
        await store.addAudit({
            type: "item.deleted",
            message: `Deleted ${candidate.title} from ${file.settings.mcpVaultName}${deletedGrants ? ` and removed ${deletedGrants} approval${deletedGrants === 1 ? "" : "s"}` : ""}.`,
        });
        res.json({ ok: true, deletedGrants });
    });
    app.use(express.static(publicDir()));
    app.get("/{*splat}", (_req, res) => {
        res.sendFile(path.join(publicDir(), "index.html"));
    });
    app.use((error, _req, res, _next) => {
        res.status(400).json({ error: error.message });
    });
    return app;
}
export async function startAdmin() {
    const file = await store.load();
    const app = await createAdminApp();
    app.listen(file.settings.adminPort, file.settings.adminHost, () => {
        console.log(`1Password Agent MCP admin UI: http://${file.settings.adminHost}:${file.settings.adminPort}`);
    });
}
function adminGuard(req, res, next) {
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
function requireString(value, name) {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(`${name} is required.`);
    }
    return value.trim();
}
function optionalString(value) {
    return typeof value === "string" ? value.trim() || undefined : undefined;
}
function stringValue(value, fallback) {
    return typeof value === "string" ? value.trim() : fallback;
}
function nonEmptyStringValue(value, fallback) {
    if (typeof value !== "string")
        return fallback;
    return value.trim() || fallback;
}
function numberValue(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}
function booleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
function requireSites(value) {
    if (!Array.isArray(value))
        throw new Error("sites must be an array.");
    return value.map(String).map((site) => site.trim()).filter(Boolean);
}
function describeMcpVault(file, vaults) {
    const vault = findVault(vaults, file.settings.mcpVaultName);
    return {
        name: file.settings.mcpVaultName,
        id: vault?.id,
        items: vault?.items,
        exists: Boolean(vault),
    };
}
function findVault(vaults, nameOrId) {
    const expected = normalizeVault(nameOrId);
    return vaults.find((vault) => normalizeVault(vault.name) === expected || normalizeVault(vault.id) === expected);
}
function candidateTargetsVault(candidate, vault) {
    const expected = [vault.id, vault.name].map(normalizeVault).filter(Boolean);
    return [candidate.vaultId, candidate.vaultName, extractVaultFromSecretRef(candidate.secretRef)]
        .map(normalizeVault)
        .filter(Boolean)
        .some((value) => expected.includes(value));
}
function extractVaultFromSecretRef(secretRef) {
    if (!secretRef.startsWith("op://"))
        return undefined;
    const [vault] = secretRef.slice("op://".length).split("/");
    return vault ? decodeURIComponent(vault) : undefined;
}
function normalizeVault(value) {
    return (value || "").trim().toLowerCase();
}
async function publicGrant(id) {
    const grants = await policyService.listPublicGrants();
    return grants.find((grant) => grant.id === id);
}
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
    startAdmin().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
//# sourceMappingURL=admin.js.map