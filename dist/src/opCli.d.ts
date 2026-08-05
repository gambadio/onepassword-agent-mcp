import type { Candidate, CandidateMode, CandidateSearchResult, CreateSecretItemInput, OpItemDetail, OpVaultSummary, Settings } from "./types.js";
interface RunResult {
    stdout: string;
    stderr: string;
}
export declare class OpCli {
    private readonly settings;
    constructor(settings: Settings);
    version(): Promise<string>;
    whoami(): Promise<unknown>;
    listVaults(): Promise<OpVaultSummary[]>;
    createVault(name: string): Promise<OpVaultSummary>;
    copyItemToVault(input: {
        itemId: string;
        currentVault: string;
        destinationVault: string;
        category?: string;
    }): Promise<void>;
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
    createSecretItem(input: CreateSecretItemInput): Promise<OpItemDetail>;
    listCandidates(options: {
        vault?: string;
        limit?: number;
        query?: string;
        key: Buffer;
        mode?: CandidateMode;
    }): Promise<CandidateSearchResult>;
    getItem(item: string, vault?: string): Promise<OpItemDetail>;
    itemToCandidates(item: OpItemDetail, key: Buffer, fallbackVault?: string, mode?: CandidateMode): Candidate[];
    private mapWithConcurrency;
    run(args: string[], options?: {
        timeoutMs?: number;
        input?: string;
    }): Promise<RunResult>;
    private withGlobalArgs;
    private pipeOp;
    private opEnv;
}
export {};
