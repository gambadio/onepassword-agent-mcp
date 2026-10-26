import { type ProcessOptions } from "./processRunner.js";
import type { Candidate, CandidateGroup, CandidateMode, CandidateSearchResult, CreateSecretItemInput, OpItemDetail, OpItemField, OpVaultSummary, Settings } from "./types.js";
interface RunResult {
    stdout: string;
    stderr: string;
}
export declare class OpCli {
    private readonly settings;
    private static summaries;
    private static fields;
    private static queue;
    static invalidateCandidates(): void;
    private resolvedExecutable?;
    constructor(settings: Settings);
    executablePath(): Promise<string>;
    version(): Promise<string>;
    whoami(): Promise<unknown>;
    listVaults(): Promise<OpVaultSummary[]>;
    createVault(name: string): Promise<OpVaultSummary>;
    copyItemToVault(input: {
        itemId: string;
        currentVault: string;
        destinationVault: string;
        category?: string;
        title?: string;
        requestId?: string;
    }): Promise<VerifiedItem>;
    moveItemToVault(input: {
        itemId: string;
        currentVault: string;
        destinationVault: string;
    }): Promise<void>;
    deleteItem(input: {
        itemId: string;
        vault: string;
    }): Promise<void>;
    readSecret(secretRef: string): Promise<string>;
    createSecretItem(input: CreateSecretItemInput, options?: {
        autoApprove?: boolean;
    }): Promise<VerifiedItem>;
    private writeTemplate;
    listCandidates(options: {
        vault?: string;
        limit?: number;
        query?: string;
        key: Buffer;
        mode?: CandidateMode;
        group?: CandidateGroup;
    }): Promise<CandidateSearchResult>;
    private transferCandidate;
    getItem(item: string, vault?: string, reveal?: boolean): Promise<OpItemDetail>;
    itemToCandidates(item: OpItemDetail, key: Buffer, fallbackVault?: string, mode?: CandidateMode): Candidate[];
    private mapWithConcurrency;
    run(args: string[], options?: ProcessOptions): Promise<RunResult>;
    private withGlobalArgs;
    private opEnv;
}
export declare function createItemTemplate(input: CreateSecretItemInput): ItemTemplate;
export interface ItemTemplate {
    title: string;
    category?: string;
    fields: OpItemField[];
    urls?: OpItemDetail["urls"];
    sections?: OpItemDetail["sections"];
    tags?: string[];
}
export interface VerifiedItem extends OpItemDetail {
    operationId: string;
    created: true;
    verified: true;
}
export declare class ItemWriteError extends Error {
    readonly outcome: {
        operationId: string;
        itemId?: string;
        vaultId: string;
        created: true | "unknown";
        verified: false;
    };
    constructor(message: string, outcome: {
        operationId: string;
        itemId?: string;
        vaultId: string;
        created: true | "unknown";
        verified: false;
    });
}
export declare function verifyItemTemplate(saved: OpItemDetail, template: ItemTemplate, vault: string, itemId: string): void;
export {};
