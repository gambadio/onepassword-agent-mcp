import os from "node:os";
import path from "node:path";

export function appHome(): string {
  return process.env.ONEPASSWORD_MCP_HOME || path.join(os.homedir(), ".onepassword-mcp");
}

export function policyPath(): string {
  return path.join(appHome(), "policy.json");
}

export function keyPath(): string {
  return path.join(appHome(), "key.bin");
}

export function publicDir(): string {
  return path.resolve(process.cwd(), "public");
}
