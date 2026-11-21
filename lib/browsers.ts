import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pictureOfWindow } from "./preview";
import type {
  CloseResult,
  FocusResponse,
  OpenResult,
  OpenWindow,
  Untracked,
  WindowHandle,
  WindowsResponse,
} from "./types";
import {
  forgetWindows,
  listRegisteredWindows,
  registerWindows,
  type RegisteredWindow,
} from "./window-registry";
import {
  closeTrackedWindows,
  describeTrackedWindows,
  focusTrackedWindow,
  openTrackedWindow,
  type CommandLineSteps,
  type ScriptingKind,
} from "./window-control";

const run = promisify(execFile);

type BrowserDefinition = {
  id: string;
  name: string;
  /** App bundle names to look for on macOS. */
  macApps: readonly string[];
  /**
   * Command-line switch that opens a URL in a private (incognito) window.
   * Leave it out for browsers that have none — Safari, for one — and only add
   * a switch you have checked: a browser that ignores it would quietly open
   * the page in a normal window instead.
   */
  privateFlag?: string;
  /**
   * Set for browsers that put a link from another app into whichever of their
   * windows was used last, even a private one (Opera does). Their normal
   * window is requested on the command line instead, which always uses the
   * normal profile.
   */
  linksFollowLastWindow?: boolean;
  /**
   * How the browser can be controlled through macOS scripting, which is what
   * lets the launcher close the windows it opened. Leave it out for browsers
   * that can't be (their windows still open, they just have to be closed by
   * hand).
   */
  scripting?: ScriptingKind;
};

/**
 * Every browser the launcher knows about. To support another one, add it here.
 *
 * Opening, private windows and closing were checked on Chrome, Brave,
 * Firefox, Safari, Opera, Edge, Vivaldi and Zen. The remaining entries that
 * have a private switch are built on the same engines and use the same one.
 * Entries without `scripting` (DuckDuckGo, Orion, Arc, Tor) just get the page
 * handed to them: a normal window only, closed by hand.
 */
