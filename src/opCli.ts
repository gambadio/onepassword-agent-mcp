import { spawn } from "node:child_process";
import type {
  Candidate,
  CandidateGroup,
  CandidateMode,
  CandidatePayload,
  CandidateSearchResult,
  CreateSecretItemInput,
  OpItemDetail,
  OpItemField,
  OpItemSummary,
  OpVaultSummary,
  SecretKind,
  Settings,
} from "./types.js";
import { sealJson } from "./cryptoBox.js";
import { formatSites } from "./siteMatch.js";

interface RunResult {
  stdout: string;
  stderr: string;
}

export class OpCli {
  constructor(private readonly settings: Settings) {}

  async version(): Promise<string> {
    const result = await this.run(["--version"], { timeoutMs: 8_000 });
    return result.stdout.trim();
  }

  async whoami(): Promise<unknown> {
    const result = await this.run(["whoami", "--format", "json"], { timeoutMs: 15_000 });
    const text = result.stdout.trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
  }

  async listVaults(): Promise<OpVaultSummary[]> {
    const result = await this.run(["vault", "list", "--format", "json"], { timeoutMs: 30_000 });
    return JSON.parse(result.stdout || "[]") as OpVaultSummary[];
  }

  async createVault(name: string): Promise<OpVaultSummary> {
    const result = await this.run([
      "vault",
      "create",
      name,
      "--description",
      "Vault used by 1Password Agent MCP for agent-approved items.",
    ], { timeoutMs: 45_000 });
    const text = result.stdout.trim();
    if (!text) return { name };
    try {
      const created = JSON.parse(text) as OpVaultSummary;
      return { name, ...created };
    } catch {
      return { name };
    }
  }

  async copyItemToVault(input: {
    itemId: string;
    currentVault: string;
    destinationVault: string;
    category?: string;
  }): Promise<void> {
    const sourceArgs = [
      "item",
      "get",
      input.itemId,
      "--vault",
      input.currentVault,
      "--format",
      "json",
      "--reveal",
    ];
    const documentedCloneArgs = ["item", "create", "--vault", input.destinationVault, "-"];
    try {
      await this.pipeOp(sourceArgs, documentedCloneArgs, 90_000);
    } catch (error) {
      const message = (error as Error).message;
      if (!input.category || !/category/i.test(message)) {
        throw error;
      }
      await this.pipeOp(
        sourceArgs,
        [
          "item",
          "create",
          "--category",
          createCategory(input.category),
          "--vault",
          input.destinationVault,
          "-",
        ],
        90_000,
      );
    }
  }

  async moveItemToVault(input: {
    itemId: string;
    currentVault: string;
    destinationVault: string;
  }): Promise<void> {
    await this.run([
      "item",
      "move",
      input.itemId,
      "--current-vault",
      input.currentVault,
      "--destination-vault",
      input.destinationVault,
    ], { timeoutMs: 60_000 });
  }

  async deleteItem(input: {
    itemId: string;
    vault: string;
  }): Promise<void> {
    await this.run([
      "item",
      "delete",
      input.itemId,
      "--vault",
      input.vault,
    ], { timeoutMs: 45_000 });
  }

  async readSecret(secretRef: string): Promise<string> {
    const result = await this.run(["read", "--no-newline", secretRef], { timeoutMs: 30_000 });
    return result.stdout;
  }

  async createSecretItem(input: CreateSecretItemInput): Promise<OpItemDetail> {
    const template = createItemTemplate(input);
    const result = await this.run(
      ["item", "create", "--vault", input.vault, "-"],
      { timeoutMs: 60_000, input: JSON.stringify(template) },
    );
    const created = JSON.parse(result.stdout || "{}") as OpItemDetail;
    if (created.id) {
      return await this.getItem(created.id, input.vault);
    }
    return {
      ...created,
      title: created.title || input.title,
      category: created.category || String(template.category || input.category),
      vault: created.vault || { name: input.vault },
    };
  }

