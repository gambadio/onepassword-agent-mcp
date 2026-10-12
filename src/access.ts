import fs from "node:fs/promises";
import path from "node:path";
import { loadOrCreateKey, openJson, randomId, sealJson } from "./cryptoBox.js";
import { withFileLock } from "./fileLock.js";
import { appHome } from "./paths.js";

interface AccessFile {
  version: 1;
  enabled: boolean;
  encryptedToken: string;
}

export interface AccessStatus {
  mode: "desktop" | "service_account" | "environment";
  configured: boolean;
  enabled: boolean;
  source: "local" | "environment" | "none";
}

// Credentials live separately from policy: settings and status can never serialize them.
export class AccessStore {
  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {}

  private get file(): string { return path.join(appHome(), "access.json"); }

  private async read(): Promise<AccessFile | undefined> {
    try {
      const value = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (value.version !== 1 || typeof value.enabled !== "boolean" || typeof value.encryptedToken !== "string") {
        throw new Error();
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error("Unable to read saved service-account configuration. Replace or remove it in Permissions.");
    }
  }

  async status(): Promise<AccessStatus> {
    if (this.environment.OP_SERVICE_ACCOUNT_TOKEN) {
      return { mode: "environment", configured: true, enabled: true, source: "environment" };
    }
    const saved = await this.read();
    return { mode: saved?.enabled ? "service_account" : "desktop", configured: !!saved,
      enabled: saved?.enabled === true, source: saved ? "local" : "none" };
  }

  async token(): Promise<string | undefined> {
    if (this.environment.OP_SERVICE_ACCOUNT_TOKEN) {
      validateToken(this.environment.OP_SERVICE_ACCOUNT_TOKEN);
      return this.environment.OP_SERVICE_ACCOUNT_TOKEN;
    }
    const saved = await this.read();
    if (!saved?.enabled) return undefined;
    try {
      const { token } = openJson<{ token: string }>(saved.encryptedToken, await loadOrCreateKey());
      validateToken(token);
      return token;
    } catch {
      // Do not silently fall back to a more privileged desktop account.
      throw new Error("Unable to read saved service-account credential. Replace or remove it in Permissions.");
    }
  }

  async save(token: string): Promise<AccessStatus> {
    validateToken(token);
    await withFileLock(this.file, async assertOwned => {
      await this.write({ version: 1, enabled: true, encryptedToken: sealJson({ token }, await loadOrCreateKey()) }, assertOwned);
    });
    return this.status();
  }

  async setEnabled(enabled: boolean): Promise<AccessStatus> {
    await withFileLock(this.file, async assertOwned => {
      const saved = await this.read();
      if (!saved) throw new Error("Save a service-account token before enabling unattended access.");
      await this.write({ ...saved, enabled }, assertOwned);
    });
    return this.status();
  }

  async remove(): Promise<AccessStatus> {
    await withFileLock(this.file, async assertOwned => {
      assertOwned();
      await fs.rm(this.file, { force: true });
    });
    return this.status();
  }

  private async write(value: AccessFile, assertOwned: () => void): Promise<void> {
    const temporary = `${this.file}.${randomId("write")}.tmp`;
    try {
      const handle = await fs.open(temporary, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(value) + "\n"); await handle.sync(); }
      finally { await handle.close(); }
      assertOwned();
      await fs.rename(temporary, this.file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
}

function validateToken(token: unknown): asserts token is string {
  if (typeof token !== "string" || !/^ops_\S{16,16380}$/.test(token) || /[\u0000-\u0020\u007f-\u009f]/.test(token)) {
    throw new Error("Enter a valid 1Password service-account token beginning with ops_ and containing no whitespace.");
  }
}
