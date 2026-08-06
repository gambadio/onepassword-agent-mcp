import { spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { appHome } from "./paths.js";
import type { Settings } from "./types.js";

export const adminShutdownHeader = "x-onepassword-mcp-shutdown-token";

export interface AdminRuntimeRecord {
  version: 1;
  instanceId: string;
  pid: number;
  host: string;
  port: number;
  startedAt: string;
  shutdownToken: string;
}

export interface AdminRuntimeStatus {
  running: boolean;
  managed: boolean;
  pid?: number;
  url: string;
}

export interface StopAdminResult {
  wasRunning: boolean;
  stopped: boolean;
  method: "control" | "signal" | "not-running";
}

interface StopAdminOptions {
  expectedCliPath?: string;
}

export function adminRuntimePath(): string {
  return path.join(appHome(), "admin-runtime.json");
}

export function createAdminRuntimeRecord(
  settings: Pick<Settings, "adminHost" | "adminPort">,
): AdminRuntimeRecord {
  return {
    version: 1,
    instanceId: randomBytes(16).toString("base64url"),
    pid: process.pid,
    host: settings.adminHost,
    port: settings.adminPort,
    startedAt: new Date().toISOString(),
    shutdownToken: randomBytes(32).toString("base64url"),
  };
}

export async function writeAdminRuntime(record: AdminRuntimeRecord): Promise<void> {
  const target = adminRuntimePath();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(temporary, target);
}

export async function readAdminRuntime(): Promise<AdminRuntimeRecord | undefined> {
  try {
    const raw = JSON.parse(await fs.readFile(adminRuntimePath(), "utf8")) as Partial<AdminRuntimeRecord>;
    if (
      raw.version !== 1
      || typeof raw.instanceId !== "string"
      || raw.instanceId.length < 16
      || !Number.isInteger(raw.pid)
      || Number(raw.pid) <= 0
      || typeof raw.host !== "string"
      || !Number.isInteger(raw.port)
      || Number(raw.port) < 1
      || Number(raw.port) > 65_535
      || typeof raw.startedAt !== "string"
      || typeof raw.shutdownToken !== "string"
      || raw.shutdownToken.length < 32
    ) {
      return undefined;
    }
    return raw as AdminRuntimeRecord;
  } catch {
    return undefined;
  }
}

export async function clearAdminRuntime(instanceId: string): Promise<void> {
  const current = await readAdminRuntime();
  if (current?.instanceId === instanceId) {
    await fs.rm(adminRuntimePath(), { force: true });
  }
}

export function adminShutdownTokenMatches(expected: string, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function getAdminRuntimeStatus(
  settings: Pick<Settings, "adminHost" | "adminPort">,
): Promise<AdminRuntimeStatus> {
  const [running, runtime] = await Promise.all([
    isAdminPortOpen(settings),
    readAdminRuntime(),
  ]);
  const managed = Boolean(running && runtime && runtime.port === settings.adminPort);
  return {
    running,
    managed,
    pid: managed ? runtime?.pid : undefined,
    url: adminUrl(settings),
  };
}

export async function stopAdmin(
  settings: Pick<Settings, "adminHost" | "adminPort">,
  options: StopAdminOptions = {},
): Promise<StopAdminResult> {
  const runtime = await readAdminRuntime();
  if (!(await isAdminPortOpen(settings))) {
    if (runtime?.port === settings.adminPort) await clearAdminRuntime(runtime.instanceId);
    return { wasRunning: false, stopped: true, method: "not-running" };
  }

  if (runtime?.port === settings.adminPort) {
    try {
      const response = await fetch(`${adminUrl(settings)}/api/runtime/stop`, {
        method: "POST",
        headers: { [adminShutdownHeader]: runtime.shutdownToken },
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 202) {
        const stopped = await waitForAdminPort(settings, false, 4_000);
        if (!stopped) throw new Error("The admin console accepted the stop request but did not close.");
        await clearAdminRuntime(runtime.instanceId);
        return { wasRunning: true, stopped: true, method: "control" };
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("The admin console rejected its private local stop token. Restart it and try again.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("private local stop token")) throw error;
    }
  }

  const pid = findLegacyAdminPid(settings.adminPort, options.expectedCliPath);
  if (!pid) {
    throw new Error(
      `Port ${settings.adminPort} is in use, but it is not a verified 1Password Agent MCP admin process. Refusing to stop it.`,
    );
  }
  process.kill(pid, "SIGTERM");
  const stopped = await waitForAdminPort(settings, false, 4_000);
  if (!stopped) throw new Error("The admin console did not stop after SIGTERM.");
  if (runtime?.port === settings.adminPort) await clearAdminRuntime(runtime.instanceId);
  return { wasRunning: true, stopped: true, method: "signal" };
}

export function isLikelyAdminCommand(command: string, expectedCliPath?: string): boolean {
  const normalized = command.toLowerCase();
  const expected = expectedCliPath ? path.resolve(expectedCliPath).toLowerCase() : "";
  const expectedDirectory = expected ? path.dirname(expected) : "";
  const packageMatch = normalized.includes("onepassword-agent-mcp")
    || Boolean(expected && normalized.includes(expected))
    || Boolean(expectedDirectory && normalized.includes(expectedDirectory));
  const adminMatch = /(?:^|\s|["'])admin(?:\s|$|["'])/.test(normalized)
    || /(?:^|[/\\])admin\.js(?:\s|$|["'])/.test(normalized);
  return packageMatch && adminMatch;
}

function findLegacyAdminPid(port: number, expectedCliPath?: string): number | undefined {
  if (process.platform === "win32") return undefined;
  const lsof = existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof";
  const result = spawnSync(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  if (result.status !== 0 && !result.stdout.trim()) return undefined;

  const matches = result.stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
    .filter((pid) => {
      const processInfo = readProcessInfo(pid);
      return processInfo
        && (typeof process.getuid !== "function" || processInfo.uid === process.getuid())
        && isLikelyAdminCommand(processInfo.command, expectedCliPath);
    });

  return matches.length === 1 ? matches[0] : undefined;
}

function readProcessInfo(pid: number): { uid: number; command: string } | undefined {
  const ps = existsSync("/bin/ps") ? "/bin/ps" : "ps";
  const result = spawnSync(ps, ["-p", String(pid), "-o", "uid=", "-o", "command="], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const match = result.stdout.trim().match(/^(\d+)\s+(.+)$/s);
  return match ? { uid: Number(match[1]), command: match[2] } : undefined;
}

function adminUrl(settings: Pick<Settings, "adminHost" | "adminPort">): string {
  const host = controlHost(settings.adminHost);
  return `http://${host}:${settings.adminPort}`;
}

function controlHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isAdminPortOpen(settings: Pick<Settings, "adminHost" | "adminPort">): Promise<boolean> {
  const host = controlHost(settings.adminHost).replace(/^\[|\]$/g, "");
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: settings.adminPort });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(350, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForAdminPort(
  settings: Pick<Settings, "adminHost" | "adminPort">,
  expectedOpen: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await isAdminPortOpen(settings)) === expectedOpen) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}