  async listCandidates(options: {
    vault?: string;
    limit?: number;
    query?: string;
    key: Buffer;
    mode?: CandidateMode;
    group?: CandidateGroup;
  }): Promise<CandidateSearchResult> {
    const vault = options.vault || this.settings.defaultVault;
    const limit = Math.max(1, Math.min(options.limit || 100, 500));
    const query = (options.query || "").trim().toLowerCase();
    const group = options.group || "all";
    const args = [
      "item",
      "list",
      "--long",
      "--format",
      "json",
    ];
    if (vault) args.push("--vault", vault);

    const result = await this.run(args, { timeoutMs: 60_000 });
    const items = JSON.parse(result.stdout || "[]") as OpItemSummary[];
    const matchedItems = query ? items.filter((item) => itemMatchesQuery(item, query)) : items;
    const groups = countGroups(matchedItems);
    const groupedItems = group === "all" ? matchedItems : matchedItems.filter((item) => itemGroup(item) === group);
    const details = await this.mapWithConcurrency(
      groupedItems.slice(0, limit),
      6,
      async (item) => await this.getItem(item.id || item.title, item.vault?.id || item.vault?.name || vault),
    );
    const candidates = details.flatMap((item) => this.itemToCandidates(
      item,
      options.key,
      vault,
      options.mode || "all",
    )).slice(0, limit);

    return {
      items: candidates,
      total: items.length,
      matched: groupedItems.length,
      shown: candidates.length,
      query,
      activeGroup: group,
      groups,
    };
  }

  async getItem(item: string, vault?: string): Promise<OpItemDetail> {
    const args = ["item", "get", item, "--format", "json"];
    if (vault) args.push("--vault", vault);
    const result = await this.run(args, { timeoutMs: 45_000 });
    return JSON.parse(result.stdout || "{}") as OpItemDetail;
  }

  itemToCandidates(
    item: OpItemDetail,
    key: Buffer,
    fallbackVault?: string,
    mode: CandidateMode = "all",
  ): Candidate[] {
    const vaultId = item.vault?.id;
    const vaultName = item.vault?.name;
    const vaultRef = vaultId || vaultName || fallbackVault || this.settings.defaultVault;
    if (!vaultRef) {
      throw new Error(
        "1Password did not return vault information. Set a default vault or enter a vault before loading items.",
      );
    }
    const itemRef = item.id || item.title;
    const sites = extractSites(item);
    const fields = approvableFields(item);
    const selectedFields = mode === "primary" ? fields.slice(0, 1) : fields;

    return selectedFields.map(({ field, kind }) => {
      const fieldLabel = field.label || field.id || "secret";
      const secretRef = field.reference || buildSecretRef(vaultRef, itemRef, field.id || fieldLabel);
      const title = mode === "primary" ? item.title : `${item.title} - ${fieldLabel}`;
      const payload: CandidatePayload = {
        secretRef,
        title,
        username: field.purpose === "USERNAME" ? undefined : findUsername(item),
        vaultId,
        vaultName,
        itemId: item.id,
        itemTitle: item.title,
        fieldLabel,
        fieldId: field.id,
        fieldType: field.type,
        fieldPurpose: field.purpose,
        kind,
        category: item.category,
        sites,
        issuedAt: new Date().toISOString(),
      };

      return {
        token: sealJson(payload, key),
        title,
        username: payload.username,
        vaultName,
        itemTitle: item.title,
        fieldLabel,
        fieldId: field.id,
        fieldType: field.type,
        fieldPurpose: field.purpose,
        kind,
        category: item.category,
        sites,
      };
    });
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = [];
    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = index;
        index += 1;
        results[current] = await mapper(items[current]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async run(args: string[], options: { timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
    const finalArgs = this.withGlobalArgs(args);
    const child = spawn(this.settings.opPath || "op", finalArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.opEnv(),
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, options.timeoutMs || 30_000);

    return await new Promise<RunResult>((resolve, reject) => {
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(new Error(`Unable to run 1Password CLI at "${this.settings.opPath}": ${error.message}`));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = stderr.trim() || stdout.trim() || `signal ${signal || "unknown"}`;
        reject(new Error(`1Password CLI failed (${code ?? "no code"}): ${detail}`));
      });
    });
  }

  private withGlobalArgs(args: string[]): string[] {
    if (!this.settings.account) return args;
    if (args.includes("--account")) return args;
    return ["--account", this.settings.account, ...args];
  }

  private async pipeOp(sourceArgs: string[], destinationArgs: string[], timeoutMs: number): Promise<void> {
    const source = spawn(this.settings.opPath || "op", this.withGlobalArgs(sourceArgs), {
      stdio: ["ignore", "pipe", "pipe"],
      env: this.opEnv(),
    });
    const destination = spawn(this.settings.opPath || "op", this.withGlobalArgs(destinationArgs), {
      stdio: ["pipe", "ignore", "pipe"],
      env: this.opEnv(),
    });

    source.stdout.pipe(destination.stdin);

    let sourceStderr = "";
    let destinationStderr = "";
    source.stderr.setEncoding("utf8");
    destination.stderr.setEncoding("utf8");
    source.stderr.on("data", (chunk) => {
      sourceStderr += chunk;
    });
    destination.stderr.on("data", (chunk) => {
      destinationStderr += chunk;
    });

    const timeout = setTimeout(() => {
      source.kill("SIGTERM");
      destination.kill("SIGTERM");
    }, timeoutMs);

    await Promise.all([
      waitForChild(source, "1Password item read", () => sourceStderr),
      waitForChild(destination, "1Password item create", () => destinationStderr),
    ]).finally(() => {
      clearTimeout(timeout);
    });
  }

  private opEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      OP_FORMAT: "json",
      OP_ACCOUNT: this.settings.account || process.env.OP_ACCOUNT,
    };
  }
}

