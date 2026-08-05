import assert from "node:assert/strict";
import test from "node:test";
import { siteMatches } from "../src/siteMatch.js";

test("matches host and subdomains", () => {
  assert.equal(siteMatches(["github.com"], "https://github.com/login"), true);
  assert.equal(siteMatches(["github.com"], "https://gist.github.com"), true);
});

test("matches wildcard subdomains only", () => {
  assert.equal(siteMatches(["*.example.com"], "https://app.example.com"), true);
  assert.equal(siteMatches(["*.example.com"], "https://example.com"), false);
});

test("does not match unrelated domains", () => {
  assert.equal(siteMatches(["github.com"], "https://evilgithub.com"), false);
});

test("empty patterns and wildcard match all sites", () => {
  assert.equal(siteMatches([], "https://example.com/login"), true);
  assert.equal(siteMatches(["*"], "https://anything.example/login"), true);
});
