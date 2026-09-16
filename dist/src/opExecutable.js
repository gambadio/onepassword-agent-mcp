import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
// GUI apps on macOS often inherit a PATH without either Homebrew prefix.
// Resolve the default command here so admin, MCP, and doctor use the same CLI.
export async function resolveOpExecutable(configuredPath, env = process.env, platform = process.platform) {
    const command = configuredPath.trim() || "op";
    // Explicit paths and wrapper commands are intentional. Never silently
    // replace them with a different installation, including when they fail.
    if (command !== "op" || platform !== "darwin")
        return command;
    const candidates = new Set([
        ...(env.PATH || "").split(":")
            .filter((directory) => path.posix.isAbsolute(directory))
            .map((directory) => path.posix.join(directory, "op")),
        "/opt/homebrew/bin/op",
        "/usr/local/bin/op",
    ]);
    for (const candidate of candidates) {
        try {
            await fs.access(candidate, constants.X_OK);
            if ((await fs.stat(candidate)).isFile())
                return candidate;
        }
        catch {
            // Missing, inaccessible, or broken symlink: try the next installation.
        }
    }
    throw new Error("1Password CLI (op) was not found. Install the 1Password CLI, or set its full path in Advanced local settings. "
        + "Automatic discovery checked PATH and the standard Mac Homebrew locations.");
}
//# sourceMappingURL=opExecutable.js.map