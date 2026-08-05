import fs from "node:fs/promises";
import path from "node:path";
import { appHome, policyPath } from "./paths.js";
import { randomId } from "./cryptoBox.js";
import type { AuditEvent, Grant, PolicyFile, Settings } from "./types.js";

const DEFAULT_SETTINGS: Settings = {
  opPath: process.env.OP_PATH || "op",
  account: process.env.OP_ACCOUNT || "",
  adminHost: process.env.ADMIN_HOST || "127.0.0.1",
  adminPort: Number(process.env.ADMIN_PORT || 7319),
  clipboardClearSeconds: 20,
  autoPasteByDefault: true,
  allowPasteWithoutSite: false,
  defaultVault: "",
  mcpVaultName: process.env.MCP_VAULT_NAME || "MCPVAULT",
};

export class StateStore {
  async load(): Promise<PolicyFile> {
    const file = policyPath();
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as PolicyFile;
      const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
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
        audit: parsed.audit || [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const now = new Date().toISOString();
      const initial: PolicyFile = {
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

  async save(policy: PolicyFile): Promise<void> {
    await fs.mkdir(appHome(), { recursive: true, mode: 0o700 });
    policy.updatedAt = new Date().toISOString();
    const file = policyPath();
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, file);
    await fs.chmod(file, 0o600).catch(() => undefined);
  }

  async update(mutator: (policy: PolicyFile) => void | Promise<void>): Promise<PolicyFile> {
    const policy = await this.load();
    await mutator(policy);
    await this.save(policy);
    return policy;
  }

  async addAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void> {
    await this.update((policy) => {
      policy.audit.unshift({
        id: randomId("audit"),
        createdAt: new Date().toISOString(),
        ...event,
      });
      policy.audit = policy.audit.slice(0, 200);
    });
  }

  async upsertGrant(grant: Grant): Promise<Grant> {
    await this.update((policy) => {
      const index = policy.grants.findIndex((item) => item.id === grant.id);
      if (index >= 0) {
        policy.grants[index] = grant;
      } else {
        policy.grants.push(grant);
      }
    });
    return grant;
  }
}
