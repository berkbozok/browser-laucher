import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CloseResult,
  OpenResult,
  Untracked,
  WindowHandle,
} from "./types";
import {
  closeTrackedWindows,
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
 * The private-window switches were checked on Chrome, Brave, Firefox, Opera
 * and Edge. The other entries that have one are built on the same engines and
 * use the same switch.
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
  if (!privateFlag) {
    return { newWindow: () => openWithArgs(appPath, ["--new-window", url]) };
  }
  return {
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
 * can close again whenever the browser allows that; `track: false` skips
 * straight to the fallback.
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

  let untracked: Untracked = "unsupported";
  let detail: string | undefined;
  try {
    if (browser.scripting && (track || scriptingOnly)) {
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

  return Promise.all(
    [...new Set(ids)].map(async (id): Promise<OpenResult> => {
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
    }),
  );
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

/**
 * Closes windows the launcher opened earlier. Windows that are already gone
 * (closed by hand, or the browser was restarted) are counted, not treated as
 * errors.
 */
export async function closeInBrowsers(
  requests: readonly { browser: string; handles: readonly WindowHandle[] }[],
): Promise<CloseResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));

  return Promise.all(
    requests.map(async ({ browser: id, handles }): Promise<CloseResult> => {
      const browser = detected.get(id);
      const name = browser?.name ?? id;
      const nothing = { id, name, closed: 0, alreadyGone: 0 };
      if (!browser?.appPath || !browser.scripting) {
        return { ...nothing, error: "This browser's windows can't be closed from here." };
      }

      const outcome = await closeTrackedWindows(browser.appPath, handles);
      if (outcome.ok) {
        return { id, name, closed: outcome.closed, alreadyGone: outcome.alreadyGone };
      }
      return {
        ...nothing,
        error: outcome.notAllowed ? notAllowedMessage(name) : outcome.detail,
      };
    }),
  );
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
