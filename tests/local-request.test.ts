import assert from "node:assert/strict";
import { test } from "node:test";
import { rejectUnlessLocal } from "../lib/local-request.ts";

const request = (headers: Record<string, string>) =>
  new Request("http://127.0.0.1:3000/api/open", { headers });

const allowed = (headers: Record<string, string>) =>
  rejectUnlessLocal(request(headers)) === null;

test("lets the launcher's own page through", () => {
  assert.ok(allowed({ host: "127.0.0.1:3000", "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:3000" }));
  assert.ok(allowed({ host: "localhost:3000", "sec-fetch-site": "same-origin" }));
  assert.ok(allowed({ host: "[::1]:3000" }));
  // Typed into the address bar.
  assert.ok(allowed({ host: "127.0.0.1:3000", "sec-fetch-site": "none" }));
});

test("refuses another site calling from the person's browser", () => {
  assert.ok(!allowed({ host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }));
  assert.ok(!allowed({ host: "127.0.0.1:3000", "sec-fetch-site": "same-site" }));
  assert.ok(!allowed({ host: "127.0.0.1:3000", origin: "https://evil.example" }));
  assert.ok(!allowed({ host: "127.0.0.1:3000", origin: "null" }));
  // Same host, different port: a different origin.
  assert.ok(!allowed({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:8080" }));
});

test("refuses a host name that merely points at this machine", () => {
  assert.ok(!allowed({ host: "evil.example:3000", origin: "http://evil.example:3000", "sec-fetch-site": "same-origin" }));
  assert.ok(!allowed({ host: "192.168.1.20:3000" }));
  assert.ok(!allowed({}));
});

test("answers a refusal with 403 and a reason", async () => {
  const response = rejectUnlessLocal(request({ host: "evil.example" }));
  assert.equal(response?.status, 403);
  assert.match((await response!.json()).error, /localhost/);
});
