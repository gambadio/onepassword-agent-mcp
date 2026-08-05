import { StateStore } from "./state.js";
import type { Grant, PublicGrant, SecretKind } from "./types.js";
export declare class PolicyService {
    private readonly store;
    constructor(store?: StateStore);
    listPublicGrants(): Promise<PublicGrant[]>;
    findForSite(site: string): Promise<PublicGrant[]>;
    createFromCandidate(candidateToken: string, overrides: Partial<Grant>): Promise<Grant>;
    createManual(input: {
        title: string;
        secretRef: string;
        sites: string[];
        username?: string;
        fieldLabel?: string;
        kind?: SecretKind;
        note?: string;
        enabled?: boolean;
    }): Promise<Grant>;
    updateGrant(id: string, patch: Partial<Omit<Grant, "id" | "encryptedRef" | "createdAt">>): Promise<Grant>;
    deleteGrant(id: string): Promise<void>;
    deleteGrantsForItem(itemId: string, vaultId?: string, vaultName?: string): Promise<number>;
    resolveHandle(handle: string, expectedSite?: string): Promise<{
        grant: Grant;
        secretRef: string;
    }>;
    markUsed(grantId: string, type: "secret.copied" | "secret.pasted", site?: string): Promise<void>;
    private createGrant;
    private toPublicGrant;
}