function waitForChild(
  child: ReturnType<typeof spawn>,
  label: string,
  stderr: () => string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      reject(new Error(`${label} failed to start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr().trim() || `signal ${signal || "unknown"}`;
      reject(new Error(`${label} failed (${code ?? "no code"}): ${detail}`));
    });
  });
}

function extractSites(item: OpItemSummary): string[] {
  const raw = [
    item.url,
    ...(item.urls || []).map((entry) => entry.href),
  ].filter((value): value is string => Boolean(value));
  return formatSites(raw);
}

function approvableFields(item: OpItemDetail): Array<{ field: OpItemField; kind: SecretKind }> {
  const category = normalizeCategory(item.category);
  const fields = item.fields || [];
  const candidates = fields.flatMap((field) => {
    const kind = classifyField(field, category);
    return kind ? [{ field, kind }] : [];
  });
  if (candidates.length) return candidates;

  if (category === "LOGIN" || category === "PASSWORD") {
    return [{ field: { id: "password", label: "password", purpose: "PASSWORD", type: "CONCEALED" }, kind: "password" }];
  }
  if (category === "API_CREDENTIAL") {
    return [{ field: { id: "credential", label: "credential", type: "CONCEALED" }, kind: "api_credential" }];
  }
  if (category === "SECURE_NOTE") {
    return [{ field: { id: "notesPlain", label: "notes", purpose: "NOTES", type: "STRING" }, kind: "secure_note" }];
  }
  return [];
}

function classifyField(field: OpItemField, category: string): SecretKind | null {
  const id = normalizeField(field.id);
  const label = normalizeField(field.label);
  const type = normalizeField(field.type);
  const purpose = normalizeField(field.purpose);

  if (purpose === "PASSWORD" || id === "password") return "password";
  if (purpose === "USERNAME" || id === "username") return "username";
  if (type === "OTP" || id.includes("otp") || label.includes("one-time")) return "otp";
  if (category === "API_CREDENTIAL" && id === "credential") return "api_credential";
  if (category === "API_CREDENTIAL" && (id === "hostname" || id === "type")) return "text";
  if (category === "CREDIT_CARD" && id === "cardholder") return "credit_card_name";
  if (category === "CREDIT_CARD" && id === "ccnum") return "credit_card_number";
  if (category === "CREDIT_CARD" && id === "cvv") return "credit_card_cvv";
  if (category === "CREDIT_CARD" && id === "pin") return "credit_card_pin";
  if (category === "CREDIT_CARD" && id === "expiry") return "credit_card_expiry";
  if (category === "SECURE_NOTE" && id === "notesPlain".toLowerCase()) return "secure_note";
  if (type === "SSHKEY" || id === "private_key") return "ssh_private_key";
  if (id.includes("license") || label.includes("license key")) return "license_key";
  if (type === "CONCEALED" || type === "CREDIT_CARD_NUMBER") return "custom";
  return null;
}

function findUsername(item: OpItemDetail): string | undefined {
  const field = (item.fields || []).find((candidate) => {
    return normalizeField(candidate.purpose) === "USERNAME" || normalizeField(candidate.id) === "username";
  });
  const value = typeof field?.value === "string" ? field.value.trim() : "";
  return value || undefined;
}

function itemMatchesQuery(item: OpItemSummary, query: string): boolean {
  const haystack = [
    item.title,
    item.category,
    item.vault?.name,
    item.vault?.id,
    item.url,
    ...(item.urls || []).flatMap((entry) => [entry.href, entry.label]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => haystack.includes(part));
}

function countGroups(items: OpItemSummary[]): Record<CandidateGroup, number> {
  const counts: Record<CandidateGroup, number> = {
    all: items.length,
    login: 0,
    api: 0,
    card: 0,
    note: 0,
    other: 0,
  };
  for (const item of items) {
    counts[itemGroup(item)] += 1;
  }
  return counts;
}

function itemGroup(item: OpItemSummary): CandidateGroup {
  const category = normalizeCategory(item.category);
  if (category === "LOGIN" || category === "PASSWORD") return "login";
  if (category === "API_CREDENTIAL") return "api";
  if (category === "CREDIT_CARD") return "card";
  if (category === "SECURE_NOTE" || category === "SSH_KEY") return "note";
  return "other";
}

function createCategory(category: string | undefined): string {
  const value = (category || "login").trim().toLowerCase();
  if (value === "login" || value === "password") return value;
  if (value === "secure note") return "secure-note";
  if (value === "api credential") return "api-credential";
  if (value === "credit card") return "credit-card";
  return value.replaceAll("_", "-").replaceAll(" ", "-");
}

function createItemTemplate(input: CreateSecretItemInput): Record<string, unknown> {
  const category = templateCategory(input.category);
  const template: Record<string, unknown> = {
    title: input.title,
    category,
    fields: [],
  };
  if (input.url) {
    template.urls = [{ href: input.url, primary: true }];
  }

  const fields = template.fields as Array<Record<string, unknown>>;
  if (input.category === "login") {
    fields.push(field("username", "STRING", input.username || "", "username", "USERNAME"));
    fields.push(field("password", "CONCEALED", input.password || "", "password", "PASSWORD"));
    fields.push(field("notesPlain", "STRING", input.notes || "", "notesPlain", "NOTES"));
  } else if (input.category === "password") {
    fields.push(field("password", "CONCEALED", input.password || "", "password", "PASSWORD"));
    fields.push(field("notesPlain", "STRING", input.notes || "", "notesPlain", "NOTES"));
  } else if (input.category === "api_credential") {
    fields.push(field("notesPlain", "STRING", input.notes || "", "notesPlain", "NOTES"));
    fields.push(field("username", "STRING", input.username || "", "username"));
    fields.push(field("credential", "CONCEALED", input.credential || input.password || "", "credential"));
    fields.push(field("hostname", "STRING", input.hostname || input.url || "", "hostname"));
  } else if (input.category === "secure_note") {
    fields.push(field("notesPlain", "STRING", input.notes || input.credential || input.password || "", "notesPlain", "NOTES"));
  } else if (input.category === "credit_card") {
    fields.push(field("notesPlain", "STRING", input.notes || "", "notesPlain", "NOTES"));
    fields.push(field("cardholder", "STRING", input.cardholderName || "", "cardholder name"));
    fields.push(field("ccnum", "CREDIT_CARD_NUMBER", input.cardNumber || "", "number"));
    fields.push(field("cvv", "CONCEALED", input.verificationNumber || "", "verification number"));
    fields.push(field("expiry", "MONTH_YEAR", input.expiry || "", "expiry date"));
    fields.push({
      ...field("pin", "CONCEALED", input.pin || "", "PIN"),
      section: { id: "details", label: "Additional Details" },
    });
  }
  return template;
}

function field(
  id: string,
  type: string,
  value: string,
  label: string,
  purpose?: string,
): Record<string, unknown> {
  return {
    id,
    type,
    ...(purpose ? { purpose } : {}),
    label,
    value,
  };
}

function templateCategory(category: CreateSecretItemInput["category"]): string {
  if (category === "api_credential") return "API_CREDENTIAL";
  if (category === "secure_note") return "SECURE_NOTE";
  if (category === "credit_card") return "CREDIT_CARD";
  return category.toUpperCase();
}

function buildSecretRef(vault: string, item: string, fieldName: string): string {
  return `op://${encodeSecretRefPart(vault)}/${encodeSecretRefPart(item)}/${encodeSecretRefPart(fieldName)}`;
}

function encodeSecretRefPart(value: string): string {
  return encodeURIComponent(value).replaceAll("%20", " ");
}

function normalizeCategory(value: string | undefined): string {
  return (value || "").trim().replaceAll(" ", "_").replaceAll("-", "_").toUpperCase();
}

function normalizeField(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}
