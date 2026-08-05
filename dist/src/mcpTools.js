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
        version: "0.2.11",
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
            profileFields: file.profile.filter((entry) => entry.enabled).length,
            settings: {
                account: file.settings.account || null,
                mcpVaultName: file.settings.mcpVaultName,
                allowPasteWithoutSite: file.settings.allowPasteWithoutSite,
                allowAgentItemCreate: file.settings.allowAgentItemCreate,
                clipboardClearSeconds: file.settings.clipboardClearSeconds,
            },
            cli,
        });
    });
    const findSecrets = async (site) => {
        const grants = await policy.findForSite(site);
        return jsonResponse({
            site,
            matches: grants.map(publicSecretGrant),
        });
    };
    server.registerTool("find_secrets_for_site", {
        title: "Find Approved Secrets For Site",
        description: "Return approved encrypted handles for a website. Handles can represent passwords, API credentials, credit-card fields, secure notes, or other approved 1Password fields. Plaintext is never returned.",
        inputSchema: {
            site: z.string().describe("Current website or origin, for example https://github.com/login"),
        },
    }, async ({ site }) => await findSecrets(site));
    server.registerTool("find_passwords_for_site", {
        title: "Find Approved Passwords For Site",
        description: "Compatibility alias for find_secrets_for_site. Returns approved encrypted handles and never returns plaintext.",
        inputSchema: {
            site: z.string().describe("Current website or origin, for example https://github.com/login"),
        },
    }, async ({ site }) => await findSecrets(site));
    const listSecrets = async () => {
        const grants = await policy.listPublicGrants();
        return jsonResponse({
            grants: grants
                .filter((grant) => grant.enabled)
                .map(publicSecretGrant),
        });
    };
    server.registerTool("list_approved_secrets", {
        title: "List Approved Secrets",
        description: "List approved encrypted handles and allowed sites. Does not return plaintext secret values.",
        inputSchema: {},
    }, async () => await listSecrets());
    server.registerTool("list_approved_passwords", {
        title: "List Approved Passwords",
        description: "Compatibility alias for list_approved_secrets. Does not return plaintext secret values.",
        inputSchema: {},
    }, async () => await listSecrets());
    const copySecret = async (handle, expectedSite, clearAfterSeconds) => {
        const file = await store.load();
        const { grant, secretRef } = await policy.resolveHandle(handle, expectedSite);
        const secret = await new OpCli(file.settings).readSecret(secretRef);
        await setClipboard(secret, clearAfterSeconds || file.settings.clipboardClearSeconds);
        await policy.markUsed(grant.id, "secret.copied", expectedSite);
        return textResponse(`Secret field "${grant.fieldLabel}" for "${grant.itemTitle || grant.title}" copied to clipboard and scheduled to clear. Plaintext was not returned.`);
    };
    server.registerTool("copy_secret", {
        title: "Copy Approved Secret",
        description: "Resolve an encrypted secret handle at the last moment, copy the value to the OS clipboard, and return no plaintext.",
        inputSchema: {
            encryptedSecretHandle: z.string().describe("Opaque handle returned by find_secrets_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedSecretHandle, expectedSite, clearAfterSeconds }) => {
        return await copySecret(encryptedSecretHandle, expectedSite, clearAfterSeconds);
    });
    server.registerTool("copy_password", {
        title: "Copy Approved Password",
        description: "Compatibility alias for copy_secret. Resolves an encrypted handle, copies it to the clipboard, and returns no plaintext.",
        inputSchema: {
            encryptedPasswordHandle: z.string().describe("Opaque handle returned by find_passwords_for_site or find_secrets_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedPasswordHandle, expectedSite, clearAfterSeconds }) => {
        return await copySecret(encryptedPasswordHandle, expectedSite, clearAfterSeconds);
    });
    const pasteSecret = async (handle, expectedSite, clearAfterSeconds) => {
        const file = await store.load();
        const { grant, secretRef } = await policy.resolveHandle(handle, expectedSite);
        const secret = await new OpCli(file.settings).readSecret(secretRef);
        await setClipboard(secret, clearAfterSeconds || file.settings.clipboardClearSeconds);
        await pasteFromClipboard();
        await policy.markUsed(grant.id, "secret.pasted", expectedSite);
        return textResponse(`Secret field "${grant.fieldLabel}" for "${grant.itemTitle || grant.title}" pasted into the active app. Plaintext was not returned.`);
    };
    server.registerTool("paste_secret", {
        title: "Paste Approved Secret",
        description: "Resolve an encrypted secret handle, copy it to the clipboard, paste into the active app, and return no plaintext.",
        inputSchema: {
            encryptedSecretHandle: z.string().describe("Opaque handle returned by find_secrets_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedSecretHandle, expectedSite, clearAfterSeconds }) => {
        return await pasteSecret(encryptedSecretHandle, expectedSite, clearAfterSeconds);
    });
    server.registerTool("paste_password", {
        title: "Paste Approved Password",
        description: "Compatibility alias for paste_secret. Resolves an encrypted handle, pastes it into the active app, and returns no plaintext.",
        inputSchema: {
            encryptedPasswordHandle: z.string().describe("Opaque handle returned by find_passwords_for_site or find_secrets_for_site."),
            expectedSite: z.string().optional().describe("Current website/origin. Required unless local policy allows omission."),
            clearAfterSeconds: z.number().int().min(1).max(300).optional(),
        },
    }, async ({ encryptedPasswordHandle, expectedSite, clearAfterSeconds }) => {
        return await pasteSecret(encryptedPasswordHandle, expectedSite, clearAfterSeconds);
    });
    server.registerTool("clear_secret_clipboard", {
        title: "Clear Secret Clipboard",
        description: "Clear the OS clipboard after a copy/paste operation.",
        inputSchema: {},
    }, async () => {
        await clearClipboard();
        return textResponse("Clipboard cleared.");
    });
    server.registerTool("clear_password_clipboard", {
        title: "Clear Password Clipboard",
        description: "Clear the OS clipboard after a copy/paste password operation.",
        inputSchema: {},
    }, async () => {
        await clearClipboard();
        return textResponse("Clipboard cleared.");
    });
    server.registerTool("save_secret_item", {
        title: "Save Secret Item To 1Password",
        description: "Create a new item in the configured MCPVAULT. Use this when the user asks the agent to save a new password, API credential, secure note, or credit-card entry. Secret values are sent to the local 1Password CLI through stdin, not command arguments.",
        inputSchema: {
            title: z.string().min(1),
            category: z.enum(["login", "password", "api_credential", "secure_note", "credit_card"]).default("login"),
            url: z.string().optional(),
            username: z.string().optional(),
            password: z.string().optional(),
            credential: z.string().optional(),
            hostname: z.string().optional(),
            notes: z.string().optional(),
            cardholderName: z.string().optional(),
            cardNumber: z.string().optional(),
            verificationNumber: z.string().optional(),
            expiry: z.string().optional().describe("Credit-card expiry in 1Password MONTH_YEAR format such as 2028/09."),
            pin: z.string().optional(),
            approveForAgents: z.boolean().optional().describe("If true, create a local approval for the primary saved field."),
            allowedSites: z.array(z.string()).optional().describe("Allowed websites for the optional approval. Empty means all sites."),
            approveField: z.string().optional().describe("Optional field id, label, or kind to approve, such as password, credential, ccnum, or credit_card_number."),
        },
    }, async (input) => {
        const file = await store.load();
        if (!file.settings.allowAgentItemCreate) {
            throw new Error("Agent item creation is disabled in local settings.");
        }
        const op = new OpCli(file.settings);
        const vaults = await op.listVaults();
        const mcpVault = vaults.find((vault) => {
            const expected = file.settings.mcpVaultName.trim().toLowerCase();
            return vault.name?.trim().toLowerCase() === expected || vault.id?.trim().toLowerCase() === expected;
        });
        if (!mcpVault) {
            throw new Error(`Create ${file.settings.mcpVaultName} in the admin UI before agents save items.`);
        }
        const vault = mcpVault.id || mcpVault.name || file.settings.mcpVaultName;
        const created = await op.createSecretItem({
            vault,
            title: input.title,
            category: input.category,
            url: input.url,
            username: input.username,
            password: input.password,
            credential: input.credential,
            hostname: input.hostname,
            notes: input.notes,
            cardholderName: input.cardholderName,
            cardNumber: input.cardNumber,
            verificationNumber: input.verificationNumber,
            expiry: input.expiry,
            pin: input.pin,
        });
        await store.addAudit({
            type: "item.saved",
            message: `Agent saved ${created.title || input.title} into ${file.settings.mcpVaultName}.`,
        });
        let approval = null;
        if (input.approveForAgents) {
            const key = await loadOrCreateKey();
            const candidates = op.itemToCandidates(created, key, vault, "all");
            const selected = selectCandidateToApprove(candidates, input.approveField);
            if (!selected)
                throw new Error("The saved item does not have an approvable field.");
            approval = await policy.createFromCandidate(selected.token, {
                sites: input.allowedSites || [],
                enabled: true,
            });
        }
        return jsonResponse({
            ok: true,
            vault: file.settings.mcpVaultName,
            title: created.title || input.title,
            category: created.category || input.category,
            approved: Boolean(approval),
            approvedField: approval?.fieldLabel,
            note: "Secret values were saved to 1Password and were not returned.",
        });
    });
    server.registerTool("get_profile_data", {
        title: "Get Approved Profile Data",
        description: "Return user-defined profile data from the local admin page, such as email, phone, address, name, company, or username. This tool returns plaintext profile values that the user explicitly added for agent use.",
        inputSchema: {
            site: z.string().optional().describe("Current website/origin. If omitted, only all-sites profile fields are returned."),
            kinds: z.array(z.enum(["name", "email", "phone", "address", "company", "username", "custom"])).optional(),
        },
    }, async ({ site, kinds }) => {
        const entries = await policy.findProfileForSite(site);
        const allowedKinds = new Set(kinds || []);
        return jsonResponse({
            site: site || null,
            profile: entries
                .filter((entry) => !allowedKinds.size || allowedKinds.has(entry.kind))
                .map((entry) => ({
                id: entry.id,
                label: entry.label,
                kind: entry.kind,
                value: entry.value,
                sites: entry.sites,
                note: entry.note,
            })),
        });
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
function publicSecretGrant(grant) {
    return {
        id: grant.id,
        title: grant.title,
        itemTitle: grant.itemTitle,
        username: grant.username,
        sites: grant.sites,
        encryptedSecretHandle: grant.handle,
        encryptedPasswordHandle: grant.handle,
        fieldLabel: grant.fieldLabel,
        kind: grant.kind,
    };
}
function selectCandidateToApprove(candidates, selector) {
    if (!selector) {
        return candidates.find((candidate) => candidate.kind !== "username" && candidate.kind !== "text") || candidates[0];
    }
    const normalized = selector.trim().toLowerCase();
    return candidates.find((candidate) => {
        return [candidate.kind, candidate.fieldId, candidate.fieldLabel]
            .filter(Boolean)
            .map((value) => String(value).trim().toLowerCase())
            .includes(normalized);
    });
}
//# sourceMappingURL=mcpTools.js.map