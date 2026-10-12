import fs from "node:fs/promises";
import { withFileLock } from "./fileLock.js";
import { appHome, policyPath } from "./paths.js";
import { randomId } from "./cryptoBox.js";
import type { AuditEvent, PolicyFile, Settings } from "./types.js";

const DEFAULT_SETTINGS: Settings = {
  opPath: process.env.OP_PATH || "op",
  account: process.env.OP_ACCOUNT || "",
  adminHost: process.env.ADMIN_HOST || "127.0.0.1",
  adminPort: Number(process.env.ADMIN_PORT || 7319),
  clipboardClearSeconds: 20,
  autoPasteByDefault: true,
  allowPasteWithoutSite: false,
  allowAgentItemCreate: false,
  allowClipboardSave: false,
  autoApproveAgentItems: false,
  defaultVault: "",
  mcpVaultName: process.env.MCP_VAULT_NAME || "MCPVAULT",
};

export class StateStore {
  async load(): Promise<PolicyFile> {
    try {
      return await this.read();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return await this.update(() => {});
    }
  }

  private async read(initialize = false): Promise<PolicyFile> {
    const file = policyPath();
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as PolicyFile;
      const settings = { ...DEFAULT_SETTINGS, ...parsed.settings };
      settings.autoApproveAgentItems = settings.autoApproveAgentItems === true;
      settings.allowClipboardSave = settings.allowClipboardSave === true;
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      if (!initialize) throw error;
      const now = new Date().toISOString();
      const initial: PolicyFile = {
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

  private async save(policy: PolicyFile, assertOwned: () => void): Promise<void> {
    await fs.mkdir(appHome(), { recursive: true, mode: 0o700 });
    policy.updatedAt = new Date().toISOString();
    const file = policyPath();
    const tmp = `${file}.${randomId("write")}.tmp`;
    try {
      const handle = await fs.open(tmp, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(policy, null, 2)}\n`);
        await handle.sync();
      } finally { await handle.close(); }
      assertOwned();
      await fs.rename(tmp, file);
    } finally { await fs.rm(tmp, { force: true }); }
  }

  async update(mutator: (policy: PolicyFile) => void | Promise<void>): Promise<PolicyFile> {
    return await withFileLock(policyPath(), async (assertOwned) => {
      const policy = await this.read(true);
      await mutator(policy);
      await this.save(policy, assertOwned);
      return policy;
    });
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

}
