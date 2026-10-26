import assert from "node:assert/strict";
import test from "node:test";
import { OpCli } from "../src/opCli.js";
import { openJson } from "../src/cryptoBox.js";
import type { Settings, CandidatePayload } from "../src/types.js";

const key = Buffer.alloc(32, 9);
class CatalogCli extends OpCli {
  calls: string[][] = [];
  fail = false;
  constructor() { super({ opPath: "synthetic-catalog" } as Settings); }
  override async run(args: string[]) {
    this.calls.push(args);
    await new Promise(resolve => setTimeout(resolve, 10));
    if (this.fail) throw new Error("Synthetic disconnect");
    assert.equal(args[1], "list", "source browsing must never fetch individual details");
    return { stdout: JSON.stringify(Array.from({ length: 442 }, (_, i) => ({
      id: `item-${i}`, title: i === 441 ? "Sweeplify" : `Example ${i}`,
      category: i === 441 ? "IDENTITY" : "LOGIN", vault: { id: "source", name: "Personal" },
    }))), stderr: "" };
  }
}

test("442 source items and overlapping searches use one list call, zero detail calls", async () => {
  OpCli.invalidateCandidates();
  const cli = new CatalogCli();
  const base = { vault: "source", mode: "primary" as const, key };
  const [all, search] = await Promise.all([cli.listCandidates(base), cli.listCandidates({ ...base, query: "sweeplify" })]);
  assert.equal(all.items.length, 442);
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].title, "Sweeplify");
  assert.equal(cli.calls.length, 1);
  const payload = openJson<CandidatePayload>(search.items[0].token, key);
  assert.equal(payload.transferOnly, true);
  assert.equal(payload.secretRef, "");
  const filtered = await cli.listCandidates({ ...base, group: "login", limit: 10 });
  assert.equal(filtered.matched, 441);
  assert.equal(filtered.items.length, 10);
  assert.equal(cli.calls.length, 1);
  OpCli.invalidateCandidates();
  await cli.listCandidates(base);
  assert.equal(cli.calls.length, 2);
});

test("failed source loads can retry without retaining a rejected connection", async () => {
  OpCli.invalidateCandidates();
  const cli = new CatalogCli();
  cli.fail = true;
  const options = { vault: "source", mode: "primary" as const, key };
  await assert.rejects(cli.listCandidates(options), /Synthetic disconnect/);
  cli.fail = false;
  assert.equal((await cli.listCandidates(options)).items.length, 442);
  assert.equal(cli.calls.length, 2);
});
