import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { keyPath } from "./paths.js";

const PREFIX = "opmcp:v1:";
const ALGORITHM = "aes-256-gcm";

export async function loadOrCreateKey(): Promise<Buffer> {
  const file = keyPath();
  try {
    const existing = await fs.readFile(file);
    if (existing.length !== 32) {
      throw new Error(`Invalid key length in ${file}; expected 32 bytes.`);
    }
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(32);
  try {
    const handle = await fs.open(file, "wx", 0o600);
    try {
      await handle.writeFile(key);
    } finally {
      await handle.close();
    }
    await fs.chmod(file, 0o600).catch(() => undefined);
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = await fs.readFile(file);
    if (existing.length !== 32) {
      throw new Error(`Invalid key length in ${file}; expected 32 bytes.`);
    }
    return existing;
  }
}

export function sealJson(value: unknown, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function openJson<T>(token: string, key: Buffer): T {
  if (!token.startsWith(PREFIX)) {
    throw new Error("Invalid encrypted handle prefix.");
  }
  const payload = Buffer.from(token.slice(PREFIX.length), "base64url");
  if (payload.length < 29) {
    throw new Error("Encrypted handle is too short.");
  }
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString("base64url")}`;
}
