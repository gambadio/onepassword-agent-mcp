import crypto from "node:crypto";
import path from "node:path";
import { runProcess, type ProcessOptions } from "./processRunner.js";
import { resolveOpExecutable } from "./opExecutable.js";
import { withFileLock } from "./fileLock.js";
import { StateStore } from "./state.js";
import { appHome } from "./paths.js";
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
import { loadOrCreateKey, sealJson } from "./cryptoBox.js";
import { formatSites } from "./siteMatch.js";
import { AccessStore } from "./access.js";

interface RunResult {
  stdout: string;
  stderr: string;
}

export class OpCli {
  private static summaries = new Map<string, { expires: number; promise: Promise<OpItemSummary[]> }>();
  private static fields = new Map<string, { expires: number; promise: Promise<Candidate[]> }>();
  private static queue: Promise<unknown> = Promise.resolve();

  static invalidateCandidates(): void { this.summaries.clear(); this.fields.clear(); }
  private resolvedExecutable?: string;

  constructor(private readonly settings: Settings) {}

  async executablePath(): Promise<string> {
    this.resolvedExecutable ||= await resolveOpExecutable(this.settings.opPath);
    return this.resolvedExecutable;
  }

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
    title?: string;
    requestId?: string;
  }): Promise<VerifiedItem> {
    const source = await this.getItem(input.itemId, input.currentVault, true);
    if (source.id !== input.itemId) throw new Error("Source item identity could not be verified.");
    if (source.files?.length || source.category === "DOCUMENT" || source.fields?.some((field) =>
      /file|passkey/i.test(field.type || ""))) {
      throw new Error("Items containing attachments, documents, or passkeys cannot be copied through JSON. Use the 1Password app.");
    }
    const template: ItemTemplate = {
      title: source.title,
      category: source.category,
      fields: (source.fields || []).map(({ reference, ...field }) => field),
      urls: source.urls,
      sections: source.sections,
      tags: source.tags?.filter((tag) => !tag.startsWith("opmcp-")),
    };
    return await this.writeTemplate(template, input.destinationVault,
      `copy:${input.currentVault}:${input.itemId}:${input.requestId || "default"}`);
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

  async createSecretItem(input: CreateSecretItemInput, options: { autoApprove?: boolean } = {}): Promise<VerifiedItem> {
    return await this.writeTemplate(createItemTemplate(input), input.vault, input.requestId, options.autoApprove === true);
  }

  private async writeTemplate(template: ItemTemplate, vault: string, requestId?: string, autoApprove = false): Promise<VerifiedItem> {
    const key = await loadOrCreateKey();
    const digest = (value: unknown) => crypto.createHmac("sha256", key).update(JSON.stringify(value)).digest("hex");
    const fingerprint = digest(template);
    const id = digest({ account: this.settings.account, vault, request: requestId || fingerprint });
    const store = new StateStore();
    const tag = `opmcp-${id}`;
    return await withFileLock(path.join(appHome(), `operation-${id}`), async (assertOwned) => {
      let operation = (await store.load()).operations?.find((entry) => entry.id === id);
      if (operation && operation.fingerprint !== fingerprint) {
        throw new Error("This requestId was already used with different item contents. Use the original input to reconcile it.");
      }
      const existing = Boolean(operation);
      if (!operation) {
        operation = { id, fingerprint, vaultId: vault, created: "unknown", verified: false,
          autoApproveRequested: autoApprove, approvalStatus: "not_requested", startedAt: new Date().toISOString() };
        const pending = operation;
        await store.update((file) => { (file.operations ||= []).push(pending); });
      }
      const current = operation;
      try {
        if (!current.itemId && existing) {
          const result = await this.run(["item", "list", "--vault", vault, "--tags", tag, "--format", "json"]);
          const matches = parseJson(result.stdout) as OpItemSummary[];
          if (!Array.isArray(matches) || matches.length !== 1 || !matches[0]?.id) {
            throw new Error("The previous save is unresolved. Check its operation tag in 1Password before retrying with a new requestId.");
          }
          current.itemId = matches[0].id;
          current.created = true;
        }
        if (!current.itemId) {
          assertOwned();
          const result = await this.run(["item", "create", "--vault", vault, "-"], {
            timeoutMs: 60_000, input: JSON.stringify({ ...template, tags: [...(template.tags || []), tag] }),
          });
          const created = parseJson(result.stdout) as OpItemDetail;
          if (!created || typeof created.id !== "string" || !created.id.trim()) {
            throw new Error("The CLI did not return a created item ID; save status is unknown.");
          }
          current.itemId = created.id;
          current.created = true;
        }
        await store.update((file) => {
          Object.assign(file.operations!.find((entry) => entry.id === id)!, { itemId: current.itemId, created: true });
        });
        const saved = await this.getItem(current.itemId!, vault, true);
        verifyItemTemplate(saved, template, vault, current.itemId!);
        assertOwned();
        await store.update((file) => { file.operations!.find((entry) => entry.id === id)!.verified = true; });
        return { ...saved, operationId: id, created: true, verified: true };
      } catch (error) {
        throw new ItemWriteError((error as Error).message, {
          operationId: id, itemId: current.itemId, vaultId: vault,
          created: current.itemId ? true : "unknown", verified: false,
        });
      }
    });
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
    const limit = Math.max(1, Math.min(options.limit || 500, options.mode === "primary" ? 100_000 : 500));
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

    const cacheKey = crypto.createHash("sha256").update(JSON.stringify([process.env.ONEPASSWORD_MCP_HOME, this.settings, vault, await this.opEnv()])).digest("hex");
    let cached = OpCli.summaries.get(cacheKey);
    if (!cached || cached.expires < Date.now()) {
      const promise = this.run(args, { timeoutMs: 30_000 }).then(result => JSON.parse(result.stdout || "[]") as OpItemSummary[]);
      cached = { expires: Date.now() + 60_000, promise };
      if (OpCli.summaries.size >= 32) OpCli.summaries.delete(OpCli.summaries.keys().next().value!);
      OpCli.summaries.set(cacheKey, cached);
      promise.catch(() => { if (OpCli.summaries.get(cacheKey)?.promise === promise) OpCli.summaries.delete(cacheKey); });
    }
    const items = await cached.promise;
    const matchedItems = query ? items.filter((item) => itemMatchesQuery(item, query)) : items;
    const groups = countGroups(matchedItems);
    const groupedItems = group === "all" ? matchedItems : matchedItems.filter((item) => itemGroup(item) === group);
    const selected = groupedItems.slice(0, limit);
    const candidates = options.mode === "primary"
      ? selected.map(item => this.transferCandidate(item, options.key, vault))
      : (await this.mapWithConcurrency(selected, 1, async item => {
        const fieldKey = `${cacheKey}:${item.id}:${crypto.createHash("sha256").update(options.key).digest("hex")}`;
        let cachedFields = OpCli.fields.get(fieldKey);
        if (!cachedFields || cachedFields.expires < Date.now()) {
          const promise = this.getItem(item.id || item.title, item.vault?.id || item.vault?.name || vault)
            .then(detail => this.itemToCandidates(detail, options.key, vault, "all"));
          cachedFields = { expires: Date.now() + 60_000, promise };
          if (OpCli.fields.size >= 500) OpCli.fields.delete(OpCli.fields.keys().next().value!);
          OpCli.fields.set(fieldKey, cachedFields);
          promise.catch(() => { if (OpCli.fields.get(fieldKey)?.promise === promise) OpCli.fields.delete(fieldKey); });
        }
        return await cachedFields.promise;
      })).flat();

    return {
      items: candidates,
      failedItems: 0,
      loadedItems: selected.length,
      limited: groupedItems.length > limit,
      total: items.length,
      matched: groupedItems.length,
      shown: candidates.length,
      query,
      activeGroup: group,
      groups,
    };
  }

  private transferCandidate(item: OpItemSummary, key: Buffer, vault: string | undefined): Candidate {
    const payload: CandidatePayload = {
      secretRef: "", transferOnly: true, title: item.title, itemTitle: item.title,
      itemId: item.id, vaultId: item.vault?.id || vault, vaultName: item.vault?.name,
      fieldLabel: "", kind: "custom", category: item.category, sites: extractSites(item),
      issuedAt: new Date().toISOString(),
    };
    return { ...payload, token: sealJson(payload, key) };
  }

  async getItem(item: string, vault?: string, reveal = false): Promise<OpItemDetail> {
    const args = ["item", "get", item, "--format", "json"];
    if (vault) args.push("--vault", vault);
    if (reveal) args.push("--reveal");
    const result = await this.run(args, { timeoutMs: 45_000 });
    return parseJson(result.stdout) as OpItemDetail;
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
        username: normalizeField(field.purpose) === "username" ? undefined : findUsername(item),
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

  async run(args: string[], options: ProcessOptions = {}): Promise<RunResult> {
    const env = await this.opEnv();
    const executable = await this.executablePath();
    const operation = OpCli.queue.then(() => runProcess(executable, env.OP_SERVICE_ACCOUNT_TOKEN ? args : this.withGlobalArgs(args), {
      ...options, osPipe: true, env,
    }));
    OpCli.queue = operation.catch(() => {});
    const result = await operation;
    if (["create", "move", "delete", "edit"].includes(args[1])) OpCli.invalidateCandidates();
    return result;
  }

  private withGlobalArgs(args: string[]): string[] {
    if (!this.settings.account) return args;
    if (args.includes("--account")) return args;
    return ["--account", this.settings.account, ...args];
  }

  private async opEnv(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OP_FORMAT: "json",
      OP_ACCOUNT: this.settings.account || process.env.OP_ACCOUNT,
    };
    const token = await new AccessStore().token();
    if (token) {
      env.OP_SERVICE_ACCOUNT_TOKEN = token;
      delete env.OP_ACCOUNT;
      delete env.OP_CONNECT_HOST;
      delete env.OP_CONNECT_TOKEN;
      delete env.OP_BIOMETRIC_UNLOCK_ENABLED;
    }
    return env;
  }
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

  if (purpose === "password" || id === "password") return "password";
  if (purpose === "username" || id === "username") return "username";
  if (type === "otp" || id.includes("otp") || label.includes("one-time")) return "otp";
  if (category === "API_CREDENTIAL" && id === "credential") return "api_credential";
  if (category === "API_CREDENTIAL" && (id === "hostname" || id === "type")) return "text";
  if (category === "CREDIT_CARD" && id === "cardholder") return "credit_card_name";
  if (category === "CREDIT_CARD" && id === "ccnum") return "credit_card_number";
  if (category === "CREDIT_CARD" && id === "cvv") return "credit_card_cvv";
  if (category === "CREDIT_CARD" && id === "pin") return "credit_card_pin";
  if (category === "CREDIT_CARD" && id === "expiry") return "credit_card_expiry";
  if (category === "SECURE_NOTE" && id === "notesplain") return "secure_note";
  if (type === "sshkey" || id === "private_key") return "ssh_private_key";
  if (id.includes("license") || label.includes("license key")) return "license_key";
  if (type === "concealed" || type === "credit_card_number") return "custom";
  return null;
}

