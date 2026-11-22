import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { arrange, type Layout } from "./layout";
import { pictureOfWindow, saveWindowPicture } from "./preview";
import type {
  ActionResult,
  BrowserInfo,
  CloseResult,
  FocusResponse,
  OpenResult,
  OpenWindow,
  SetupResponse,
  SnapshotsResponse,
  Untracked,
  WindowHandle,
  WindowSelection,
  WindowsResponse,
} from "./types";
import {
  forgetStartedBrowsers,
  forgetWindows,
  listRegisteredWindows,
  listStartedBrowsers,
  noteStartedBrowsers,
  registerWindows,
  retargetWindows,
  type RegisteredWindow,
  type StartedBrowser,
} from "./window-registry";
import {
  arrangeTrackedWindows,
  boundsOfTrackedWindows,
  checkControl,
  checkPermissions,
  closeTrackedWindows,
  describeTrackedWindows,
  focusTrackedWindow,
  navigateTrackedWindows,
  openTrackedWindow,
  quitBrowserIfEmpty,
  reloadTrackedWindows,
  usableScreenArea,
  type ActedHow,
  type ActOutcome,
  type CommandLineSteps,
  type ScriptingKind,
} from "./window-control";

const run = promisify(execFile);

type BrowserDefinition = {
  id: string;
  name: string;
  /** The family it belongs to, for picking a group of browsers at once. */
  engine: BrowserInfo["engine"];
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
 * Everything was checked on Chrome, Brave, Firefox, Safari, Opera, Edge,
 * Vivaldi, Zen and Orion ("npm run test:live" does it again). The remaining
 * entries with `scripting` are built on the same engines. Entries without it
 * (DuckDuckGo, Arc, Tor) just get the page handed to them: a normal window
 * only, which the launcher can't follow.
 */
const CATALOG: readonly BrowserDefinition[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    engine: "chromium",
    macApps: ["Google Chrome.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "brave",
    name: "Brave",
    engine: "chromium",
    macApps: ["Brave Browser.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "firefox",
    name: "Firefox",
    engine: "firefox",
    macApps: ["Firefox.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  {
    id: "safari",
    name: "Safari",
    engine: "webkit",
    macApps: ["Safari.app"],
    scripting: "safari",
  },
  {
    id: "opera",
    name: "Opera",
    engine: "chromium",
    macApps: ["Opera.app"],
    privateFlag: "--private",
    linksFollowLastWindow: true,
    scripting: "chromium",
  },
  {
    id: "edge",
    name: "Microsoft Edge",
    engine: "chromium",
    macApps: ["Microsoft Edge.app"],
    privateFlag: "--inprivate",
    scripting: "chromium",
  },
  {
    id: "arc",
    name: "Arc",
    engine: "chromium",
    macApps: ["Arc.app"],
  },
  {
    id: "vivaldi",
    name: "Vivaldi",
    engine: "chromium",
    macApps: ["Vivaldi.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "opera-gx",
    name: "Opera GX",
    engine: "chromium",
    macApps: ["Opera GX.app"],
    privateFlag: "--private",
    linksFollowLastWindow: true,
    scripting: "chromium",
  },
  {
    id: "chromium",
    name: "Chromium",
    engine: "chromium",
    macApps: ["Chromium.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    engine: "webkit",
    macApps: ["DuckDuckGo.app"],
  },
  {
    id: "zen",
    name: "Zen",
    engine: "firefox",
    macApps: ["Zen.app", "Zen Browser.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  {
    id: "orion",
    name: "Orion",
    engine: "webkit",
    macApps: ["Orion.app"],
    scripting: "safari",
  },
  {
    id: "tor",
    name: "Tor Browser",
    engine: "firefox",
    macApps: ["Tor Browser.app"],
  },
  {
    id: "firefox-dev",
    name: "Firefox Developer Edition",
    engine: "firefox",
    macApps: ["Firefox Developer Edition.app"],
    privateFlag: "--private-window",
    scripting: "firefox",
  },
  {
    id: "chrome-canary",
    name: "Chrome Canary",
    engine: "chromium",
    macApps: ["Google Chrome Canary.app"],
    privateFlag: "--incognito",
    scripting: "chromium",
  },
  {
    id: "safari-tp",
    name: "Safari Technology Preview",
    engine: "webkit",
    macApps: ["Safari Technology Preview.app"],
    scripting: "safari",
  },
];

export type DetectedBrowser = {
  id: string;
  name: string;
  engine: BrowserInfo["engine"];
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
      engine: definition.engine,
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
  /** `startedBrowser`: the browser wasn't running and was launched for this. */
  | { ok: true; handle: WindowHandle; startedBrowser?: boolean }
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
          ? {
              ok: true,
              handle: tracked.handle,
              startedBrowser: tracked.startedBrowser,
            }
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
  // Browsers that weren't running and that we started for this launch.
  const started: StartedBrowser[] = [];

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
    if (normal.ok && normal.handle && normal.startedBrowser) {
      const { pid, startedAt } = normal.handle;
      started.push({ browser: id, pid, startedAt });
    }
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
  await noteStartedBrowsers(started);
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

/** What to tell someone when a step needs the launcher to press a menu. */
function accessibilityMessage(name: string): string {
  return `${name} can only do this when the launcher presses its menu, and macOS has to allow that: turn on the app running the launcher (Terminal, Cursor, …) under System Settings → Privacy & Security → Accessibility.`;
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

/** The launcher's windows a request is about, grouped by browser. */
async function selectWindows(
  selection: WindowSelection,
): Promise<Map<string, RegisteredWindow[]>> {
  const keys = selection.keys ? new Set(selection.keys) : null;
  const ids = new Set(selection.browsers ?? []);
  const registered = await listRegisteredWindows();
  return byBrowser(
    registered.filter((item) =>
      keys ? keys.has(item.key) : ids.has(item.browser),
    ),
  );
}

/** A browser the launcher can drive: installed, and scriptable. */
type Drivable = InstalledBrowser & { scripting: ScriptingKind };

function drivable(browser: DetectedBrowser | undefined): Drivable | null {
  if (!browser?.appPath || !browser.scripting) return null;
  return { ...browser, appPath: browser.appPath, scripting: browser.scripting };
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
      const browser = drivable(detected.get(id));
      if (!browser) {
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
 * Closes the selected windows. Windows that are already gone (closed by
 * hand, or the browser was restarted) are counted, not treated as errors.
 * With `quitStarted`, a browser the launcher itself had started is quit
 * again once it has no windows left.
 */
export async function closeOpenWindows(
  selection: WindowSelection,
  { quitStarted = false }: { quitStarted?: boolean } = {},
): Promise<CloseResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));
  const groups = await selectWindows(selection);
  const started = quitStarted ? await listStartedBrowsers() : [];
  const done = new Set<string>();
  const finishedRuns: StartedBrowser[] = [];

  const results = await Promise.all(
    [...groups].map(async ([id, items]): Promise<CloseResult> => {
      const browser = drivable(detected.get(id));
      const name = detected.get(id)?.name ?? id;
      const nothing = { id, name, closed: 0, alreadyGone: 0 };
      if (!browser) {
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
      const result: CloseResult = {
        id,
        name,
        closed: count("closed"),
        alreadyGone: count("gone"),
      };

      for (const run of started.filter((r) => r.browser === id)) {
        if (await quitBrowserIfEmpty(browser.scripting, browser.appPath, run)) {
          result.quit = true;
          finishedRuns.push(run);
        }
      }

      const stuck = count("stuck");
      if (stuck > 0) {
        const those = stuck === 1 ? "One window" : `${stuck} windows`;
        result.error = `${those} stayed open; the page may be asking before it lets go. Close ${stuck === 1 ? "it" : "them"} by hand, or press Close again.`;
      }
      return result;
    }),
  );

  await forgetWindows(done);
  await forgetStartedBrowsers(finishedRuns);
  return results;
}

/**
 * Runs `act` on the selected windows, one call per browser, and tallies how
 * it went. Windows that turn out to be gone are forgotten.
 */
async function actOnWindows(
  selection: WindowSelection,
  act: (browser: Drivable, items: RegisteredWindow[]) => Promise<ActOutcome>,
  afterwards?: (did: RegisteredWindow[]) => Promise<void>,
): Promise<ActionResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));
  const groups = await selectWindows(selection);
  const gone = new Set<string>();
  const did: RegisteredWindow[] = [];

  const results = await Promise.all(
    [...groups].map(async ([id, items]): Promise<ActionResult> => {
      const browser = drivable(detected.get(id));
      const name = detected.get(id)?.name ?? id;
      const nothing = { id, name, done: 0, gone: 0 };
      if (!browser) {
        return { ...nothing, error: "This browser's windows can't be reached from here." };
      }

      const outcome = await act(browser, items);
      if (!outcome.ok) {
        return {
          ...nothing,
          error: outcome.needsAccessibility
            ? accessibilityMessage(name)
            : outcome.notAllowed
              ? notAllowedMessage(name)
              : outcome.detail,
        };
      }

      items.forEach((item, index) => {
        if (outcome.outcomes[index] === "gone") gone.add(item.key);
        if (outcome.outcomes[index] === "done") did.push(item);
      });
      const count = (how: ActedHow) =>
        outcome.outcomes.filter((o) => o === how).length;
      const result: ActionResult = {
        id,
        name,
        done: count("done"),
        gone: count("gone"),
      };
      if (count("unsupported") > 0) {
        result.error = `${name} couldn't do that for ${count("unsupported") === 1 ? "one window" : `${count("unsupported")} windows`}.`;
      }
      return result;
    }),
  );

  await forgetWindows(gone);
  await afterwards?.(did);
  return results;
}

/**
 * Firefox can't be told to load an address in a window it already has, nor
 * to reload one. So each of its windows is swapped for a new one, opened on
 * `url` (or, to reload, on the address the old one was opened on) and put
 * where the old one was.
 */
async function replaceWindows(
  browser: Drivable,
  items: RegisteredWindow[],
  url: string | null,
): Promise<ActOutcome> {
  const places = await boundsOfTrackedWindows(
    browser.scripting,
    browser.appPath,
    items.map((item) => item.handle),
  );
  const outcomes: ActedHow[] = [];
  for (const [index, item] of items.entries()) {
    const place = places[index];
    if (!place) {
      outcomes.push("gone");
      continue;
    }
    const address = url ?? item.url;
    const fresh = await openWindow(browser, address, {
      isPrivate: item.private,
      track: true,
    });
    if (!fresh.ok || !fresh.handle) {
      outcomes.push("unsupported");
      continue;
    }
    await registerWindows([
      {
        browser: item.browser,
        handle: fresh.handle,
        private: item.private,
        url: address,
        launch: item.launch,
      },
    ]);
    await arrangeTrackedWindows(browser.scripting, browser.appPath, [
      { handle: fresh.handle, bounds: place },
    ]);
    await closeTrackedWindows(browser.scripting, browser.appPath, [item.handle]);
    await forgetWindows(new Set([item.key]));
    outcomes.push("done");
  }
  return { ok: true, outcomes };
}

/**
 * Sends the selected windows to a new address. `url` must already be
 * validated (see normalizeUrl).
 */
export function navigateOpenWindows(
  selection: WindowSelection,
  url: string,
): Promise<ActionResult[]> {
  return actOnWindows(
    selection,
    (browser, items) =>
      browser.scripting === "firefox"
        ? replaceWindows(browser, items, url)
        : navigateTrackedWindows(
            browser.scripting,
            browser.appPath,
            items.map((item) => item.handle),
            url,
          ),
    // Windows that were swapped are already registered under the new address.
    (did) => retargetWindows(new Set(did.map((item) => item.key)), url),
  );
}

/** Reloads the page in the selected windows. */
export function reloadOpenWindows(
  selection: WindowSelection,
): Promise<ActionResult[]> {
  return actOnWindows(selection, (browser, items) =>
    browser.scripting === "firefox"
      ? replaceWindows(browser, items, null)
      : reloadTrackedWindows(
          browser.scripting,
          browser.appPath,
          items.map((item) => item.handle),
        ),
  );
}

/** The selected windows in the order the page lists them. */
function inListOrder(
  groups: Map<string, RegisteredWindow[]>,
  order: readonly string[],
): RegisteredWindow[] {
  return order.flatMap((id) =>
    [...(groups.get(id) ?? [])].sort(
      (x, y) => y.launch - x.launch || Number(x.private) - Number(y.private),
    ),
  );
}

/** Lays the selected windows out on the main screen. */
export async function arrangeOpenWindows(
  selection: WindowSelection,
  layout: Layout,
): Promise<ActionResult[]> {
  const area = await usableScreenArea();
  if (!area) throw new Error("The size of the screen couldn't be read.");

  const order = (await detectBrowsers()).map((b) => b.id);
  const all = inListOrder(await selectWindows(selection), order);
  const spots = new Map(
    arrange(area, all.length, layout).map((rect, index) => [all[index].key, rect]),
  );

  return actOnWindows(selection, (browser, items) =>
    arrangeTrackedWindows(
      browser.scripting,
      browser.appPath,
      // A window that appeared since the spots were handed out keeps its place.
      items.flatMap((item) => {
        const bounds = spots.get(item.key);
        return bounds ? [{ handle: item.handle, bounds }] : [];
      }),
    ).then((outcome): ActOutcome => {
      if (!outcome.ok) return outcome;
      // Line the answers back up with `items`.
      let next = 0;
      return {
        ok: true,
        outcomes: items.map((item) =>
          spots.has(item.key) ? outcome.outcomes[next++] : "unsupported",
        ),
      };
    }),
  );
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * Saves a full-size picture of each selected window into a new folder under
 * ~/Pictures/Browser Launcher and shows the folder in Finder.
 */
export async function saveOpenWindowPictures(
  selection: WindowSelection,
): Promise<SnapshotsResponse> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));
  const all = inListOrder(await selectWindows(selection), [...detected.keys()]);
  if (all.length === 0) return { folder: null, saved: 0, missed: [] };

  const now = new Date();
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}.${two(now.getMinutes())}.${two(now.getSeconds())}`;
  const folder = path.join(
    /* turbopackIgnore: true */ homedir(),
    "Pictures",
    "Browser Launcher",
    stamp,
  );
  await mkdir(folder, { recursive: true });

  const used = new Map<string, number>();
  const outcomes = await Promise.all(
    all.map(async (item) => {
      const name = detected.get(item.browser)?.name ?? item.browser;
      const base = `${name} - ${item.private ? "incognito" : "normal"}`;
      const seen = (used.get(base) ?? 0) + 1;
      used.set(base, seen);
      const label = seen === 1 ? base : `${base} ${seen}`;
      const screenId = item.handle.screenId;
      const saved =
        typeof screenId === "number" &&
        (await saveWindowPicture(
          screenId,
          path.join(/* turbopackIgnore: true */ folder, `${label}.png`),
        ));
      return { label, saved };
    }),
  );

  const saved = outcomes.filter((o) => o.saved).length;
  const missed = outcomes.filter((o) => !o.saved).map((o) => o.label);
  if (saved === 0) {
    await rm(folder, { recursive: true, force: true });
    return {
      folder: null,
      saved: 0,
      missed,
      error:
        "No pictures could be taken. macOS has to allow the app running the launcher to record the screen: System Settings → Privacy & Security → Screen & System Audio Recording.",
    };
  }
  // Show the folder. Not worth failing over if Finder doesn't oblige.
  await runOpen([folder]).catch(() => undefined);
  return { folder, saved, missed };
}

async function findRegistered(key: string): Promise<{
  item: RegisteredWindow;
  browser: Drivable;
} | null> {
  const item = (await listRegisteredWindows()).find((w) => w.key === key);
  if (!item) return null;
  const browser = drivable(
    (await detectBrowsers()).find((b) => b.id === item.browser),
  );
  return browser ? { item, browser } : null;
}

/**
 * Brings one of the launcher's windows to the front. Throws with a message
 * for the person when the browser can't be reached.
 */
export async function focusOpenWindow(key: string): Promise<FocusResponse> {
  const found = await findRegistered(key);
  if (!found) return { gone: true, inFront: false };

  const outcome = await focusTrackedWindow(
    found.browser.scripting,
    found.browser.appPath,
    found.item.handle,
  );
  if (!outcome.ok) {
    throw new Error(
      outcome.notAllowed
        ? notAllowedMessage(found.browser.name)
        : outcome.detail,
    );
  }
  if (outcome.gone) await forgetWindows(new Set([key]));
  return { gone: outcome.gone, inFront: outcome.inFront };
}

/**
 * A PNG of one of the launcher's windows as it looks right now, or null if
 * there is none to be had. Only windows the launcher opened can be asked
 * for; nothing else on the screen is reachable through this.
 */
export async function pictureOfOpenWindow(key: string): Promise<Buffer | null> {
  const item = (await listRegisteredWindows()).find((w) => w.key === key);
  const screenId = item?.handle.screenId;
  if (typeof screenId !== "number") return null;
  return pictureOfWindow(screenId);
}

/**
 * Which macOS permissions the launcher has. Asking whether a browser may be
 * controlled makes macOS put the question to the person the first time, so
 * this is only run when they ask for it.
 */
export async function checkSetup(): Promise<SetupResponse> {
  const installed = (await detectBrowsers()).flatMap((b) => drivable(b) ?? []);
  const [permissions, controls] = await Promise.all([
    checkPermissions(),
    Promise.all(
      installed.map(async (browser) => ({
        id: browser.id,
        name: browser.name,
        control: await checkControl(browser.appPath),
      })),
    ),
  ]);
  return { ...permissions, browsers: controls };
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
