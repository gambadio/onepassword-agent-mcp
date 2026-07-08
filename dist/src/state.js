import fs from "node:fs/promises";
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
    defaultVault: "",
};
export class StateStore {
    async load() {
        const file = policyPath();
        try {
            const raw = await fs.readFile(file, "utf8");
            const parsed = JSON.parse(raw);
            return {
                ...parsed,
                settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
                grants: parsed.grants || [],
                audit: parsed.audit || [],
            };
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }
            const now = new Date().toISOString();
            const initial = {
                version: 1,
                createdAt: now,
                updatedAt: now,
                settings: DEFAULT_SETTINGS,
                grants: [],
                audit: [],
            };
            await this.save(initial);
            return initial;
        }
    }
    async save(policy) {
        await fs.mkdir(appHome(), { recursive: true, mode: 0o700 });
        policy.updatedAt = new Date().toISOString();
        const file = policyPath();
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
        await fs.rename(tmp, file);
        await fs.chmod(file, 0o600).catch(() => undefined);
    }
    async update(mutator) {
        const policy = await this.load();
        await mutator(policy);
        await this.save(policy);
        return policy;
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
    async upsertGrant(grant) {
        await this.update((policy) => {
            const index = policy.grants.findIndex((item) => item.id === grant.id);
            if (index >= 0) {
                policy.grants[index] = grant;
            }
            else {
                policy.grants.push(grant);
            }
        });
        return grant;
    }
}
//# sourceMappingURL=state.js.map