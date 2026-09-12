import fs from "node:fs/promises";
import { withFileLock } from "./fileLock.js";
import { appHome, policyPath } from "./paths.js";
import { randomId } from "./cryptoBox.js";
const DEFAULT_SETTINGS = {
    opPath: process.env.OP_PATH || "op",
    account: process.env.OP_ACCOUNT || "",
    adminHost: process.env.ADMIN_HOST || "127.0.0.1",
    adminPort: Number(process.env.ADMIN_PORT || 7319),
    clipboardClearSeconds: 20,
    autoPasteByDefault: true,
    allowPasteWithoutSite: false,
    allowAgentItemCreate: false,
    autoApproveAgentItems: false,
    defaultVault: "",
    mcpVaultName: process.env.MCP_VAULT_NAME || "MCPVAULT",
};
export class StateStore {
    async load() {
        try {
            return await this.read();
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            return await this.update(() => { });
        }
    }
    async read(initialize = false) {
        const file = policyPath();
        try {
            const raw = await fs.readFile(file, "utf8");
            const parsed = JSON.parse(raw);
            const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
            settings.autoApproveAgentItems = settings.autoApproveAgentItems === true;
            if (!settings.mcpVaultName.trim()) {
                settings.mcpVaultName = DEFAULT_SETTINGS.mcpVaultName;
            }
            if (!settings.opPath.trim()) {
                settings.opPath = DEFAULT_SETTINGS.opPath;
            }
            return {
                ...parsed,
                settings,
                grants: parsed.grants || [],
                profile: parsed.profile || [],
                audit: parsed.audit || [],
                operations: parsed.operations || [],
            };
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
            if (!initialize)
                throw error;
            const now = new Date().toISOString();
            const initial = {
                version: 1,
                createdAt: now,
                updatedAt: now,
                settings: { ...DEFAULT_SETTINGS },
                grants: [],
                profile: [],
                audit: [],
                operations: [],
            };
            return initial;
        }
    }
    async save(policy, assertOwned) {
        await fs.mkdir(appHome(), { recursive: true, mode: 0o700 });
        policy.updatedAt = new Date().toISOString();
        const file = policyPath();
        const tmp = `${file}.${randomId("write")}.tmp`;
        try {
            const handle = await fs.open(tmp, "wx", 0o600);
            try {
                await handle.writeFile(`${JSON.stringify(policy, null, 2)}\n`);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            assertOwned();
            await fs.rename(tmp, file);
        }
        finally {
            await fs.rm(tmp, { force: true });
        }
    }
    async update(mutator) {
        return await withFileLock(policyPath(), async (assertOwned) => {
            const policy = await this.read(true);
            await mutator(policy);
            await this.save(policy, assertOwned);
            return policy;
        });
    }
    async addAudit(event) {
        await this.update((policy) => {
            policy.audit.unshift({
                id: randomId("audit"),
                createdAt: new Date().toISOString(),
                ...event,
            });
            policy.audit = policy.audit.slice(0, 200);
        });
    }
}
//# sourceMappingURL=state.js.map