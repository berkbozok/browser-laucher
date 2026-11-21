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
const FOLDER = path.join(/* turbopackIgnore: true */ tmpdir(), "browser-launcher");
const FILE = path.join(/* turbopackIgnore: true */ FOLDER, "windows.json");

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

async function read(): Promise<RegisteredWindow[]> {
  try {
    const saved: unknown = JSON.parse(await readFile(FILE, "utf8"));
    return Array.isArray(saved) ? saved.filter(isRegisteredWindow) : [];
  } catch {
    return []; // No file yet, or one we can't make sense of.
  }
}

async function write(windows: RegisteredWindow[]): Promise<void> {
  await mkdir(FOLDER, { recursive: true });
  // Written beside the real file and moved into place, so a reader never
  // sees half a file.
  const draft = `${FILE}.${process.pid}.tmp`;
  await writeFile(draft, JSON.stringify(windows.slice(-MAX_WINDOWS)));
  await rename(draft, FILE);
}

// Changes are made one after another, so two requests can't overwrite each
// other's additions.
let queue: Promise<unknown> = Promise.resolve();

function change(
  edit: (windows: RegisteredWindow[]) => RegisteredWindow[],
): Promise<void> {
  const done = queue.then(async () => {
    const before = await read();
    const after = edit(before);
    if (after !== before) await write(after);
  });
  queue = done.catch(() => undefined);
  return done;
}

export function listRegisteredWindows(): Promise<RegisteredWindow[]> {
  // Behind any change that is still being written.
  return queue.then(read);
}

export function registerWindows(
  added: readonly Omit<RegisteredWindow, "key">[],
): Promise<void> {
  if (added.length === 0) return Promise.resolve();
  return change((windows) => {
    const fresh = added.map((item) => ({
      ...item,
      key: keyFor(item.browser, item.handle),
    }));
    const taken = new Set(fresh.map((item) => item.key));
    return [...windows.filter((item) => !taken.has(item.key)), ...fresh];
  });
}

export function forgetWindows(keys: ReadonlySet<string>): Promise<void> {
  if (keys.size === 0) return Promise.resolve();
  return change((windows) => {
    const kept = windows.filter((item) => !keys.has(item.key));
    return kept.length === windows.length ? windows : kept;
  });
}
