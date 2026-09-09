export interface ProcessOptions {
    input?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxOutputBytes?: number;
    env?: NodeJS.ProcessEnv;
    osPipe?: boolean;
}
export declare function runProcess(command: string, args: string[], options?: ProcessOptions): Promise<{
    stdout: string;
    stderr: string;
}>;