const CATALOG: readonly BrowserDefinition[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    macApps: ["Google Chrome.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "brave",
    name: "Brave",
    macApps: ["Brave Browser.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "firefox",
    name: "Firefox",
    macApps: ["Firefox.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  {
    id: "safari",
    name: "Safari",
    macApps: ["Safari.app"],
    scripting: "safari",
  },
  {
    id: "opera",
    name: "Opera",
    macApps: ["Opera.app"],
    privateFlag: "--private",
    linksFollowLastWindow: true,
    scripting: "chromium",
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    macApps: ["Microsoft Edge.app"],
    privateFlag: "--inprivate",
    scripting: "chromium",
  },
  { id: "arc", name: "Arc", macApps: ["Arc.app"] },
  {
    id: "vivaldi",
    name: "Vivaldi",
    macApps: ["Vivaldi.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "opera-gx",
    name: "Opera GX",
    macApps: ["Opera GX.app"],
    privateFlag: "--private",
    linksFollowLastWindow: true,
    scripting: "chromium",
  },
  {
    id: "chromium",
    name: "Chromium",
    macApps: ["Chromium.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  { id: "duckduckgo", name: "DuckDuckGo", macApps: ["DuckDuckGo.app"] },
  {
    id: "zen",
    name: "Zen",
    macApps: ["Zen.app", "Zen Browser.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  { id: "orion", name: "Orion", macApps: ["Orion.app"] },
  { id: "tor", name: "Tor Browser", macApps: ["Tor Browser.app"] },
  {
    id: "firefox-dev",
    name: "Firefox Developer Edition",
    macApps: ["Firefox Developer Edition.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  {
    id: "chrome-canary",
    name: "Chrome Canary",
    macApps: ["Google Chrome Canary.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "safari-tp",
    name: "Safari Technology Preview",
    macApps: ["Safari Technology Preview.app"],
    scripting: "safari",
  },
];

export type DetectedBrowser = {
  id: string;
  name: string;
  /** Absolute path of the installed app, or null when it isn't installed. */
  appPath: string | null;
  /** Switch for opening a private window, or null when the browser has none. */
  privateFlag: string | null;
  /** Whether a private window can be opened at all, by switch or otherwise. */
  supportsPrivate: boolean;
  /** The private window is made by pressing the browser's menu (Safari). */
  privateViaMenu: boolean;
  /** See BrowserDefinition.linksFollowLastWindow. */
  linksFollowLastWindow: boolean;
  /** See BrowserDefinition.scripting. */
  scripting: ScriptingKind | null;
};

type InstalledBrowser = DetectedBrowser & { appPath: string };

/** Detection and launching are macOS-only for now. */
export const isSupportedPlatform = process.platform === "darwin";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findApp(names: readonly string[]): Promise<string | null> {
  const folders = ["/Applications", path.join(homedir(), "Applications")];
  for (const folder of folders) {
    for (const name of names) {
      // These are apps on the host, not project files, so keep the bundler's
      // file tracing away from them.
      const candidate = path.join(/* turbopackIgnore: true */ folder, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  return Promise.all(
    CATALOG.map(async (definition) => ({
      id: definition.id,
      name: definition.name,
      appPath: isSupportedPlatform ? await findApp(definition.macApps) : null,
      privateFlag: definition.privateFlag ?? null,
      // Safari has no switch, but its menu can be pressed (see window-control).
      supportsPrivate:
        definition.privateFlag !== undefined ||
        definition.scripting === "safari",
      privateViaMenu: definition.scripting === "safari",
      linksFollowLastWindow: definition.linksFollowLastWindow ?? false,
      scripting: definition.scripting ?? null,
    })),
  );
}

function describeFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const { stderr } = error;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : "Could not open the browser.";
}

/** Runs macOS's `open`. execFile passes arguments directly, with no shell. */
async function runOpen(args: string[]): Promise<void> {
  await run("/usr/bin/open", args, { timeout: 15_000 });
}

/**
 * Hands `browserArgs` to the browser's own command line. macOS only passes
 * arguments to a newly started copy (-n); when the browser is already open,
 * that copy forwards the request to it and exits straight away.
 */
function openWithArgs(appPath: string, browserArgs: string[]): Promise<void> {
  return runOpen(["-n", "-a", appPath, "--args", ...browserArgs]);
}

/**
 * Opens the page without keeping track of the window. This is the fallback
 * for browsers the launcher can't control, or isn't allowed to.
 */
function openUntracked(
  browser: InstalledBrowser,
  url: string,
  privateFlag: string | null,
): Promise<void> {
  if (privateFlag) return openWithArgs(browser.appPath, [privateFlag, url]);
  return browser.linksFollowLastWindow
    ? openWithArgs(browser.appPath, [url])
    : runOpen(["-a", browser.appPath, url]);
}

/**
 * The commands that give Firefox a window of its own for the page. A normal
 * one takes a single command. A private one takes two, because Firefox adds
 * a private page to a private window that is already open instead of making
 * a new one: an empty private window first, then the page, which lands in it
 * as the private window used last.
 */
function firefoxSteps(
  appPath: string,
  url: string,
  privateFlag: string | null,
): CommandLineSteps {
  const start = () => runOpen(["-a", appPath]);
  if (!privateFlag) {
    return {
      start,
      newWindow: () => openWithArgs(appPath, ["--new-window", url]),
    };
  }
  return {
    start,
    newWindow: () => openWithArgs(appPath, [privateFlag]),
    load: () => openWithArgs(appPath, [privateFlag, url]),
  };
}

type WindowOutcome =
  | { ok: true; handle: WindowHandle }
  | { ok: true; handle?: undefined; untracked: Untracked; detail?: string }
  | { ok: false; error: string };

/**
 * Opens one window, normal or private. It is opened in a way the launcher
 * can close again whenever the browser allows that. `track: false` means an
 * earlier step already found macOS in the way, so scripting isn't tried
 * again (each try can sit on an unanswered permission prompt for a minute).
 */
async function openWindow(
  browser: InstalledBrowser,
  url: string,
  { isPrivate, track }: { isPrivate: boolean; track: boolean },
): Promise<WindowOutcome> {
  const privateFlag = isPrivate ? browser.privateFlag : null;
  // A private window with no switch to fall back on (Safari) can only be
  // made through scripting.
  const scriptingOnly = isPrivate && privateFlag === null;
  if (scriptingOnly && !track) {
    return { ok: false, error: menuPermissionMessage(browser.name) };
  }

  let untracked: Untracked = "unsupported";
  let detail: string | undefined;
  try {
    if (browser.scripting && track) {
      const tracked = await openTrackedWindow({
        kind: browser.scripting,
        appPath: browser.appPath,
        url,
        private: isPrivate,
        commandLine: firefoxSteps(browser.appPath, url, privateFlag),
      });
      if (tracked.opened) {
        return tracked.handle
          ? { ok: true, handle: tracked.handle }
          : { ok: true, untracked: "unidentified", detail: tracked.detail };
      }
      if (tracked.privateUnavailable) {
        // The switch would get a normal window too, and we'd report it as
        // private.
        return {
          ok: false,
          error: `${browser.name} opened a normal window when asked for a private one, so it was closed again. Private browsing may be switched off in ${browser.name}.`,
        };
      }
      if (scriptingOnly) {
        return {
          ok: false,
          error:
            tracked.needsAccessibility || tracked.notAllowed
              ? menuPermissionMessage(browser.name)
              : tracked.detail,
        };
      }
      untracked = tracked.notAllowed ? "not-allowed" : "unidentified";
      detail = tracked.detail;
    } else if (browser.scripting) {
      untracked = "not-allowed";
    }
    await openUntracked(browser, url, privateFlag);
    return { ok: true, untracked, detail };
  } catch (error) {
    return { ok: false, error: describeFailure(error) };
  }
}

/**
 * Opens `url` in each of the given browsers and reports how each one went.
 * With `includePrivate`, every browser that can also gets a private window.
 * `url` must already be validated (see normalizeUrl) — it is handed straight
 * to the browser.
 */
export async function openInBrowsers(
  url: string,
  ids: readonly string[],
  { includePrivate = false }: { includePrivate?: boolean } = {},
): Promise<OpenResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));

  const openOne = async (id: string): Promise<OpenResult> => {
    const found = detected.get(id);
    if (!found) {
      return { id, name: id, ok: false, error: "Unknown browser." };
    }
    const { name, appPath } = found;
    if (!appPath) {
      return { id, name, ok: false, error: "Not installed." };
    }
    const browser: InstalledBrowser = { ...found, appPath };

    const normal = await openWindow(browser, url, {
      isPrivate: false,
      track: true,
    });
    const result: OpenResult = normal.ok
      ? { id, name, ok: true }
      : { id, name, ok: false, error: normal.error };
    const noteUntracked = (outcome: WindowOutcome) => {
      if (!outcome.ok || outcome.handle || result.untracked) return;
      result.untracked = outcome.untracked;
      result.untrackedDetail = outcome.detail;
    };
    if (normal.ok) result.handle = normal.handle;
    noteUntracked(normal);

    // The normal window goes first so a browser that wasn't running is
    // already up by the time the private window is requested.
    if (includePrivate) {
      if (!browser.supportsPrivate) {
        result.privateWindow = { status: "unsupported" };
      } else {
        const extra = await openWindow(browser, url, {
          isPrivate: true,
          // Don't sit through a second unanswered permission prompt.
          track: result.untracked !== "not-allowed",
        });
        noteUntracked(extra);
        result.privateWindow = extra.ok
          ? { status: "opened", handle: extra.handle }
          : { status: "failed", error: extra.error };
      }
    }
    return result;
  };

  const launch = Date.now();
  const results = await Promise.all([...new Set(ids)].map(openOne));

  // Remember every window we can find again, so the page can list them,
  // show them and close them, whether or not this reply reaches it.
  await registerWindows(
    results.flatMap((result) => {
      const windows: Omit<RegisteredWindow, "key">[] = [];
      const add = (handle: WindowHandle | undefined, isPrivate: boolean) => {
        if (!handle) return;
        windows.push({ browser: result.id, handle, private: isPrivate, url, launch });
      };
      add(result.handle, false);
      if (result.privateWindow?.status === "opened") {
        add(result.privateWindow.handle, true);
      }
      return windows;
    }),
  );
  return results;
}

/**
 * For a private window that can only be made by pressing the browser's menu.
 * macOS guards that with two permissions, and a refusal or an unanswered
 * prompt for either one looks the same from here.
 */
function menuPermissionMessage(name: string): string {
  return `${name} only opens a private window when the launcher presses its menu, and macOS has to allow that. Click Allow if it asks about “System Events”, and turn on the app running the launcher (Terminal, Cursor, …) under System Settings → Privacy & Security → Accessibility. Then try again.`;
}

/** What to tell someone when macOS is what stands between us and a browser. */
function notAllowedMessage(name: string): string {
  return `macOS hasn't allowed the launcher to control ${name}. Allow it under System Settings → Privacy & Security → Automation.`;
}

function byBrowser(
  windows: readonly RegisteredWindow[],
): Map<string, RegisteredWindow[]> {
  const groups = new Map<string, RegisteredWindow[]>();
  for (const item of windows) {
    const group = groups.get(item.browser);
    if (group) group.push(item);
    else groups.set(item.browser, [item]);
  }
  return groups;
}

/**
 * The launcher's windows that are still open, with what each is showing.
 * Windows that turn out to be gone (closed by hand, browser quit) are
 * forgotten along the way.
 */
export async function listOpenWindows(): Promise<WindowsResponse> {
  const registered = await listRegisteredWindows();
  if (registered.length === 0) return { windows: [], mayCapture: null };

  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));
  const gone = new Set<string>();
  let mayCapture: boolean | null = null;

  const groups = await Promise.all(
    [...byBrowser(registered)].map(async ([id, items]): Promise<OpenWindow[]> => {
      const browser = detected.get(id);
      if (!browser?.appPath || !browser.scripting) {
        // The browser was removed. Nothing can be done with these any more.
        items.forEach((item) => gone.add(item.key));
        return [];
      }
      const outcome = await describeTrackedWindows(
        browser.scripting,
        browser.appPath,
        items.map((item) => item.handle),
      );
      // No answer tells us nothing about the windows, so keep listing them
      // as they were opened.
      const states = outcome.ok ? outcome.windows : null;
      if (outcome.ok && outcome.mayCapture !== null) {
        mayCapture = mayCapture === true || outcome.mayCapture;
      }
      return items.flatMap((item, index): OpenWindow[] => {
        const state = states?.[index];
        if (state && !state.open) {
          gone.add(item.key);
          return [];
        }
        return [
          {
            key: item.key,
            browser: id,
            private: item.private,
            openedUrl: item.url,
            launch: item.launch,
            title: state?.title,
            url: state?.url,
            hasPreview: typeof item.handle.screenId === "number",
          },
        ];
      });
    }),
  );

  await forgetWindows(gone);
  return { windows: groups.flat(), mayCapture };
}

/**
 * Closes the launcher's windows in the given browsers. Windows that are
 * already gone (closed by hand, or the browser was restarted) are counted,
 * not treated as errors.
 */
export async function closeInBrowsers(
  ids: readonly string[],
): Promise<CloseResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));
  const registered = byBrowser(await listRegisteredWindows());
  const done = new Set<string>();

  const results = await Promise.all(
    [...new Set(ids)].map(async (id): Promise<CloseResult | null> => {
      const items = registered.get(id);
      if (!items) return null; // Nothing of ours is open in this browser.
      const browser = detected.get(id);
      const name = browser?.name ?? id;
      const nothing = { id, name, closed: 0, alreadyGone: 0 };
      if (!browser?.appPath || !browser.scripting) {
        return { ...nothing, error: "This browser's windows can't be closed from here." };
      }

      const outcome = await closeTrackedWindows(
        browser.scripting,
        browser.appPath,
        items.map((item) => item.handle),
      );
      if (!outcome.ok) {
        return {
          ...nothing,
          error: outcome.notAllowed ? notAllowedMessage(name) : outcome.detail,
        };
      }

      const count = (how: string) =>
        outcome.outcomes.filter((o) => o === how).length;
      // Windows that stayed open are kept on the list, so Close can be
      // pressed again.
      items.forEach((item, index) => {
        if (outcome.outcomes[index] !== "stuck") done.add(item.key);
      });
      const counts = { id, name, closed: count("closed"), alreadyGone: count("gone") };
      const stuck = count("stuck");
      if (stuck === 0) return counts;
      const those = stuck === 1 ? "One window" : `${stuck} windows`;
      return {
        ...counts,
        error: `${those} stayed open; the page may be asking before it lets go. Close ${stuck === 1 ? "it" : "them"} by hand, or press Close again.`,
      };
    }),
  );

  await forgetWindows(done);
  return results.filter((result) => result !== null);
}

async function findRegistered(key: string): Promise<{
  item: RegisteredWindow;
  appPath: string;
  scripting: ScriptingKind;
  name: string;
} | null> {
  const item = (await listRegisteredWindows()).find((w) => w.key === key);
  if (!item) return null;
  const browser = (await detectBrowsers()).find((b) => b.id === item.browser);
  if (!browser?.appPath || !browser.scripting) return null;
  return {
    item,
    appPath: browser.appPath,
    scripting: browser.scripting,
    name: browser.name,
  };
}

/**
 * Brings one of the launcher's windows to the front. Throws with a message
 * for the person when the browser can't be reached.
 */
export async function focusOpenWindow(key: string): Promise<FocusResponse> {
  const found = await findRegistered(key);
  if (!found) return { gone: true, inFront: false };

  const outcome = await focusTrackedWindow(
    found.scripting,
    found.appPath,
    found.item.handle,
  );
  if (!outcome.ok) {
    throw new Error(
      outcome.notAllowed ? notAllowedMessage(found.name) : outcome.detail,
    );
  }
  if (outcome.gone) await forgetWindows(new Set([key]));
  return { gone: outcome.gone, inFront: outcome.inFront };
}

/**
 * A JPEG of one of the launcher's windows as it looks right now, or null if
 * there is none to be had. Only windows the launcher opened can be asked
 * for; nothing else on the screen is reachable through this.
 */
export async function pictureOfOpenWindow(key: string): Promise<Buffer | null> {
  const item = (await listRegisteredWindows()).find((w) => w.key === key);
  const screenId = item?.handle.screenId;
  if (typeof screenId !== "number") return null;
  return pictureOfWindow(screenId);
}

async function renderIcon(appPath: string): Promise<Buffer> {
  const contents = path.join(appPath, "Contents");
  const { stdout } = await run("/usr/bin/plutil", [
    "-extract",
    "CFBundleIconFile",
    "raw",
    "-o",
    "-",
    path.join(contents, "Info.plist"),
  ]);
  const iconName = stdout.trim();
  const icns = path.join(
    contents,
    "Resources",
    iconName.endsWith(".icns") ? iconName : `${iconName}.icns`,
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "browser-launcher-"));
  try {
    const png = path.join(workDir, "icon.png");
    await run("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      "-Z",
      "128",
      icns,
      "--out",
      png,
    ]);
    return await readFile(png);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const iconCache = new Map<string, Promise<Buffer | null>>();

/** The installed app's own icon as a PNG, or null if it can't be produced. */
export async function getBrowserIcon(id: string): Promise<Buffer | null> {
  const browser = (await detectBrowsers()).find((b) => b.id === id);
  if (!browser?.appPath) return null;

  let icon = iconCache.get(browser.appPath);
  if (!icon) {
    icon = renderIcon(browser.appPath).catch(() => null);
    iconCache.set(browser.appPath, icon);
  }
  return icon;
}
