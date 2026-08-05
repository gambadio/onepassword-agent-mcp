import { loadOrCreateKey, openJson, randomId, sealJson } from "./cryptoBox.js";
import { StateStore } from "./state.js";
import { siteMatches } from "./siteMatch.js";
import type {
  CandidatePayload,
  Grant,
  ProfileEntry,
  ProfileKind,
  PublicGrant,
  SecretHandlePayload,
  SecretKind,
} from "./types.js";

export class PolicyService {
  constructor(private readonly store = new StateStore()) {}

  async listPublicGrants(): Promise<PublicGrant[]> {
    const [policy, key] = await Promise.all([this.store.load(), loadOrCreateKey()]);
    return policy.grants.flatMap((grant) => {
      const saved = openJson<SecretHandlePayload>(grant.encryptedRef, key);
      if (!grantTargetsMcpVault(grant, policy.settings.mcpVaultName, saved.secretRef)) {
        return [];
      }
      return [this.toPublicGrant(grant, key, saved)];
    });
  }

  async findForSite(site: string): Promise<PublicGrant[]> {
    const grants = await this.listPublicGrants();
    return grants.filter((grant) => grant.enabled && siteMatches(grant.sites, site));
  }

  async listProfileEntries(): Promise<ProfileEntry[]> {
    const policy = await this.store.load();
    return policy.profile;
  }

  async findProfileForSite(site?: string): Promise<ProfileEntry[]> {
    const policy = await this.store.load();
    const entries = policy.profile.filter((entry) => {
      if (!entry.enabled) return false;
      if (site) return siteMatches(entry.sites, site);
      return entry.sites.length === 0;
    });
    if (entries.length) {
      await this.store.addAudit({
        type: "profile.read",
        site,
        message: `Returned ${entries.length} profile field${entries.length === 1 ? "" : "s"}${site ? ` for ${site}` : ""}.`,
      });
    }
    return entries;
  }

  async createProfileEntry(input: {
    label: string;
    kind: ProfileKind;
    value: string;
    sites: string[];
    enabled?: boolean;
    note?: string;
  }): Promise<ProfileEntry> {
    const now = new Date().toISOString();
    const entry: ProfileEntry = {
      id: randomId("profile"),
      label: input.label,
      kind: input.kind,
      value: input.value,
      sites: input.sites,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      note: input.note,
    };
    await this.store.update((policy) => {
      policy.profile.push(entry);
      policy.audit.unshift({
        id: randomId("audit"),
        type: "profile.created",
        message: `Created profile field ${entry.label}`,
        createdAt: now,
      });
      policy.audit = policy.audit.slice(0, 200);
    });
    return entry;
  }

  async updateProfileEntry(id: string, patch: Partial<Omit<ProfileEntry, "id" | "createdAt">>): Promise<ProfileEntry> {
    let updated: ProfileEntry | undefined;
    await this.store.update((policy) => {
      const entry = policy.profile.find((item) => item.id === id);
      if (!entry) throw new Error(`Profile field not found: ${id}`);
      updated = {
        ...entry,
        ...patch,
        sites: patch.sites ?? entry.sites,
        updatedAt: new Date().toISOString(),
      };
      policy.profile = policy.profile.map((item) => (item.id === id ? updated as ProfileEntry : item));
      policy.audit.unshift({
        id: randomId("audit"),
        type: "profile.updated",
        message: `Updated profile field ${updated.label}`,
        createdAt: new Date().toISOString(),
      });
      policy.audit = policy.audit.slice(0, 200);
    });
    return updated as ProfileEntry;
  }

  async deleteProfileEntry(id: string): Promise<void> {
    await this.store.update((policy) => {
      const entry = policy.profile.find((item) => item.id === id);
      policy.profile = policy.profile.filter((item) => item.id !== id);
      policy.audit.unshift({
        id: randomId("audit"),
        type: "profile.deleted",
        message: entry ? `Deleted profile field ${entry.label}` : `Deleted profile field ${id}`,
        createdAt: new Date().toISOString(),
      });
      policy.audit = policy.audit.slice(0, 200);
    });
  }

  async createFromCandidate(candidateToken: string, overrides: Partial<Grant>): Promise<Grant> {
    const key = await loadOrCreateKey();
    const candidate = openJson<CandidatePayload>(candidateToken, key);
    return await this.createGrant({
      title: overrides.title || candidate.title,
      username: overrides.username ?? candidate.username,
      vaultId: candidate.vaultId,
      vaultName: candidate.vaultName,
      itemId: candidate.itemId,
      itemTitle: candidate.itemTitle,
      fieldLabel: overrides.fieldLabel || candidate.fieldLabel,
      kind: overrides.kind || candidate.kind,
      sites: overrides.sites !== undefined ? overrides.sites : candidate.sites,
      enabled: overrides.enabled ?? true,
      note: overrides.note,
      secretRef: candidate.secretRef,
    });
  }

