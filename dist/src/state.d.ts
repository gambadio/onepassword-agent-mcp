import type { AuditEvent, Grant, PolicyFile } from "./types.js";
export declare class StateStore {
    load(): Promise<PolicyFile>;
    save(policy: PolicyFile): Promise<void>;
    update(mutator: (policy: PolicyFile) => void | Promise<void>): Promise<PolicyFile>;
    addAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void>;
    upsertGrant(grant: Grant): Promise<Grant>;
}
