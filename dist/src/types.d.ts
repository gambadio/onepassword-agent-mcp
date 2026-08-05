export type SecretKind = "password" | "username" | "otp" | "custom";
export interface Settings {
    opPath: string;
    account: string;
    adminHost: string;
    adminPort: number;
    clipboardClearSeconds: number;
    autoPasteByDefault: boolean;
    allowPasteWithoutSite: boolean;
    defaultVault: string;
    mcpVaultName: string;
}
export interface Grant {
    id: string;
    title: string;
    username?: string;
    vaultId?: string;
    vaultName?: string;
    itemId?: string;
    itemTitle?: string;
    fieldLabel: string;
    kind: SecretKind;
    encryptedRef: string;
    sites: string[];
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
    note?: string;
}
export interface AuditEvent {
    id: string;
    type: "grant.created" | "grant.updated" | "grant.deleted" | "secret.copied" | "secret.pasted" | "secret.denied" | "settings.updated" | "vault.created" | "item.copied" | "item.moved" | "item.deleted";
    grantId?: string;
    site?: string;
    message: string;
    createdAt: string;
}
export interface PolicyFile {
    version: 1;
    createdAt: string;
    updatedAt: string;
    settings: Settings;
    grants: Grant[];
    audit: AuditEvent[];
}
export interface SecretHandlePayload {
    grantId: string;
    secretRef: string;
    kind: SecretKind;
    issuedAt: string;
}
export interface CandidatePayload {
    secretRef: string;
    title: string;
    username?: string;
    vaultId?: string;
    vaultName?: string;
    itemId?: string;
    itemTitle?: string;
    fieldLabel: string;
    kind: SecretKind;
    category?: string;
    sites: string[];
    issuedAt: string;
}
export interface Candidate {
    token: string;
    title: string;
    username?: string;
    vaultName?: string;
    itemTitle?: string;
    fieldLabel: string;
    kind: SecretKind;
    category?: string;
    sites: string[];
}
export interface CandidateSearchResult {
    items: Candidate[];
    total: number;
    matched: number;
    shown: number;
    query: string;
}
export interface PublicGrant {
    id: string;
    title: string;
    username?: string;
    vaultName?: string;
    itemTitle?: string;
    fieldLabel: string;
    kind: SecretKind;
    sites: string[];
    enabled: boolean;
    handle: string;
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
    note?: string;
}
export interface OpItemSummary {
    id: string;
    title: string;
    vault?: {
        id?: string;
        name?: string;
    };
    urls?: Array<{
        href?: string;
        primary?: boolean;
        label?: string;
    }>;
    url?: string;
    category?: string;
}
export interface OpVaultSummary {
    id?: string;
    name?: string;
    items?: number;
}
