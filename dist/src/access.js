import fs from "node:fs/promises";
import path from "node:path";
import { loadOrCreateKey, openJson, randomId, sealJson } from "./cryptoBox.js";
import { withFileLock } from "./fileLock.js";
import { appHome } from "./paths.js";
// Credentials live separately from policy: settings and status can never serialize them.
export class AccessStore {
    environment;
    constructor(environment = process.env) {
        this.environment = environment;
    }
    get file() { return path.join(appHome(), "access.json"); }
    async read() {
        try {
            const value = JSON.parse(await fs.readFile(this.file, "utf8"));
            if (value.version !== 1 || typeof value.enabled !== "boolean" || typeof value.encryptedToken !== "string") {
                throw new Error();
            }
            return value;
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw new Error("Unable to read saved service-account configuration. Replace or remove it in Permissions.");
        }
    }
    async status() {
        if (this.environment.OP_SERVICE_ACCOUNT_TOKEN) {
            return { mode: "environment", configured: true, enabled: true, source: "environment" };
        }
        const saved = await this.read();
        return { mode: saved?.enabled ? "service_account" : "desktop", configured: !!saved,
            enabled: saved?.enabled === true, source: saved ? "local" : "none" };
    }
    async token() {
        if (this.environment.OP_SERVICE_ACCOUNT_TOKEN) {
            validateToken(this.environment.OP_SERVICE_ACCOUNT_TOKEN);
            return this.environment.OP_SERVICE_ACCOUNT_TOKEN;
        }
        const saved = await this.read();
        if (!saved?.enabled)
            return undefined;
        try {
            const { token } = openJson(saved.encryptedToken, await loadOrCreateKey());
            validateToken(token);
            return token;
        }
        catch {
            // Do not silently fall back to a more privileged desktop account.
            throw new Error("Unable to read saved service-account credential. Replace or remove it in Permissions.");
        }
    }
    async save(token) {
        validateToken(token);
        await withFileLock(this.file, async (assertOwned) => {
            await this.write({ version: 1, enabled: true, encryptedToken: sealJson({ token }, await loadOrCreateKey()) }, assertOwned);
        });
        return this.status();
    }
    async setEnabled(enabled) {
        await withFileLock(this.file, async (assertOwned) => {
            const saved = await this.read();
            if (!saved)
                throw new Error("Save a service-account token before enabling unattended access.");
            await this.write({ ...saved, enabled }, assertOwned);
        });
        return this.status();
    }
    async remove() {
        await withFileLock(this.file, async (assertOwned) => {
            assertOwned();
            await fs.rm(this.file, { force: true });
        });
        return this.status();
    }
    async write(value, assertOwned) {
        const temporary = `${this.file}.${randomId("write")}.tmp`;
        try {
            const handle = await fs.open(temporary, "wx", 0o600);
            try {
                await handle.writeFile(JSON.stringify(value) + "\n");
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            assertOwned();
            await fs.rename(temporary, this.file);
        }
        finally {
            await fs.rm(temporary, { force: true });
        }
    }
}
function validateToken(token) {
    if (typeof token !== "string" || !/^ops_\S{16,16380}$/.test(token) || /[\u0000-\u0020\u007f-\u009f]/.test(token)) {
        throw new Error("Enter a valid 1Password service-account token beginning with ops_ and containing no whitespace.");
    }
}
//# sourceMappingURL=access.js.map