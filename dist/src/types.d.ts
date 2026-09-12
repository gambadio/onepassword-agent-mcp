export type SecretKind = "password" | "username" | "otp" | "api_credential" | "credit_card_name" | "credit_card_number" | "credit_card_cvv" | "credit_card_pin" | "credit_card_expiry" | "secure_note" | "ssh_private_key" | "license_key" | "text" | "custom";
export type CandidateMode = "primary" | "all";
export type CandidateGroup = "all" | "login" | "api" | "card" | "note" | "other";
export type CreateSecretCategory = "login" | "password" | "api_credential" | "secure_note" | "credit_card";
export type ProfileKind = "name" | "email" | "phone" | "address" | "company" | "username" | "custom";
export interface Settings {
    opPath: string;
    account: string;
    adminHost: string;
    adminPort: number;
    clipboardClearSeconds: number;
    autoPasteByDefault: boolean;
    allowPasteWithoutSite: boolean;
    allowAgentItemCreate: boolean;
    autoApproveAgentItems: boolean;
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
export interface ProfileEntry {
    id: string;
    label: string;
    kind: ProfileKind;
    value: string;
    sites: string[];
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    note?: string;
}
export interface AuditEvent {
    id: string;
    type: "grant.created" | "grant.updated" | "grant.deleted" | "secret.copied" | "secret.pasted" | "secret.denied" | "settings.updated" | "vault.created" | "item.copied" | "item.moved" | "item.deleted" | "item.saved" | "profile.created" | "profile.updated" | "profile.deleted" | "profile.read";
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
    profile: ProfileEntry[];
    audit: AuditEvent[];
    operations?: SaveOperation[];
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
    fieldId?: string;
    fieldType?: string;
    fieldPurpose?: string;
    kind: SecretKind;
    category?: string;
    sites: string[];
    issuedAt: string;
}
export interface Candidate {
    token: string;
    title: string;
    username?: string;
    vaultId?: string;
    vaultName?: string;
    itemId?: string;
    itemTitle?: string;
    fieldLabel: string;
    fieldId?: string;
    fieldType?: string;
    fieldPurpose?: string;
    kind: SecretKind;
    category?: string;
    sites: string[];
}
export interface CandidateSearchResult {
    items: Candidate[];
    failedItems?: number;
    loadedItems?: number;
    limited?: boolean;
    total: number;
    matched: number;
    shown: number;
    query: string;
    activeGroup: CandidateGroup;
    groups: Record<CandidateGroup, number>;
}
export interface PublicGrant {
    id: string;
    title: string;
    username?: string;
    vaultId?: string;
    vaultName?: string;
    itemId?: string;
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
export interface OpItemField {
    id?: string;
    type?: string;
    purpose?: string;
    label?: string;
    value?: unknown;
    reference?: string;
    section?: {
        id?: string;
        label?: string;
    };
}
export interface OpItemDetail extends OpItemSummary {
    fields?: OpItemField[];
    sections?: Array<{
        id: string;
        label?: string;
    }>;
    tags?: string[];
    files?: unknown[];
}
export interface OpVaultSummary {
    id?: string;
    name?: string;
    items?: number;
}
export interface CreateSecretItemInput {
    requestId?: string;
    vault: string;
    title: string;
    category: CreateSecretCategory;
    url?: string;
    username?: string;
    password?: string;
    credential?: string;
    hostname?: string;
    notes?: string;
    cardholderName?: string;
    cardNumber?: string;
    verificationNumber?: string;
    expiry?: string;
    pin?: string;
}
export interface SaveOperation {
    id: string;
    fingerprint: string;
    vaultId: string;
    itemId?: string;
    created: boolean | "unknown";
    verified: boolean;
    autoApproveRequested?: boolean;
    approvalStatus: "not_requested" | "pending" | "approved" | "failed";
    approvalId?: string;
    approvalIds?: string[];
    auditRecorded?: boolean;
    startedAt: string;
}
