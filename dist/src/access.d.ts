export interface AccessStatus {
    mode: "desktop" | "service_account" | "environment";
    configured: boolean;
    enabled: boolean;
    source: "local" | "environment" | "none";
}
export declare class AccessStore {
    private readonly environment;
    constructor(environment?: NodeJS.ProcessEnv);
    private get file();
    private read;
    status(): Promise<AccessStatus>;
    token(): Promise<string | undefined>;
    save(token: string): Promise<AccessStatus>;
    setEnabled(enabled: boolean): Promise<AccessStatus>;
    remove(): Promise<AccessStatus>;
    private write;
}
