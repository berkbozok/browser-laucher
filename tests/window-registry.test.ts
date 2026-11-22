import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The registry reads this once, when it is first loaded.
const folder = mkdtempSync(path.join(tmpdir(), "browser-launcher-test-"));
process.env.BROWSER_LAUNCHER_STATE_DIR = folder;
const registry = await import("../lib/window-registry.ts");

const handle = (windowId: number) => ({ windowId, pid: 10, startedAt: 1000 });
const entry = (windowId: number, isPrivate = false) => ({
  browser: "brave",
  handle: handle(windowId),
  private: isPrivate,
  url: "https://example.com/",
  launch: 5,
});

test("starts empty", async () => {
  assert.deepEqual(await registry.listRegisteredWindows(), []);
  assert.deepEqual(await registry.listStartedBrowsers(), []);
});

test("remembers windows under a key made from browser and handle", async () => {
  await registry.registerWindows([entry(1), entry(2, true)]);
  const windows = await registry.listRegisteredWindows();
  assert.deepEqual(windows.map((w) => w.key), ["brave~10~1000~1", "brave~10~1000~2"]);
  assert.equal(windows[1].private, true);
});

test("registering the same window again replaces it", async () => {
  await registry.registerWindows([{ ...entry(1), url: "https://changed.example/" }]);
  const windows = await registry.listRegisteredWindows();
  assert.equal(windows.length, 2);
  assert.equal(windows.find((w) => w.handle.windowId === 1)?.url, "https://changed.example/");
});

test("changes made at the same moment all land", async () => {
  await Promise.all([3, 4, 5, 6].map((id) => registry.registerWindows([entry(id)])));
  assert.equal((await registry.listRegisteredWindows()).length, 6);
});

test("retargeting changes the remembered address", async () => {
  await registry.retargetWindows(new Set(["brave~10~1000~3"]), "https://new.example/");
  const windows = await registry.listRegisteredWindows();
  assert.equal(windows.find((w) => w.key === "brave~10~1000~3")?.url, "https://new.example/");
});

test("forgets only the windows named", async () => {
  await registry.forgetWindows(new Set(["brave~10~1000~1", "no-such-key"]));
  const keys = (await registry.listRegisteredWindows()).map((w) => w.key);
  assert.ok(!keys.includes("brave~10~1000~1"));
  assert.equal(keys.length, 5);
});

test("remembers and forgets browsers the launcher started", async () => {
  const run = { browser: "opera", pid: 7, startedAt: 42 };
  await registry.noteStartedBrowsers([run, run]);
  assert.deepEqual(await registry.listStartedBrowsers(), [run]);
  await registry.forgetStartedBrowsers([run]);
  assert.deepEqual(await registry.listStartedBrowsers(), []);
});

test("reads the list an earlier version saved, and ignores junk", async () => {
  const file = path.join(folder, "windows.json");
  const good = JSON.parse(readFileSync(file, "utf8")).windows[0];
  writeFileSync(file, JSON.stringify([good, { nonsense: true }, null]));
  assert.deepEqual(await registry.listRegisteredWindows(), [good]);

  writeFileSync(file, "not json at all");
  assert.deepEqual(await registry.listRegisteredWindows(), []);
});
