import { loadOrCreateKey, openJson, randomId, sealJson } from "./cryptoBox.js";
import { StateStore } from "./state.js";
import { siteMatches } from "./siteMatch.js";
import type {
  CandidatePayload,
  Grant,
  PublicGrant,
  SecretHandlePayload,
  SecretKind,
} from "./types.js";

export class PolicyService {
  constructor(private readonly store = new StateStore()) {}

  async listPublicGrants(): Promise<PublicGrant[]> {
    const [policy, key] = await Promise.all([this.store.load(), loadOrCreateKey()]);
    return policy.grants.map((grant) => this.toPublicGrant(grant, key));
  }

  async findForSite(site: string): Promise<PublicGrant[]> {
    const grants = await this.listPublicGrants();
    return grants.filter((grant) => grant.enabled && siteMatches(grant.sites, site));
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
      sites: overrides.sites?.length ? overrides.sites : candidate.sites,
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
        sites: patch.sites || grant.sites,
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
      throw new Error("This password handle no longer exists.");
    }
    if (!grant.enabled) {
      await this.store.addAudit({
        type: "secret.denied",
        grantId: grant.id,
        site: expectedSite,
        message: `Denied paste for disabled grant ${grant.title}.`,
      });
      throw new Error("This password is disabled in the local policy.");
    }
    const savedRef = openJson<SecretHandlePayload>(grant.encryptedRef, key);
    if (savedRef.secretRef !== payload.secretRef || savedRef.kind !== payload.kind) {
      throw new Error("This password handle does not match the saved policy.");
    }
    if (expectedSite) {
      if (!siteMatches(grant.sites, expectedSite)) {
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
    if (!input.sites.length) {
      throw new Error("At least one allowed site is required.");
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

  private toPublicGrant(grant: Grant, key: Buffer): PublicGrant {
    const saved = openJson<SecretHandlePayload>(grant.encryptedRef, key);
    const handle = sealJson(
      {
        grantId: grant.id,
        secretRef: saved.secretRef,
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
