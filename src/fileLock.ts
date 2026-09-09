import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

export async function withFileLock<T>(file: string, action: (assertOwned: () => void) => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let compromised: Error | undefined;
  const release = await lockfile.lock(file, {
    realpath: false,
    stale: 120_000,
    update: 10_000,
    retries: { retries: 600, factor: 1, minTimeout: 25, maxTimeout: 25, randomize: true },
    onCompromised: (error) => { compromised = error; },
  });
  const assertOwned = () => {
    if (compromised) throw new Error("Local state lock was lost; retry after other operations finish.");
  };
  try {
    const result = await action(assertOwned);
    assertOwned();
    return result;
  } finally {
    if (!compromised) await release();
  }
}
