import { spawn } from "node:child_process";
import { sealJson } from "./cryptoBox.js";
import { formatSites } from "./siteMatch.js";
export class OpCli {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    async version() {
        const result = await this.run(["--version"], { timeoutMs: 8_000 });
        return result.stdout.trim();
    }
    async whoami() {
        const result = await this.run(["whoami", "--format", "json"], { timeoutMs: 15_000 });
        const text = result.stdout.trim();
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            return { raw: text };
        }
    }
    async listVaults() {
        const result = await this.run(["vault", "list", "--format", "json"], { timeoutMs: 30_000 });
        return JSON.parse(result.stdout || "[]");
    }
    async createVault(name) {
        const result = await this.run([
            "vault",
            "create",
            name,
            "--description",
            "Vault used by 1Password Agent MCP for agent-approved login items.",
        ], { timeoutMs: 45_000 });
        const text = result.stdout.trim();
        if (!text)
            return { name };
        try {
            const created = JSON.parse(text);
            return { name, ...created };
        }
        catch {
            return { name };
        }
    }
    async copyItemToVault(input) {
        await this.pipeOp(["item", "get", input.itemId, "--vault", input.currentVault, "--format", "json"], ["item", "create", "--vault", input.destinationVault, "-"], 90_000);
    }
    async moveItemToVault(input) {
        await this.run([
            "item",
            "move",
            input.itemId,
            "--current-vault",
            input.currentVault,
            "--destination-vault",
            input.destinationVault,
        ], { timeoutMs: 60_000 });
    }
    async readSecret(secretRef) {
        const result = await this.run(["read", "--no-newline", secretRef], { timeoutMs: 30_000 });
        return result.stdout;
    }
    async listCandidates(options) {
        const vault = options.vault || this.settings.defaultVault;
        const limit = Math.max(1, Math.min(options.limit || 100, 500));
        const query = (options.query || "").trim().toLowerCase();
        const args = [
            "item",
            "list",
            "--categories",
            "Login,Password",
            "--long",
            "--format",
            "json",
        ];
        if (vault)
            args.push("--vault", vault);
        const result = await this.run(args, { timeoutMs: 60_000 });
        const items = JSON.parse(result.stdout || "[]");
        const matchedItems = query ? items.filter((item) => itemMatchesQuery(item, query)) : items;
        const candidates = matchedItems
            .slice(0, limit)
            .map((item) => this.itemToCandidate(item, options.key, vault));
        return {
            items: candidates,
            total: items.length,
            matched: matchedItems.length,
            shown: candidates.length,
            query,
        };
    }
    itemToCandidate(item, key, fallbackVault) {
        const vaultId = item.vault?.id;
        const vaultName = item.vault?.name;
        const vaultRef = vaultId || vaultName || fallbackVault || this.settings.defaultVault;
        if (!vaultRef) {
            throw new Error("1Password did not return vault information. Set a default vault or enter a vault before loading items.");
        }
        const itemRef = item.id || item.title;
        const fieldLabel = "password";
        const secretRef = `op://${vaultRef}/${itemRef}/${fieldLabel}`;
        const sites = extractSites(item);
        const payload = {
            secretRef,
            title: item.title,
            vaultId,
            vaultName,
            itemId: item.id,
            itemTitle: item.title,
            fieldLabel,
            kind: "password",
            sites,
            issuedAt: new Date().toISOString(),
        };
        return {
            token: sealJson(payload, key),
            title: item.title,
            vaultName,
            itemTitle: item.title,
            fieldLabel,
            kind: "password",
            sites,
        };
    }
    async run(args, options = {}) {
        const finalArgs = this.withGlobalArgs(args);
        const child = spawn(this.settings.opPath || "op", finalArgs, {
            stdio: ["pipe", "pipe", "pipe"],
            env: this.opEnv(),
        });
        if (options.input) {
            child.stdin.write(options.input);
        }
        child.stdin.end();
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk;
        });
        const timeout = setTimeout(() => {
            child.kill("SIGTERM");
        }, options.timeoutMs || 30_000);
        return await new Promise((resolve, reject) => {
            child.on("error", (error) => {
                clearTimeout(timeout);
                reject(new Error(`Unable to run 1Password CLI at "${this.settings.opPath}": ${error.message}`));
            });
            child.on("close", (code, signal) => {
                clearTimeout(timeout);
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }
                const detail = stderr.trim() || stdout.trim() || `signal ${signal || "unknown"}`;
                reject(new Error(`1Password CLI failed (${code ?? "no code"}): ${detail}`));
            });
        });
    }
    withGlobalArgs(args) {
        if (!this.settings.account)
            return args;
        if (args.includes("--account"))
            return args;
        return ["--account", this.settings.account, ...args];
    }
    async pipeOp(sourceArgs, destinationArgs, timeoutMs) {
        const source = spawn(this.settings.opPath || "op", this.withGlobalArgs(sourceArgs), {
            stdio: ["ignore", "pipe", "pipe"],
            env: this.opEnv(),
        });
        const destination = spawn(this.settings.opPath || "op", this.withGlobalArgs(destinationArgs), {
            stdio: ["pipe", "ignore", "pipe"],
            env: this.opEnv(),
        });
        source.stdout.pipe(destination.stdin);
        let sourceStderr = "";
        let destinationStderr = "";
        source.stderr.setEncoding("utf8");
        destination.stderr.setEncoding("utf8");
        source.stderr.on("data", (chunk) => {
            sourceStderr += chunk;
        });
        destination.stderr.on("data", (chunk) => {
            destinationStderr += chunk;
        });
        const timeout = setTimeout(() => {
            source.kill("SIGTERM");
            destination.kill("SIGTERM");
        }, timeoutMs);
        await Promise.all([
            waitForChild(source, "1Password item read", () => sourceStderr),
            waitForChild(destination, "1Password item create", () => destinationStderr),
        ]).finally(() => {
            clearTimeout(timeout);
        });
    }
    opEnv() {
        return {
            ...process.env,
            OP_FORMAT: "json",
            OP_ACCOUNT: this.settings.account || process.env.OP_ACCOUNT,
        };
    }
}
function waitForChild(child, label, stderr) {
    return new Promise((resolve, reject) => {
        child.on("error", (error) => {
            reject(new Error(`${label} failed to start: ${error.message}`));
        });
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            const detail = stderr().trim() || `signal ${signal || "unknown"}`;
            reject(new Error(`${label} failed (${code ?? "no code"}): ${detail}`));
        });
    });
}
function extractSites(item) {
    const raw = [
        item.url,
        ...(item.urls || []).map((entry) => entry.href),
    ].filter((value) => Boolean(value));
    return formatSites(raw);
}
function itemMatchesQuery(item, query) {
    const haystack = [
        item.title,
        item.category,
        item.vault?.name,
        item.vault?.id,
        item.url,
        ...(item.urls || []).flatMap((entry) => [entry.href, entry.label]),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return query
        .split(/\s+/)
        .filter(Boolean)
        .every((part) => haystack.includes(part));
}
//# sourceMappingURL=opCli.js.map