import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadOrCreateKey } from "./cryptoBox.js";
import { OpCli } from "./opCli.js";
import { clearClipboard, pasteFromClipboard, setClipboard } from "./paste.js";
import { PolicyService } from "./policy.js";
import { StateStore } from "./state.js";
function textResponse(text) {
    return { content: [{ type: "text", text }] };
}
function jsonResponse(value) {
    return textResponse(JSON.stringify(value, null, 2));
}
export function createMcpServer() {
    const server = new McpServer({
        name: "onepassword-agent-mcp",
        version: "0.2.4",
    });
    const policy = new PolicyService();
    const store = new StateStore();
    server.registerTool("onepassword_status", {
        title: "1Password MCP Status",
        description: "Check local policy and 1Password CLI status. Never returns secrets.",
        inputSchema: {},
    }, async () => {
        const file = await store.load();
        const op = new OpCli(file.settings);
        const grants = await policy.listPublicGrants();
        let cli;
        try {
            const version = await op.version();
            let mcpVaultVisible = false;
            let authenticated = false;
            let authError = null;
            try {
                const vaults = await op.listVaults();
                authenticated = true;
                const expected = file.settings.mcpVaultName.trim().toLowerCase();
                mcpVaultVisible = vaults.some((vault) => {
                    return vault.name?.trim().toLowerCase() === expected || vault.id?.trim().toLowerCase() === expected;
                });
            }
            catch (error) {
                authError = error.message;
            }
            cli = {
                installed: true,
                authenticated,
                version,
                mcpVaultVisible,
                authError,
            };
        }
        catch (error) {
            cli = { installed: false, authenticated: false, error: error.message };
        }
        return jsonResponse({
            grants: grants.length,
            enabledGrants: grants.filter((grant) => grant.enabled).length,
            settings: {
                account: file.settings.account || null,
                mcpVaultName: file.settings.mcpVaultName,
                allowPasteWithoutSite: file.settings.allowPasteWithoutSite,
                clipboardClearSeconds: file.settings.clipboardClearSeconds,
            },
            cli,
        });
    });
    server.registerTool("find_passwords_for_site", {
        title: "Find Approved Passwords For Site",
        description: "Return approved encrypted password handles for a website. The handle is opaque and does not contain plaintext for the model.",
        inputSchema: {
            site: z.string().describe("Current website or origin, for example https://github.com/login"),
        },
    }, async ({ site }) => {
        const grants = await policy.findForSite(site);
        return jsonResponse({
            site,
            matches: grants.map((grant) => ({
                id: grant.id,
                title: grant.title,
                username: grant.username,
                sites: grant.sites,
                encryptedPasswordHandle: grant.handle,
                fieldLabel: grant.fieldLabel,
            })),
        });
    });
    server.registerTool("list_approved_passwords", {
        title: "List Approved Passwords",
        description: "List locally approved password handles and allowed sites. Does not return plaintext passwords.",
        inputSchema: {},
    }, async () => {
        const grants = await policy.listPublicGrants();
        return jsonResponse({
            grants: grants
                .filter((grant) => grant.enabled)
                .map((grant) => ({
                id: grant.id,
                title: grant.title,
                username: grant.username,
                sites: grant.sites,
                encryptedPasswordHandle: grant.handle,
                fieldLabel: grant.fieldLabel,
            })),
        });
    });
    server.registerTool("copy_password", {
        title: "Copy Approved Password",
        description: "Resolve an encrypted password handle at the last moment, copy the password to the OS clipboard, and return no plaintext.",
        inputSchema: {
            encryptedPasswordHandle: z.string().describe("Opaque handle returned by find_passwords_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedPasswordHandle, expectedSite, clearAfterSeconds }) => {
        const file = await store.load();
        const { grant, secretRef } = await policy.resolveHandle(encryptedPasswordHandle, expectedSite);
        const secret = await new OpCli(file.settings).readSecret(secretRef);
        await setClipboard(secret, clearAfterSeconds || file.settings.clipboardClearSeconds);
        await policy.markUsed(grant.id, "secret.copied", expectedSite);
        return textResponse(`Password for "${grant.title}" copied to clipboard and scheduled to clear. Plaintext was not returned.`);
    });
    server.registerTool("paste_password", {
        title: "Paste Approved Password",
        description: "Resolve an encrypted password handle, copy it to the clipboard, paste into the active app, and return no plaintext.",
        inputSchema: {
            encryptedPasswordHandle: z.string().describe("Opaque handle returned by find_passwords_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedPasswordHandle, expectedSite, clearAfterSeconds }) => {
        const file = await store.load();
        const { grant, secretRef } = await policy.resolveHandle(encryptedPasswordHandle, expectedSite);
        const secret = await new OpCli(file.settings).readSecret(secretRef);
        await setClipboard(secret, clearAfterSeconds || file.settings.clipboardClearSeconds);
        await pasteFromClipboard();
        await policy.markUsed(grant.id, "secret.pasted", expectedSite);
        return textResponse(`Password for "${grant.title}" pasted into the active app. Plaintext was not returned.`);
    });
    server.registerTool("clear_password_clipboard", {
        title: "Clear Password Clipboard",
        description: "Clear the OS clipboard after a copy/paste password operation.",
        inputSchema: {},
    }, async () => {
        await clearClipboard();
        return textResponse("Clipboard cleared.");
    });
    server.registerTool("admin_ui_info", {
        title: "Admin UI Info",
        description: "Return the local admin UI URL and state path. Does not return secrets.",
        inputSchema: {},
    }, async () => {
        const file = await store.load();
        await loadOrCreateKey();
        return jsonResponse({
            url: `http://${file.settings.adminHost}:${file.settings.adminPort}`,
            note: "Use the local UI to approve which 1Password items AI agents can use.",
        });
    });
    return server;
}
//# sourceMappingURL=mcpTools.js.map