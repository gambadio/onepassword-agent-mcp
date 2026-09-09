import type { AuditEvent, PolicyFile } from "./types.js";
export declare class StateStore {
    load(): Promise<PolicyFile>;
    private read;
    private save;
    update(mutator: (policy: PolicyFile) => void | Promise<void>): Promise<PolicyFile>;
    addAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void>;
}
