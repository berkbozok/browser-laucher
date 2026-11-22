import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { WindowHandle } from "./types";

/** One window the launcher opened and is keeping track of. */
export type RegisteredWindow = {
  /** Unique, and safe to put in a URL. */
  key: string;
  /** Id of the browser it belongs to. */
  browser: string;
  handle: WindowHandle;
  /** True for the incognito window of a launch. */
  private: boolean;
  /** The address it was opened on. */
  url: string;
  /** When it was opened, in milliseconds. */
  launch: number;
};

/**
 * The list lives in a file rather than in memory or in the page: it has to
 * survive the dev server reloading its code, a page refresh, and a response
 * that never reached the page. The windows themselves live on regardless.
 */
const FOLDER =
  // Tests point this somewhere of their own.
  process.env.BROWSER_LAUNCHER_STATE_DIR ??
  path.join(/* turbopackIgnore: true */ tmpdir(), "browser-launcher");
const FILE = path.join(/* turbopackIgnore: true */ FOLDER, "windows.json");

/**
 * One run of a browser that the launcher itself started, because the
 * browser wasn't open. Close may quit such a browser again once it is empty.
 */
export type StartedBrowser = {
  browser: string;
  pid: number;
  startedAt: number;
};

type Saved = { windows: RegisteredWindow[]; started: StartedBrowser[] };

/** Far more than anyone opens; just a ceiling on how big the file can get. */
const MAX_WINDOWS = 500;

export function keyFor(browser: string, handle: WindowHandle): string {
  return [browser, handle.pid, handle.startedAt, handle.windowId].join("~");
}

function isRegisteredWindow(value: unknown): value is RegisteredWindow {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const handle = item.handle as Record<string, unknown> | null | undefined;
  return (
    typeof item.key === "string" &&
    typeof item.browser === "string" &&
    typeof item.private === "boolean" &&
    typeof item.url === "string" &&
    typeof item.launch === "number" &&
    typeof handle === "object" &&
    handle !== null &&
    (typeof handle.windowId === "string" ||
      typeof handle.windowId === "number") &&
    typeof handle.pid === "number" &&
    typeof handle.startedAt === "number"
  );
}

function isStartedBrowser(value: unknown): value is StartedBrowser {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.browser === "string" &&
    typeof item.pid === "number" &&
    typeof item.startedAt === "number"
  );
}

async function read(): Promise<Saved> {
  try {
    const saved: unknown = JSON.parse(await readFile(FILE, "utf8"));
    // Earlier versions saved just the list of windows.
    if (Array.isArray(saved)) {
      return { windows: saved.filter(isRegisteredWindow), started: [] };
    }
    const { windows, started } = (saved ?? {}) as Record<string, unknown>;
    return {
      windows: Array.isArray(windows) ? windows.filter(isRegisteredWindow) : [],
      started: Array.isArray(started) ? started.filter(isStartedBrowser) : [],
    };
  } catch {
    // No file yet, or one we can't make sense of.
    return { windows: [], started: [] };
  }
}

async function write(saved: Saved): Promise<void> {
  await mkdir(FOLDER, { recursive: true });
  // Written beside the real file and moved into place, so a reader never
  // sees half a file.
  const draft = `${FILE}.${process.pid}.tmp`;
  await writeFile(
    draft,
    JSON.stringify({
      windows: saved.windows.slice(-MAX_WINDOWS),
      started: saved.started.slice(-50),
    }),
  );
  await rename(draft, FILE);
}

// Changes are made one after another, so two requests can't overwrite each
// other's additions.
let queue: Promise<unknown> = Promise.resolve();

/** `edit` returns the new state, or the same object to leave it as it is. */
function change(edit: (saved: Saved) => Saved): Promise<void> {
  const done = queue.then(async () => {
    const before = await read();
    const after = edit(before);
    if (after !== before) await write(after);
  });
  queue = done.catch(() => undefined);
  return done;
}

function current(): Promise<Saved> {
  // Behind any change that is still being written.
  return queue.then(read);
}

export async function listRegisteredWindows(): Promise<RegisteredWindow[]> {
  return (await current()).windows;
}

export function registerWindows(
  added: readonly Omit<RegisteredWindow, "key">[],
): Promise<void> {
  if (added.length === 0) return Promise.resolve();
  return change((saved) => {
    const fresh = added.map((item) => ({
      ...item,
      key: keyFor(item.browser, item.handle),
    }));
    const taken = new Set(fresh.map((item) => item.key));
    return {
      ...saved,
      windows: [
        ...saved.windows.filter((item) => !taken.has(item.key)),
        ...fresh,
      ],
    };
  });
}

export function forgetWindows(keys: ReadonlySet<string>): Promise<void> {
  if (keys.size === 0) return Promise.resolve();
  return change((saved) => {
    const kept = saved.windows.filter((item) => !keys.has(item.key));
    return kept.length === saved.windows.length
      ? saved
      : { ...saved, windows: kept };
  });
}

/** Changes the address a window is remembered as being opened on. */
export function retargetWindows(
  keys: ReadonlySet<string>,
  url: string,
): Promise<void> {
  if (keys.size === 0) return Promise.resolve();
  return change((saved) => ({
    ...saved,
    windows: saved.windows.map((item) =>
      keys.has(item.key) ? { ...item, url } : item,
    ),
  }));
}

export async function listStartedBrowsers(): Promise<StartedBrowser[]> {
  return (await current()).started;
}

const sameRun = (a: StartedBrowser, b: StartedBrowser) =>
  a.browser === b.browser && a.pid === b.pid && a.startedAt === b.startedAt;

export function noteStartedBrowsers(
  runs: readonly StartedBrowser[],
): Promise<void> {
  if (runs.length === 0) return Promise.resolve();
  // The same run may be handed in more than once; keep one of each.
  const fresh = runs.filter(
    (run, index) => runs.findIndex((other) => sameRun(other, run)) === index,
  );
  return change((saved) => ({
    ...saved,
    started: [
      ...saved.started.filter((old) => !fresh.some((run) => sameRun(old, run))),
      ...fresh,
    ],
  }));
}

export function forgetStartedBrowsers(
  runs: readonly StartedBrowser[],
): Promise<void> {
  if (runs.length === 0) return Promise.resolve();
  return change((saved) => {
    const kept = saved.started.filter(
      (old) => !runs.some((run) => sameRun(old, run)),
    );
    return kept.length === saved.started.length
      ? saved
      : { ...saved, started: kept };
  });
}
