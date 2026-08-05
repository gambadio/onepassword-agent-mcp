import { loadOrCreateKey, openJson, randomId, sealJson } from "./cryptoBox.js";
import { StateStore } from "./state.js";
import { siteMatches } from "./siteMatch.js";
export class PolicyService {
    store;
    constructor(store = new StateStore()) {
        this.store = store;
    }
    async listPublicGrants() {
        const [policy, key] = await Promise.all([this.store.load(), loadOrCreateKey()]);
        return policy.grants.flatMap((grant) => {
            const saved = openJson(grant.encryptedRef, key);
            if (!grantTargetsMcpVault(grant, policy.settings.mcpVaultName, saved.secretRef)) {
                return [];
            }
            return [this.toPublicGrant(grant, key, saved)];
        });
    }
    async findForSite(site) {
        const grants = await this.listPublicGrants();
        return grants.filter((grant) => grant.enabled && siteMatches(grant.sites, site));
    }
    async listProfileEntries() {
        const policy = await this.store.load();
        return policy.profile;
    }
    async findProfileForSite(site) {
        const policy = await this.store.load();
        const entries = policy.profile.filter((entry) => {
            if (!entry.enabled)
                return false;
            if (site)
                return siteMatches(entry.sites, site);
            return entry.sites.length === 0;
        });
        if (entries.length) {
            await this.store.addAudit({
                type: "profile.read",
                site,
                message: `Returned ${entries.length} profile field${entries.length === 1 ? "" : "s"}${site ? ` for ${site}` : ""}.`,
            });
        }
        return entries;
    }
    async createProfileEntry(input) {
        const now = new Date().toISOString();
        const entry = {
            id: randomId("profile"),
            label: input.label,
            kind: input.kind,
            value: input.value,
            sites: input.sites,
            enabled: input.enabled ?? true,
            createdAt: now,
            updatedAt: now,
            note: input.note,
        };
        await this.store.update((policy) => {
            policy.profile.push(entry);
            policy.audit.unshift({
                id: randomId("audit"),
                type: "profile.created",
                message: `Created profile field ${entry.label}`,
                createdAt: now,
            });
            policy.audit = policy.audit.slice(0, 200);
        });
        return entry;
    }
    async updateProfileEntry(id, patch) {
        let updated;
        await this.store.update((policy) => {
            const entry = policy.profile.find((item) => item.id === id);
            if (!entry)
                throw new Error(`Profile field not found: ${id}`);
            updated = {
                ...entry,
                ...patch,
                sites: patch.sites ?? entry.sites,
                updatedAt: new Date().toISOString(),
            };
            policy.profile = policy.profile.map((item) => (item.id === id ? updated : item));
            policy.audit.unshift({
                id: randomId("audit"),
                type: "profile.updated",
                message: `Updated profile field ${updated.label}`,
                createdAt: new Date().toISOString(),
            });
            policy.audit = policy.audit.slice(0, 200);
        });
        return updated;
    }
    async deleteProfileEntry(id) {
        await this.store.update((policy) => {
            const entry = policy.profile.find((item) => item.id === id);
            policy.profile = policy.profile.filter((item) => item.id !== id);
            policy.audit.unshift({
                id: randomId("audit"),
                type: "profile.deleted",
                message: entry ? `Deleted profile field ${entry.label}` : `Deleted profile field ${id}`,
                createdAt: new Date().toISOString(),
            });
            policy.audit = policy.audit.slice(0, 200);
        });
    }
    async createFromCandidate(candidateToken, overrides) {
        const key = await loadOrCreateKey();
        const candidate = openJson(candidateToken, key);
        return await this.createGrant({
            title: overrides.title || candidate.title,
            username: overrides.username ?? candidate.username,
            vaultId: candidate.vaultId,
            vaultName: candidate.vaultName,
            itemId: candidate.itemId,
            itemTitle: candidate.itemTitle,
            fieldLabel: overrides.fieldLabel || candidate.fieldLabel,
            kind: overrides.kind || candidate.kind,
            sites: overrides.sites !== undefined ? overrides.sites : candidate.sites,
            enabled: overrides.enabled ?? true,
            note: overrides.note,
            secretRef: candidate.secretRef,
        });
    }
    async createManual(input) {
        return await this.createGrant({
            title: input.title,
            secretRef: input.secretRef,
            sites: input.sites,
            username: input.username,
            fieldLabel: input.fieldLabel || "password",
            kind: input.kind || "password",
            note: input.note,
            enabled: input.enabled ?? true,
        });
    }
    async updateGrant(id, patch) {
        let updated;
        await this.store.update((policy) => {
            const grant = policy.grants.find((item) => item.id === id);
            if (!grant)
                throw new Error(`Grant not found: ${id}`);
            updated = {
                ...grant,
                ...patch,
                sites: patch.sites ?? grant.sites,
                updatedAt: new Date().toISOString(),
            };
            policy.grants = policy.grants.map((item) => (item.id === id ? updated : item));
            policy.audit.unshift({
                id: randomId("audit"),
                type: "grant.updated",
                grantId: id,
                message: `Updated grant ${updated.title}`,
                createdAt: new Date().toISOString(),
            });
            policy.audit = policy.audit.slice(0, 200);
        });
        return updated;
    }
    async deleteGrant(id) {
        await this.store.update((policy) => {
            const grant = policy.grants.find((item) => item.id === id);
            policy.grants = policy.grants.filter((item) => item.id !== id);
            policy.audit.unshift({
                id: randomId("audit"),
                type: "grant.deleted",
                grantId: id,
                message: grant ? `Deleted grant ${grant.title}` : `Deleted grant ${id}`,
                createdAt: new Date().toISOString(),
            });
            policy.audit = policy.audit.slice(0, 200);
        });
    }
    async deleteGrantsForItem(itemId, vaultId, vaultName) {
        let removed = 0;
        await this.store.update((policy) => {
            const matches = policy.grants.filter((grant) => {
                if (grant.itemId !== itemId)
                    return false;
                if (vaultId && grant.vaultId && grant.vaultId !== vaultId)
                    return false;
                if (vaultName && grant.vaultName && grant.vaultName !== vaultName)
                    return false;
                return true;
            });
            removed = matches.length;
            if (!removed)
                return;
            policy.grants = policy.grants.filter((grant) => !matches.includes(grant));
            for (const grant of matches) {
                policy.audit.unshift({
                    id: randomId("audit"),
                    type: "grant.deleted",
                    grantId: grant.id,
                    message: `Deleted grant ${grant.title} because the 1Password item was deleted.`,
                    createdAt: new Date().toISOString(),
                });
            }
            policy.audit = policy.audit.slice(0, 200);
        });
        return removed;
    }
    async resolveHandle(handle, expectedSite) {
        const [policy, key] = await Promise.all([this.store.load(), loadOrCreateKey()]);
        const payload = openJson(handle, key);
        const grant = policy.grants.find((item) => item.id === payload.grantId);
        if (!grant) {
            await this.store.addAudit({
                type: "secret.denied",
                site: expectedSite,
                message: "Denied paste for missing grant.",
            });
            throw new Error("This secret handle no longer exists.");
        }
        if (!grant.enabled) {
            await this.store.addAudit({
                type: "secret.denied",
                grantId: grant.id,
                site: expectedSite,
                message: `Denied paste for disabled grant ${grant.title}.`,
            });
            throw new Error("This secret is disabled in the local policy.");
        }
        const savedRef = openJson(grant.encryptedRef, key);
        if (savedRef.secretRef !== payload.secretRef || savedRef.kind !== payload.kind) {
            throw new Error("This secret handle does not match the saved policy.");
        }
        if (!grantTargetsMcpVault(grant, policy.settings.mcpVaultName, savedRef.secretRef)) {
            await this.store.addAudit({
                type: "secret.denied",
                grantId: grant.id,
                site: expectedSite,
                message: `Denied paste for ${grant.title}: item is outside ${policy.settings.mcpVaultName}.`,
            });
            throw new Error(`This approval is outside ${policy.settings.mcpVaultName}.`);
        }
        if (expectedSite) {
            if (grant.sites.length && !siteMatches(grant.sites, expectedSite)) {
                await this.store.addAudit({
                    type: "secret.denied",
                    grantId: grant.id,
                    site: expectedSite,
                    message: `Denied paste for ${grant.title}: site not allowed.`,
                });
                throw new Error(`Site is not allowed for ${grant.title}.`);
            }
        }
        else if (!policy.settings.allowPasteWithoutSite) {
            throw new Error("expectedSite is required by policy.");
        }
        return { grant, secretRef: payload.secretRef };
    }
    async markUsed(grantId, type, site) {
        await this.store.update((policy) => {
            const grant = policy.grants.find((item) => item.id === grantId);
            if (grant) {
                grant.lastUsedAt = new Date().toISOString();
                grant.updatedAt = new Date().toISOString();
            }
            policy.audit.unshift({
                id: randomId("audit"),
                type,
                grantId,
                site,
                message: `${type === "secret.pasted" ? "Pasted" : "Copied"} approved secret${site ? ` for ${site}` : ""}.`,
                createdAt: new Date().toISOString(),
            });
            policy.audit = policy.audit.slice(0, 200);
        });
    }
    async createGrant(input) {
        if (!input.secretRef.startsWith("op://")) {
            throw new Error("Secret reference must start with op://");
        }
        const policy = await this.store.load();
        if (!grantTargetsMcpVault(input, policy.settings.mcpVaultName, input.secretRef)) {
            throw new Error(`Only items in ${policy.settings.mcpVaultName} can be approved for agents.`);
        }
        const key = await loadOrCreateKey();
        const now = new Date().toISOString();
        let grant;
        await this.store.update((policy) => {
            const existing = policy.grants.find((candidate) => {
                if (candidate.kind !== input.kind)
                    return false;
                try {
                    return openJson(candidate.encryptedRef, key).secretRef === input.secretRef;
                }
                catch {
                    return false;
                }
            });
            if (existing) {
                grant = {
                    ...existing,
                    title: input.title,
                    username: input.username,
                    vaultId: input.vaultId,
                    vaultName: input.vaultName,
                    itemId: input.itemId,
                    itemTitle: input.itemTitle,
                    fieldLabel: input.fieldLabel,
                    sites: input.sites,
                    enabled: input.enabled,
                    note: input.note ?? existing.note,
                    updatedAt: now,
                };
                policy.grants = policy.grants.map((item) => (item.id === existing.id ? grant : item));
                policy.audit.unshift({
                    id: randomId("audit"),
                    type: "grant.updated",
                    grantId: grant.id,
                    message: `Updated grant ${grant.title}`,
                    createdAt: now,
                });
                policy.audit = policy.audit.slice(0, 200);
                return;
            }
            const id = randomId("grant");
            const encryptedRef = sealJson({
                grantId: id,
                secretRef: input.secretRef,
                kind: input.kind,
                issuedAt: now,
            }, key);
            grant = {
                id,
                title: input.title,
                username: input.username,
                vaultId: input.vaultId,
                vaultName: input.vaultName,
                itemId: input.itemId,
                itemTitle: input.itemTitle,
                fieldLabel: input.fieldLabel,
                kind: input.kind,
                encryptedRef,
                sites: input.sites,
                enabled: input.enabled,
                createdAt: now,
                updatedAt: now,
                note: input.note,
            };
            policy.grants.push(grant);
            policy.audit.unshift({
                id: randomId("audit"),
                type: "grant.created",
                grantId: grant.id,
                message: `Created grant ${grant.title}`,
                createdAt: now,
            });
            policy.audit = policy.audit.slice(0, 200);
        });
        return grant;
    }
    toPublicGrant(grant, key, saved) {
        const savedRef = saved || openJson(grant.encryptedRef, key);
        const handle = sealJson({
            grantId: grant.id,
            secretRef: savedRef.secretRef,
            kind: grant.kind,
            issuedAt: new Date().toISOString(),
        }, key);
        return {
            id: grant.id,
            title: grant.title,
            username: grant.username,
            vaultId: grant.vaultId,
            vaultName: grant.vaultName,
            itemId: grant.itemId,
            itemTitle: grant.itemTitle,
            fieldLabel: grant.fieldLabel,
            kind: grant.kind,
            sites: grant.sites,
            enabled: grant.enabled,
            handle,
            createdAt: grant.createdAt,
            updatedAt: grant.updatedAt,
            lastUsedAt: grant.lastUsedAt,
            note: grant.note,
        };
    }
}
function grantTargetsMcpVault(grant, mcpVaultName, secretRef) {
    const expected = normalizeVault(mcpVaultName);
    if (!expected)
        return true;
    return [
        grant.vaultName,
        grant.vaultId,
        extractVaultFromSecretRef(secretRef),
    ].some((vault) => normalizeVault(vault) === expected);
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
//# sourceMappingURL=policy.js.map