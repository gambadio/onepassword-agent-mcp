import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(moduleUrl: string, entry = process.argv[1]): boolean {
  if (!entry) return false;
  try {
    // npm bins and extracted bundles may be launched through a symlink.
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch { return false; }
}
