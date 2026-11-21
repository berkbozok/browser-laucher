import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Longest side of a preview picture, in pixels. */
const MAX_SIDE = 900;
/** Pictures being taken at any one moment. Each costs a little CPU. */
const AT_ONCE = 3;
/** A picture this fresh is handed out again rather than retaken. */
const FRESH_FOR_MS = 700;

let busy = 0;
const waiting: (() => void)[] = [];

async function takeTurn<T>(work: () => Promise<T>): Promise<T> {
  if (busy >= AT_ONCE) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  busy++;
  try {
    return await work();
  } finally {
    busy--;
    waiting.shift()?.();
  }
}

async function capture(screenId: number): Promise<Buffer | null> {
  const folder = await mkdtemp(
    path.join(/* turbopackIgnore: true */ tmpdir(), "browser-launcher-shot-"),
  );
  try {
    const file = path.join(/* turbopackIgnore: true */ folder, "window.jpg");
    // -l: this one window, wherever it sits and whatever covers it.
    // -o: without its shadow.  -x: without the camera sound.
    await run(
      "/usr/sbin/screencapture",
      ["-x", "-o", `-l${screenId}`, "-t", "jpg", file],
      { timeout: 5000 },
    );
    await run(
      "/usr/bin/sips",
      ["-Z", String(MAX_SIDE), "-s", "formatOptions", "70", file],
      { timeout: 5000 },
    );
    return await readFile(file);
  } catch {
    // The window is gone or minimised, or macOS hasn't allowed pictures.
    return null;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

const recent = new Map<number, { at: number; picture: Promise<Buffer | null> }>();

/**
 * A JPEG of one window as it looks right now, or null if it can't be taken.
 * `screenId` is macOS's own number for the window. Needs the Screen
 * Recording permission.
 */
export function pictureOfWindow(screenId: number): Promise<Buffer | null> {
  const last = recent.get(screenId);
  if (last && Date.now() - last.at < FRESH_FOR_MS) return last.picture;

  const picture = takeTurn(() => capture(screenId));
  recent.set(screenId, { at: Date.now(), picture });
  // Don't let the map grow with windows that are long gone.
  if (recent.size > 200) {
    for (const [id, entry] of recent) {
      if (Date.now() - entry.at > 60_000) recent.delete(id);
    }
  }
  return picture;
}
