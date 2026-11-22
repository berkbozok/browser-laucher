import type { ActionResult, CloseResult, OpenResult } from "./types";
import { nameList, plural } from "./words.ts";

/** A line for the person: what just happened, and whether all of it worked. */
export type Notice = { text: string; allGood: boolean };

/** One line describing how a launch went, across all browsers. */
export function summarizeOpen(results: OpenResult[]): Notice | null {
  if (results.length === 0) return null;

  const privateWindows = results.flatMap((r) => r.privateWindow ?? []);
  const opened =
    results.filter((r) => r.ok).length +
    privateWindows.filter((p) => p.status === "opened").length;
  const failed =
    results.filter((r) => !r.ok).length +
    privateWindows.filter((p) => p.status === "failed").length;
  const namesWhere = (test: (result: OpenResult) => boolean) =>
    results.filter(test).map((r) => r.name);

  const parts: string[] = [];
  if (privateWindows.length === 0) {
    parts.push(
      failed === 0
        ? `Opened in ${plural(opened, "browser")}.`
        : `Opened in ${opened} of ${plural(results.length, "browser")}. ${failed} failed.`,
    );
  } else {
    parts.push(
      failed === 0
        ? `Opened ${plural(opened, "window")} in ${plural(results.length, "browser")}.`
        : `Opened ${opened} of ${plural(opened + failed, "window")}. ${failed} failed.`,
    );
    const normalOnly = namesWhere(
      (r) => r.privateWindow?.status === "unsupported",
    );
    if (normalOnly.length > 0) {
      parts.push(
        `${nameList.format(normalOnly)} can only open a normal window from here.`,
      );
    }
  }

  // Say why, for each window that didn't open.
  for (const result of results) {
    if (!result.ok && result.error) {
      parts.push(`${result.name}: ${result.error}`);
    }
    if (result.privateWindow?.status === "failed") {
      parts.push(`${result.name}: ${result.privateWindow.error}`);
    }
  }

  // Browsers that opened but can't be followed get a line in the list of
  // open windows; point there rather than repeating it.
  const lost = namesWhere((r) => r.untracked !== undefined);
  if (lost.length > 0) {
    parts.push(
      `${nameList.format(lost)} can't be followed from here; see the note in the list below.`,
    );
  }

  return {
    text: parts.join(" "),
    allGood:
      failed === 0 && !results.some((r) => r.untracked === "not-allowed"),
  };
}

export function summarizeClose(results: CloseResult[]): Notice {
  const closed = results.reduce((sum, r) => sum + r.closed, 0);
  const gone = results.reduce((sum, r) => sum + r.alreadyGone, 0);
  const quit = results.filter((r) => r.quit).map((r) => r.name);
  const failures = results.filter((r) => r.error);

  const parts: string[] = [];
  if (closed > 0) parts.push(`Closed ${plural(closed, "window")}.`);
  if (gone > 0) {
    parts.push(
      closed > 0
        ? `${gone} had already been closed.`
        : gone === 1
          ? "That window had already been closed."
          : "Those windows had already been closed.",
    );
  }
  if (quit.length > 0) parts.push(`Quit ${nameList.format(quit)}.`);
  for (const failure of failures) {
    parts.push(`${failure.name}: ${failure.error}`);
  }
  if (parts.length === 0) parts.push("There was nothing to close.");
  return { text: parts.join(" "), allGood: failures.length === 0 };
}

/**
 * One line for an instruction given to open windows. `done` words the
 * success, for example (n) => `Reloaded ${n} windows.`
 */
export function summarizeAction(
  done: (count: number) => string,
  results: ActionResult[],
): Notice {
  const count = results.reduce((sum, r) => sum + r.done, 0);
  const gone = results.reduce((sum, r) => sum + r.gone, 0);
  const failures = results.filter((r) => r.error);

  const parts: string[] = [];
  if (count > 0) parts.push(done(count));
  if (gone > 0) {
    parts.push(
      `${plural(gone, "window")} had already been closed.`,
    );
  }
  for (const failure of failures) {
    parts.push(`${failure.name}: ${failure.error}`);
  }
  if (parts.length === 0) parts.push("There were no open windows to do that with.");
  return { text: parts.join(" "), allGood: failures.length === 0 };
}
