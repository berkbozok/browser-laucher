import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeAction, summarizeClose, summarizeOpen } from "../lib/summaries.ts";

test("open: counts browsers when there is no incognito", () => {
  const notice = summarizeOpen([
    { id: "a", name: "A", ok: true },
    { id: "b", name: "B", ok: true },
  ]);
  assert.deepEqual(notice, { text: "Opened in 2 browsers.", allGood: true });
});

test("open: counts windows with incognito, and names browsers that only do normal", () => {
  const notice = summarizeOpen([
    { id: "a", name: "A", ok: true, privateWindow: { status: "opened" } },
    { id: "b", name: "B", ok: true, privateWindow: { status: "unsupported" } },
  ]);
  assert.equal(notice?.text, "Opened 3 windows in 2 browsers. B can only open a normal window from here.");
  assert.equal(notice?.allGood, true);
});

test("open: says why a window failed", () => {
  const notice = summarizeOpen([
    { id: "a", name: "A", ok: true, privateWindow: { status: "failed", error: "No luck." } },
  ]);
  assert.equal(notice?.text, "Opened 1 of 2 windows. 1 failed. A: No luck.");
  assert.equal(notice?.allGood, false);
});

test("open: points at the list for browsers that can't be followed", () => {
  const notice = summarizeOpen([{ id: "a", name: "A", ok: true, untracked: "unsupported" }]);
  assert.match(notice!.text, /A can't be followed from here/);
});

test("open: nothing opened, nothing to say", () => {
  assert.equal(summarizeOpen([]), null);
});

test("close: counts, already-gone windows, and browsers that were quit", () => {
  assert.equal(
    summarizeClose([
      { id: "a", name: "A", closed: 2, alreadyGone: 1, quit: true },
      { id: "b", name: "B", closed: 1, alreadyGone: 0 },
    ]).text,
    "Closed 3 windows. 1 had already been closed. Quit A.",
  );
  assert.equal(summarizeClose([{ id: "a", name: "A", closed: 0, alreadyGone: 1 }]).text, "That window had already been closed.");
  assert.equal(summarizeClose([]).text, "There was nothing to close.");
});

test("close: an error makes it not all good", () => {
  const notice = summarizeClose([{ id: "a", name: "A", closed: 0, alreadyGone: 0, error: "Stuck." }]);
  assert.deepEqual(notice, { text: "A: Stuck.", allGood: false });
});

test("action: words the success with what it was given", () => {
  const notice = summarizeAction((n) => `Reloaded ${n}.`, [
    { id: "a", name: "A", done: 2, gone: 1 },
    { id: "b", name: "B", done: 1, gone: 0, error: "Couldn't." },
  ]);
  assert.deepEqual(notice, { text: "Reloaded 3. 1 window had already been closed. B: Couldn't.", allGood: false });
  assert.equal(summarizeAction((n) => `x${n}`, []).text, "There were no open windows to do that with.");
});
