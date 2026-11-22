import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenWindow } from "../lib/types.ts";
import { rowsFor, shortAddress } from "../lib/window-rows.ts";

const win = (key: string, isPrivate: boolean, launch: number): OpenWindow => ({
  key,
  browser: "brave",
  private: isPrivate,
  openedUrl: "https://example.com/",
  launch,
  hasPreview: true,
});

test("pairs the normal and incognito window of one launch", () => {
  const rows = rowsFor("brave", [win("n", false, 100), win("i", true, 100)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].normal?.key, "n");
  assert.equal(rows[0].incognito?.key, "i");
});

test("gives each launch its own line, newest first", () => {
  const rows = rowsFor("brave", [
    win("old-n", false, 100),
    win("old-i", true, 100),
    win("new-n", false, 200),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.normal?.key ?? null, row.incognito?.key ?? null]),
    [["new-n", null], ["old-n", "old-i"]],
  );
});

test("leaves the side empty when one window of a pair is gone", () => {
  const [row] = rowsFor("brave", [win("i", true, 100)]);
  assert.equal(row.normal, null);
  assert.equal(row.incognito?.key, "i");
});

test("no windows, no lines", () => {
  assert.deepEqual(rowsFor("brave", []), []);
});

test("shortens an address to what identifies the page", () => {
  assert.equal(shortAddress("https://example.com/"), "example.com");
  assert.equal(shortAddress("http://localhost:3000/a/b?c=1"), "localhost:3000/a/b?c=1");
  assert.equal(shortAddress("not an address"), "not an address");
});