function findUsername(item: OpItemDetail): string | undefined {
  const field = (item.fields || []).find((candidate) => {
    return normalizeField(candidate.purpose) === "username" || normalizeField(candidate.id) === "username";
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

export function createItemTemplate(input: CreateSecretItemInput): ItemTemplate {
  const category = templateCategory(input.category);
  const template: ItemTemplate = {
    title: input.title,
    category,
    fields: [],
  };
  if (input.url) {
    template.urls = [{ href: input.url, primary: true }];
  }

  const fields = template.fields;
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
    template.sections = [{ id: "details", label: "Additional Details" }];
    fields.push(field("notesPlain", "STRING", input.notes || "", "notesPlain", "NOTES"));
    fields.push(field("cardholder", "STRING", input.cardholderName || "", "cardholder name"));
    fields.push(field("ccnum", "CREDIT_CARD_NUMBER", input.cardNumber || "", "number"));
    fields.push(field("cvv", "CONCEALED", input.verificationNumber || "", "verification number"));
    fields.push(field("expiry", "MONTH_YEAR", normalizeExpiry(input.expiry), "expiry date"));
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
): OpItemField {
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

export interface ItemTemplate {
  title: string;
  category?: string;
  fields: OpItemField[];
  urls?: OpItemDetail["urls"];
  sections?: OpItemDetail["sections"];
  tags?: string[];
}

export interface VerifiedItem extends OpItemDetail {
  operationId: string;
  created: true;
  verified: true;
}

export class ItemWriteError extends Error {
  constructor(message: string, readonly outcome: {
    operationId: string; itemId?: string; vaultId: string; created: true | "unknown"; verified: false;
  }) { super(message); this.name = "ItemWriteError"; }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new Error("The CLI returned empty or malformed JSON; operation status could not be verified."); }
}

export function verifyItemTemplate(saved: OpItemDetail, template: ItemTemplate, vault: string, itemId: string): void {
  if (!saved || !itemId || saved.id !== itemId || !saved.vault?.id ||
      ![saved.vault.id, saved.vault.name].includes(vault)) {
    throw new Error("Saved item or destination vault identity did not match.");
  }
  if (saved.title !== template.title || normalizeCategory(saved.category) !== normalizeCategory(template.category)) {
    throw new Error("Saved title or category did not match the requested item.");
  }
  for (const expected of template.fields) {
    const actual = saved.fields?.find((entry) => entry.id === expected.id &&
      (entry.section?.id || "") === (expected.section?.id || ""));
    // 1Password may omit empty optional fields. Nonempty values must survive exactly.
    const expectedValue = String(expected.value ?? "");
    if (!actual && !expectedValue) continue;
    if (!actual || !sameValue(expectedValue, String(actual.value ?? ""))) {
      throw new Error("Saved field content did not match. The item exists but was not verified; do not create a replacement blindly.");
    }
  }
  for (const expected of template.urls || []) {
    if (!saved.urls?.some((entry) => entry.href === expected.href)) {
      throw new Error("Saved website did not match the requested item.");
    }
  }
}

function sameValue(a: string, b: string): boolean {
  return crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());
}

function normalizeExpiry(value?: string): string {
  if (!value) return "";
  const normalized = value.replace(/[\/-]/g, "");
  if (!/^\d{4}(0[1-9]|1[0-2])$/.test(normalized)) {
    throw new Error("Credit-card expiry must be YYYY/MM or YYYYMM with a valid month.");
  }
  return normalized;
}
