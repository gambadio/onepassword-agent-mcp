export declare function loadOrCreateKey(): Promise<Buffer>;
export declare function sealJson(value: unknown, key: Buffer): string;
export declare function openJson<T>(token: string, key: Buffer): T;
export declare function randomId(prefix: string): string;
