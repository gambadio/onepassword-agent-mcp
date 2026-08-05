import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OpCli } from "../src/opCli.js";
import type { Settings } from "../src/types.js";

test("copyItemToVault reveals the source item and uses the documented clone pipe", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-opcli-test-"));
  const fakeOp = path.join(dir, "op-fake.js");
  const logFile = path.join(dir, "calls.jsonl");
  const previousLog = process.env.OPMCP_TEST_LOG;
  await fs.writeFile(fakeOp, fakeOpScript(), { mode: 0o755 });
  process.env.OPMCP_TEST_LOG = logFile;

  try {
    const op = new OpCli({
      ...testSettings,
      opPath: fakeOp,
    });
    await op.copyItemToVault({
      itemId: "item_123",
      currentVault: "Private",
      destinationVault: "MCPVAULT",
      category: "LOGIN",
    });

    const calls = (await fs.readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    const getCall = calls.find((call) => call.args[0] === "item" && call.args[1] === "get");
    const createCall = calls.find((call) => call.args[0] === "item" && call.args[1] === "create");
    assert.ok(getCall);
    assert.ok(createCall);
    assert.deepEqual(getCall.args, [
      "item",
      "get",
      "item_123",
      "--vault",
      "Private",
      "--format",
      "json",
      "--reveal",
    ]);
    assert.deepEqual(createCall.args, [
      "item",
      "create",
      "--vault",
      "MCPVAULT",
      "-",
    ]);
  } finally {
    if (previousLog === undefined) delete process.env.OPMCP_TEST_LOG;
    else process.env.OPMCP_TEST_LOG = previousLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deleteItem scopes deletion to the provided vault", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-opcli-test-"));
  const fakeOp = path.join(dir, "op-fake.js");
  const logFile = path.join(dir, "calls.jsonl");
  const previousLog = process.env.OPMCP_TEST_LOG;
  await fs.writeFile(fakeOp, fakeOpScript(), { mode: 0o755 });
  process.env.OPMCP_TEST_LOG = logFile;

  try {
    const op = new OpCli({
      ...testSettings,
      opPath: fakeOp,
    });
    await op.deleteItem({
      itemId: "item_456",
      vault: "MCPVAULT",
    });

    const calls = (await fs.readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    assert.deepEqual(calls[0].args, [
      "item",
      "delete",
      "item_456",
      "--vault",
      "MCPVAULT",
    ]);
  } finally {
    if (previousLog === undefined) delete process.env.OPMCP_TEST_LOG;
    else process.env.OPMCP_TEST_LOG = previousLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("listCandidates exposes approvable fields for API credentials and credit cards", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-opcli-test-"));
  const fakeOp = path.join(dir, "op-fake.js");
  const logFile = path.join(dir, "calls.jsonl");
  const previousLog = process.env.OPMCP_TEST_LOG;
  await fs.writeFile(fakeOp, fakeOpScript(), { mode: 0o755 });
  process.env.OPMCP_TEST_LOG = logFile;

  try {
    const op = new OpCli({
      ...testSettings,
      opPath: fakeOp,
    });
    const result = await op.listCandidates({
      vault: "MCPVAULT",
      limit: 10,
      key: Buffer.alloc(32, 7),
      mode: "all",
    });

    assert.deepEqual(
      result.items.map((item) => item.kind),
      ["api_credential", "username", "credit_card_name", "credit_card_number", "credit_card_cvv", "credit_card_expiry"],
    );
    assert.equal(result.items[0].fieldLabel, "credential");
    assert.equal(result.items[3].fieldLabel, "number");
  } finally {
    if (previousLog === undefined) delete process.env.OPMCP_TEST_LOG;
    else process.env.OPMCP_TEST_LOG = previousLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("createSecretItem sends sensitive values through stdin, not command arguments", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opmcp-opcli-test-"));
  const fakeOp = path.join(dir, "op-fake.js");
  const logFile = path.join(dir, "calls.jsonl");
  const previousLog = process.env.OPMCP_TEST_LOG;
  await fs.writeFile(fakeOp, fakeOpScript(), { mode: 0o755 });
  process.env.OPMCP_TEST_LOG = logFile;

  try {
    const op = new OpCli({
      ...testSettings,
      opPath: fakeOp,
    });
    await op.createSecretItem({
      vault: "MCPVAULT",
      title: "New API",
      category: "api_credential",
      credential: "secret-api-key",
      username: "deploy",
    });

    const calls = (await fs.readFile(logFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
    const createCall = calls.find((call) => call.args[0] === "item" && call.args[1] === "create");
    assert.ok(createCall);
    assert.deepEqual(createCall.args, ["item", "create", "--vault", "MCPVAULT", "-"]);
    assert.equal(createCall.args.some((arg) => arg.includes("secret-api-key")), false);
  } finally {
    if (previousLog === undefined) delete process.env.OPMCP_TEST_LOG;
    else process.env.OPMCP_TEST_LOG = previousLog;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const testSettings: Settings = {
  opPath: "op",
  account: "",
  adminHost: "127.0.0.1",
  adminPort: 7319,
  clipboardClearSeconds: 20,
  autoPasteByDefault: true,
  allowPasteWithoutSite: false,
  allowAgentItemCreate: false,
  defaultVault: "",
  mcpVaultName: "MCPVAULT",
};

function fakeOpScript(): string {
  return `#!/usr/bin/env node
const fs = require("fs");
const actualLogFile = process.argv.includes("item") ? process.env.OPMCP_TEST_LOG || "" : "";
const args = process.argv.slice(2);
if (actualLogFile) fs.appendFileSync(actualLogFile, JSON.stringify({ args }) + "\\n");
if (args[0] === "item" && args[1] === "list") {
  process.stdout.write(JSON.stringify([
    { id: "item_api", title: "Deploy API", category: "API_CREDENTIAL", vault: { id: "vault_1", name: "MCPVAULT" } },
    { id: "item_card", title: "Travel Card", category: "CREDIT_CARD", vault: { id: "vault_1", name: "MCPVAULT" } }
  ]));
  process.exit(0);
} else if (args[0] === "item" && args[1] === "get" && args[2] === "item_api") {
  process.stdout.write(JSON.stringify({
    id: "item_api",
    title: "Deploy API",
    category: "API_CREDENTIAL",
    vault: { id: "vault_1", name: "MCPVAULT" },
    fields: [
      { id: "credential", type: "CONCEALED", label: "credential", reference: "op://MCPVAULT/item_api/credential" },
      { id: "username", type: "STRING", purpose: "USERNAME", label: "username", reference: "op://MCPVAULT/item_api/username" }
    ]
  }));
  process.exit(0);
} else if (args[0] === "item" && args[1] === "get" && args[2] === "item_card") {
  process.stdout.write(JSON.stringify({
    id: "item_card",
    title: "Travel Card",
    category: "CREDIT_CARD",
    vault: { id: "vault_1", name: "MCPVAULT" },
    fields: [
      { id: "cardholder", type: "STRING", label: "cardholder name", reference: "op://MCPVAULT/item_card/cardholder" },
      { id: "ccnum", type: "CREDIT_CARD_NUMBER", label: "number", reference: "op://MCPVAULT/item_card/ccnum" },
      { id: "cvv", type: "CONCEALED", label: "verification number", reference: "op://MCPVAULT/item_card/cvv" },
      { id: "expiry", type: "MONTH_YEAR", label: "expiry date", reference: "op://MCPVAULT/item_card/expiry" }
    ]
  }));
  process.exit(0);
} else if (args[0] === "item" && args[1] === "get") {
  process.stdout.write(JSON.stringify({ title: "Example", category: "LOGIN", fields: [] }));
  process.exit(0);
} else if (args[0] === "item" && args[1] === "create") {
  process.stdin.resume();
  process.stdin.on("end", () => process.exit(0));
} else if (args[0] === "item" && args[1] === "delete") {
  if (!args.includes("--vault")) {
    process.stderr.write("missing vault");
    process.exit(1);
  }
  process.exit(0);
} else {
  process.stderr.write("unexpected call");
  process.exit(1);
}
`;
}
