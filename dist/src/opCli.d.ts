import type { CandidateSearchResult, OpVaultSummary, Settings } from "./types.js";
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
    readSecret(secretRef: string): Promise<string>;
    listCandidates(options: {
        vault?: string;
        limit?: number;
        query?: string;
        key: Buffer;
    }): Promise<CandidateSearchResult>;
    private itemToCandidate;
    run(args: string[], options?: {
        timeoutMs?: number;
        input?: string;
    }): Promise<RunResult>;
    private withGlobalArgs;
    private pipeOp;
    private opEnv;
}
export {};
