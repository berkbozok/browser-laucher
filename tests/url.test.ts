import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUrl } from "../lib/url.ts";

test("adds https to a bare address", () => {
  assert.equal(normalizeUrl("example.com"), "https://example.com/");
  assert.equal(normalizeUrl("  example.com/a?b=1#c  "), "https://example.com/a?b=1#c");
  assert.equal(normalizeUrl("example.com:8080/x"), "https://example.com:8080/x");
});

test("uses http for addresses that are almost never served over https", () => {
  assert.equal(normalizeUrl("localhost:3000"), "http://localhost:3000/");
  assert.equal(normalizeUrl("192.168.1.5:3000"), "http://192.168.1.5:3000/");
  assert.equal(normalizeUrl("[::1]:3000"), "http://[::1]:3000/");
  assert.equal(normalizeUrl("printer.local"), "http://printer.local/");
});

test("keeps a full web address as it is", () => {
  assert.equal(normalizeUrl("http://example.com/"), "http://example.com/");
  assert.equal(normalizeUrl("https://example.com/a b"), "https://example.com/a%20b");
});

test("refuses anything that isn't a web address", () => {
  for (const input of [
    "",
    "   ",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "chrome://settings",
    "ftp://example.com",
    "mailto:a@b.com",
    "tel:+123",
    "-a Calculator",
    "http://",
  ]) {
    assert.equal(normalizeUrl(input), null, JSON.stringify(input));
  }
});

test("what it returns can never be read as a command-line switch", () => {
  // "--incognito" is a valid host name; it must come back as an address.
  assert.equal(normalizeUrl("--incognito"), "https://--incognito/");
});