  async createManual(input: {
    title: string;
    secretRef: string;
    sites: string[];
    username?: string;
    fieldLabel?: string;
    kind?: SecretKind;
    note?: string;
    enabled?: boolean;
  }): Promise<Grant> {
    return await this.createGrant({
      title: input.title,
      secretRef: input.secretRef,
      sites: input.sites,
      username: input.username,
      fieldLabel: input.fieldLabel || "password",
      kind: input.kind || "password",
      note: input.note,
      enabled: input.enabled ?? true,
    });
  }

  async updateGrant(id: string, patch: Partial<Omit<Grant, "id" | "encryptedRef" | "createdAt">>): Promise<Grant> {
    let updated: Grant | undefined;
    await this.store.update((policy) => {
      const grant = policy.grants.find((item) => item.id === id);
      if (!grant) throw new Error(`Grant not found: ${id}`);
      updated = {
        ...grant,
        ...patch,
        sites: patch.sites ?? grant.sites,
        updatedAt: new Date().toISOString(),
      };
      policy.grants = policy.grants.map((item) => (item.id === id ? updated as Grant : item));
      policy.audit.unshift({
        id: randomId("audit"),
        type: "grant.updated",
        grantId: id,
        message: `Updated grant ${updated.title}`,
        createdAt: new Date().toISOString(),
      });
      policy.audit = policy.audit.slice(0, 200);
    });
    return updated as Grant;
  }

  async deleteGrant(id: string): Promise<void> {
    await this.store.update((policy) => {
      const grant = policy.grants.find((item) => item.id === id);
      policy.grants = policy.grants.filter((item) => item.id !== id);
      policy.audit.unshift({
        id: randomId("audit"),
        type: "grant.deleted",
        grantId: id,
        message: grant ? `Deleted grant ${grant.title}` : `Deleted grant ${id}`,
        createdAt: new Date().toISOString(),
      });
      policy.audit = policy.audit.slice(0, 200);
    });
  }

  async deleteGrantsForItem(itemId: string, vaultId?: string, vaultName?: string): Promise<number> {
    let removed = 0;
    await this.store.update((policy) => {
      const matches = policy.grants.filter((grant) => {
        if (grant.itemId !== itemId) return false;
        if (vaultId && grant.vaultId && grant.vaultId !== vaultId) return false;
        if (vaultName && grant.vaultName && grant.vaultName !== vaultName) return false;
        return true;
      });
      removed = matches.length;
      if (!removed) return;
      policy.grants = policy.grants.filter((grant) => !matches.includes(grant));
      for (const grant of matches) {
        policy.audit.unshift({
          id: randomId("audit"),
          type: "grant.deleted",
          grantId: grant.id,
          message: `Deleted grant ${grant.title} because the 1Password item was deleted.`,
          createdAt: new Date().toISOString(),
        });
      }
      policy.audit = policy.audit.slice(0, 200);
    });
    return removed;
  }

  async resolveHandle(handle: string, expectedSite?: string): Promise<{ grant: Grant; secretRef: string }> {
    const [policy, key] = await Promise.all([this.store.load(), loadOrCreateKey()]);
    const payload = openJson<SecretHandlePayload>(handle, key);
    const grant = policy.grants.find((item) => item.id === payload.grantId);
    if (!grant) {
      await this.store.addAudit({
        type: "secret.denied",
        site: expectedSite,
        message: "Denied paste for missing grant.",
      });
      throw new Error("This secret handle no longer exists.");
    }
    if (!grant.enabled) {
      await this.store.addAudit({
        type: "secret.denied",
        grantId: grant.id,
        site: expectedSite,
        message: `Denied paste for disabled grant ${grant.title}.`,
      });
      throw new Error("This secret is disabled in the local policy.");
    }
    const savedRef = openJson<SecretHandlePayload>(grant.encryptedRef, key);
    if (savedRef.secretRef !== payload.secretRef || savedRef.kind !== payload.kind) {
      throw new Error("This secret handle does not match the saved policy.");
    }
    if (!grantTargetsMcpVault(grant, policy.settings.mcpVaultName, savedRef.secretRef)) {
      await this.store.addAudit({
        type: "secret.denied",
        grantId: grant.id,
        site: expectedSite,
        message: `Denied paste for ${grant.title}: item is outside ${policy.settings.mcpVaultName}.`,
      });
      throw new Error(`This approval is outside ${policy.settings.mcpVaultName}.`);
    }
    if (expectedSite) {
      if (grant.sites.length && !siteMatches(grant.sites, expectedSite)) {
        await this.store.addAudit({
          type: "secret.denied",
          grantId: grant.id,
          site: expectedSite,
          message: `Denied paste for ${grant.title}: site not allowed.`,
        });
        throw new Error(`Site is not allowed for ${grant.title}.`);
      }
    } else if (!policy.settings.allowPasteWithoutSite) {
      throw new Error("expectedSite is required by policy.");
    }
    return { grant, secretRef: payload.secretRef };
  }

