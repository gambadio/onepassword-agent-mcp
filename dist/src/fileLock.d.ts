export declare function withFileLock<T>(file: string, action: (assertOwned: () => void) => Promise<T>): Promise<T>;
