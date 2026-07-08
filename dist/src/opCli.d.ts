import type { CandidateSearchResult, Settings } from "./types.js";
interface RunResult {
    stdout: string;
    stderr: string;
}
export declare class OpCli {
    private readonly settings;
    constructor(settings: Settings);
    version(): Promise<string>;
    whoami(): Promise<unknown>;
    listVaults(): Promise<Array<{
        id?: string;
        name?: string;
        items?: number;
    }>>;
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
}
export {};