  async markUsed(grantId: string, type: "secret.copied" | "secret.pasted", site?: string): Promise<void> {
    await this.store.update((policy) => {
      const grant = policy.grants.find((item) => item.id === grantId);
      if (grant) {
        grant.lastUsedAt = new Date().toISOString();
        grant.updatedAt = new Date().toISOString();
      }
      policy.audit.unshift({
        id: randomId("audit"),
        type,
        grantId,
        site,
        message: `${type === "secret.pasted" ? "Pasted" : "Copied"} approved secret${site ? ` for ${site}` : ""}.`,
        createdAt: new Date().toISOString(),
      });
      policy.audit = policy.audit.slice(0, 200);
    });
  }

  private async createGrant(input: {
    title: string;
    secretRef: string;
    sites: string[];
    username?: string;
    vaultId?: string;
    vaultName?: string;
    itemId?: string;
    itemTitle?: string;
    fieldLabel: string;
    kind: SecretKind;
    note?: string;
    enabled: boolean;
  }): Promise<Grant> {
    if (!input.secretRef.startsWith("op://")) {
      throw new Error("Secret reference must start with op://");
    }
    const policy = await this.store.load();
    if (!grantTargetsMcpVault(input, policy.settings.mcpVaultName, input.secretRef)) {
      throw new Error(`Only items in ${policy.settings.mcpVaultName} can be approved for agents.`);
    }
    const key = await loadOrCreateKey();
    const id = randomId("grant");
    const now = new Date().toISOString();
    const encryptedRef = sealJson(
      {
        grantId: id,
        secretRef: input.secretRef,
        kind: input.kind,
        issuedAt: now,
      } satisfies SecretHandlePayload,
      key,
    );
    const grant: Grant = {
      id,
      title: input.title,
      username: input.username,
      vaultId: input.vaultId,
      vaultName: input.vaultName,
      itemId: input.itemId,
      itemTitle: input.itemTitle,
      fieldLabel: input.fieldLabel,
      kind: input.kind,
      encryptedRef,
      sites: input.sites,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
      note: input.note,
    };
    await this.store.update((policy) => {
      policy.grants.push(grant);
      policy.audit.unshift({
        id: randomId("audit"),
        type: "grant.created",
        grantId: grant.id,
        message: `Created grant ${grant.title}`,
        createdAt: now,
      });
      policy.audit = policy.audit.slice(0, 200);
    });
    return grant;
  }

  private toPublicGrant(grant: Grant, key: Buffer, saved?: SecretHandlePayload): PublicGrant {
    const savedRef = saved || openJson<SecretHandlePayload>(grant.encryptedRef, key);
    const handle = sealJson(
      {
        grantId: grant.id,
        secretRef: savedRef.secretRef,
        kind: grant.kind,
        issuedAt: new Date().toISOString(),
      } satisfies SecretHandlePayload,
      key,
    );
    return {
      id: grant.id,
      title: grant.title,
      username: grant.username,
      vaultName: grant.vaultName,
      itemTitle: grant.itemTitle,
      fieldLabel: grant.fieldLabel,
      kind: grant.kind,
      sites: grant.sites,
      enabled: grant.enabled,
      handle,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      lastUsedAt: grant.lastUsedAt,
      note: grant.note,
    };
  }
}

function grantTargetsMcpVault(
  grant: Pick<Grant, "vaultId" | "vaultName">,
  mcpVaultName: string,
  secretRef: string,
): boolean {
  const expected = normalizeVault(mcpVaultName);
  if (!expected) return true;
  return [
    grant.vaultName,
    grant.vaultId,
    extractVaultFromSecretRef(secretRef),
  ].some((vault) => normalizeVault(vault) === expected);
}

function extractVaultFromSecretRef(secretRef: string): string | undefined {
  if (!secretRef.startsWith("op://")) return undefined;
  const [vault] = secretRef.slice("op://".length).split("/");
  return vault ? decodeURIComponent(vault) : undefined;
}

function normalizeVault(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}
