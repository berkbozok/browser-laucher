import type { OpenResult, WindowHandle } from "./types";

/** One window the launcher opened and can find again. */
export type TrackedWindow = {
  handle: WindowHandle;
  /** True for the incognito window of a launch. */
  private: boolean;
  /** The address it was opened on. */
  url: string;
  /**
   * When it was opened, in milliseconds. The windows from one press of Open
   * share the same value, which is how a normal window finds its incognito
   * partner.
   */
  launch: number;
};

/** The launcher's open windows, per browser id. */
export type TrackedWindows = Record<string, TrackedWindow[]>;

/**
 * The most windows remembered per browser, which is also the most the server
 * handles in one request. Beyond it the oldest are dropped; by then they are
 * windows that were closed by hand long ago.
 */
export const MAX_TRACKED_PER_BROWSER = 200;

function isHandle(value: unknown): value is WindowHandle {
  if (typeof value !== "object" || value === null) return false;
  const { windowId, pid, startedAt } = value as Record<string, unknown>;
  return (
    (typeof windowId === "string" || typeof windowId === "number") &&
    typeof pid === "number" &&
    typeof startedAt === "number"
  );
}

function readTrackedWindow(value: unknown): TrackedWindow | null {
  // Before windows were listed on the page, only the bare handle was saved.
  if (isHandle(value)) {
    return { handle: value, private: false, url: "", launch: 0 };
  }
  if (typeof value !== "object" || value === null) return null;
  const { handle, private: isPrivate, url, launch } = value as Record<
    string,
    unknown
  >;
  if (!isHandle(handle)) return null;
  return {
    handle,
    private: isPrivate === true,
    url: typeof url === "string" ? url : "",
    launch: typeof launch === "number" ? launch : 0,
  };
}

/** Reads what was saved in the browser's storage, dropping anything odd. */
export function readTrackedWindows(value: unknown): TrackedWindows {
  if (typeof value !== "object" || value === null) return {};
  const windows: TrackedWindows = {};
  for (const [id, saved] of Object.entries(value)) {
    if (!Array.isArray(saved)) continue;
    const valid = saved.flatMap((item) => readTrackedWindow(item) ?? []);
    if (valid.length > 0) windows[id] = valid.slice(-MAX_TRACKED_PER_BROWSER);
  }
  return windows;
}

/** The windows one browser just opened that can be found again, if any. */
export function windowsFrom(
  result: OpenResult,
  url: string,
  launch: number,
): TrackedWindow[] {
  const windows: TrackedWindow[] = [];
  if (result.handle) {
    windows.push({ handle: result.handle, private: false, url, launch });
  }
  if (result.privateWindow?.status === "opened" && result.privateWindow.handle) {
    windows.push({
      handle: result.privateWindow.handle,
      private: true,
      url,
      launch,
    });
  }
  return windows;
}

/** A string that is the same for the same window and different otherwise. */
export function windowKey(browser: string, handle: WindowHandle): string {
  return `${browser}/${handle.pid}/${handle.startedAt}/${handle.windowId}`;
}

/** Everything in `windows` except the ones whose keys are in `gone`. */
export function withoutWindows(
  windows: TrackedWindows,
  gone: ReadonlySet<string>,
): TrackedWindows {
  if (gone.size === 0) return windows;
  let changed = false;
  const next: TrackedWindows = {};
  for (const [browser, list] of Object.entries(windows)) {
    const kept = list.filter(
      (item) => !gone.has(windowKey(browser, item.handle)),
    );
    if (kept.length !== list.length) changed = true;
    if (kept.length > 0) next[browser] = kept;
  }
  // Hand back the same object when nothing changed, so React doesn't see a
  // new value.
  return changed ? next : windows;
}
