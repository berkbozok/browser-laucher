import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WindowHandle } from "./types";

const run = promisify(execFile);

/**
 * How a browser can be driven from outside through macOS scripting:
 *
 * - "chromium": can create normal and incognito windows and say which is which.
 * - "safari":   can create normal windows. A private one is made by pressing
 *               Safari's own menu item, which needs the Accessibility
 *               permission on top.
 * - "firefox":  can only list and close windows. Its windows are opened on
 *               the command line and then picked out as "the one window that
 *               wasn't there before".
 */
export type ScriptingKind = "chromium" | "safari" | "firefox";

/** macOS's "the user hasn't allowed this app to control that one". */
const NOT_ALLOWED = -1743;
/**
 * Long enough to answer the one-time macOS permission prompt, which blocks
 * the script while it is on screen.
 */
const SCRIPT_TIMEOUT_MS = 60_000;

/**
 * Runs inside `osascript -l JavaScript`. The request arrives as one JSON
 * argument and is never spliced into the source, so a URL can't turn into
 * script. Replies are JSON too.
 */
const SCRIPT = String.raw`
ObjC.import("AppKit");

// The running browser: its process id and the moment it was started, or pid
// 0 when it isn't running. Asking needs no permission and, unlike talking to
// the app, never launches it. Together the two identify one run of the
// browser, which is what a window id is only meaningful within.
function runningApp(appPath) {
  var none = { pid: 0, startedAt: 0, hidden: false };
  var bundle = $.NSBundle.bundleWithPath(appPath);
  if (bundle.isNil()) return none;
  var copies = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(
    bundle.bundleIdentifier
  );
  var best = null;
  for (var i = 0; i < copies.count; i++) {
    var copy = copies.objectAtIndex(i);
    var date = copy.launchDate;
    var startedAt = date.isNil() ? 0 : Math.round(date.timeIntervalSince1970 * 1000);
    // A second, short-lived copy exists while a command-line request is
    // being handed over. The one that has been running longest is the real
    // browser.
    var older = !best || (startedAt !== 0 && (best.startedAt === 0 || startedAt < best.startedAt));
    if (older) {
      best = { pid: copy.processIdentifier, startedAt: startedAt, hidden: !!copy.hidden };
    }
  }
  return best || none;
}

function pidOf(appPath) {
  return runningApp(appPath).pid;
}

// The reply for a window that is now open and can be found again.
function opened(appPath, windowId) {
  var app = runningApp(appPath);
  return { ok: true, windowId: windowId, pid: app.pid, startedAt: app.startedAt };
}

function waitUntil(test, seconds) {
  var deadline = Date.now() + seconds * 1000;
  for (;;) {
    var value = null;
    try { value = test(); } catch (e) {}
    if (value) return value;
    if (Date.now() >= deadline) return null;
    delay(0.2);
  }
}

// Starts a browser that isn't running and gives its own first window a
// moment to appear, so we can tell that window from the ones we make.
function coldStart(app) {
  app.launch();
  waitUntil(function () { return app.windows.length > 0; }, 8);
  delay(0.7);
}

// A browser that was just started shows one empty "new tab" window. Using it
// for the page avoids leaving a stray blank window behind. Anything else the
// browser brought back (restored tabs, a home page) is the user's: leave it.
function chromiumBlankWindow(app) {
  var windows = app.windows();
  if (windows.length !== 1 || windows[0].mode() !== "normal") return null;
  var tabs = windows[0].tabs();
  if (tabs.length !== 1) return null;
  var url = String(tabs[0].url() || "");
  var blank = url === "" || url === "about:blank" ||
    /^[a-z-]+:\/\/(newtab|new-tab-page|startpage|startpageshared|start-page)\b/i.test(url);
  return blank ? windows[0].id() : null;
}

function makeChromiumWindow(app, properties) {
  var before = app.windows.id();
  try {
    var made = app.Window(properties).make().id();
    if (before.indexOf(made) === -1) return made;
    // Not a new window, so not one to claim. Fall through to looking for it.
    throw new Error("The browser didn't say which window it made.");
  } catch (error) {
    // Opera makes the window and then reports a failure anyway, so look for
    // the window that wasn't there a moment ago.
    var fresh = app.windows.id().filter(function (id) {
      return before.indexOf(id) === -1;
    });
    if (fresh.length === 1) return fresh[0];
    throw error;
  }
}

function openChromium(request) {
  var app = Application(request.appPath);
  var id = null;
  if (pidOf(request.appPath) === 0) {
    coldStart(app);
    if (!request.private) id = chromiumBlankWindow(app);
  }
  if (id === null) {
    id = makeChromiumWindow(app, request.private ? { mode: "incognito" } : {});
    // Never report a private window that isn't one. A browser that has
    // private browsing switched off hands back a normal window instead.
    if (request.private && app.windows.byId(id).mode() !== "incognito") {
      app.windows.byId(id).close();
      return {
        ok: false,
        code: null,
        privateUnavailable: true,
        message: "The browser opened a normal window when asked for a private one.",
      };
    }
  }
  app.windows.byId(id).activeTab.url = request.url;
  app.activate();
  return opened(request.appPath, id);
}

function safariBlankWindow(app) {
  var documents = app.documents();
  if (documents.length !== 1) return null;
  var url = String(documents[0].url() || "");
  if (url !== "" && url !== "favorites://") return null;
  var windows = app.windows().filter(function (w) { return w.visible(); });
  if (windows.length !== 1 || windows[0].tabs.length !== 1) return null;
  return windows[0].id();
}

// Presses File > New Private Window in Safari, which has no command for it.
// The item is found by its shortcut (Shift-Command-N) rather than its title,
// which changes with the system language. Pressing a menu item in another
// app is what needs the Accessibility permission.
function pressNewPrivateWindow(pid) {
  var process = Application("System Events").processes.whose({ unixId: pid })[0];
  var items = process.menuBars[0].menuBarItems[2].menus[0].menuItems;
  var keys = items.attributes.byName("AXMenuItemCmdChar").value();
  var modifiers = items.attributes.byName("AXMenuItemCmdModifiers").value();
  for (var i = 0; i < keys.length; i++) {
    // Modifiers value 1 is Shift together with Command.
    if (String(keys[i]).toUpperCase() === "N" && modifiers[i] === 1) {
      process.frontmost = true;
      items[i].click();
      return true;
    }
  }
  return false;
}

function openSafariPrivate(app, request) {
  var before = app.windows.id();
  try {
    if (!pressNewPrivateWindow(pidOf(request.appPath))) {
      return { ok: false, code: null, message: "Safari's New Private Window menu item wasn't found." };
    }
  } catch (error) {
    if (error.errorNumber === -1743) throw error;
    var message = String(error.message || error);
    // macOS words a missing Accessibility permission as "not allowed
    // assistive access". Anything else is the menu not being in the state we
    // expected, which is worth reporting as what it is.
    var refused = error.errorNumber === -25211 || /assistive access/i.test(message);
    return { ok: false, code: null, needsAccessibility: refused, message: message };
  }
  var fresh = waitUntil(function () {
    var ids = app.windows.id().filter(function (id) { return before.indexOf(id) === -1; });
    return ids.length === 1 ? ids : null;
  }, 6);
  if (!fresh) {
    return { ok: false, code: null, message: "Safari didn't open a private window." };
  }
  app.windows.byId(fresh[0]).currentTab.url = request.url;
  return opened(request.appPath, fresh[0]);
}

function openSafari(request) {
  var app = Application(request.appPath);
  var wasClosed = pidOf(request.appPath) === 0;
  if (wasClosed) coldStart(app);
  if (request.private) return openSafariPrivate(app, request);

  var id = wasClosed ? safariBlankWindow(app) : null;
  if (id !== null) {
    app.windows.byId(id).currentTab.url = request.url;
  } else {
    // The new document's window is found as the one that wasn't there
    // before. Taking "the front window" instead would be wrong whenever
    // another window comes forward at the same moment, and Close would then
    // shut a window the launcher never opened.
    var before = app.windows.id();
    app.Document({ url: request.url }).make();
    var fresh = waitUntil(function () {
      var ids = app.windows.id().filter(function (w) { return before.indexOf(w) === -1; });
      return ids.length === 1 ? ids : null;
    }, 6);
    if (!fresh) {
      app.activate();
      return { ok: true, unidentified: "Safari opened the page, but its new window couldn't be picked out." };
    }
    id = fresh[0];
  }
  app.activate();
  return opened(request.appPath, id);
}

// Ids of the real browser windows, ignoring panels and tooltips. Each property
// is read for all windows at once: Firefox lists helper windows that can't be
// asked about one by one.
function browserWindowIds(app) {
  for (var attempt = 0; attempt < 3; attempt++) {
    var ids = app.windows.id();
    var visible = app.windows.visible();
    var resizable = app.windows.resizable();
    // The three lists only line up if no window came or went in between.
    if (visible.length === ids.length && resizable.length === ids.length) {
      return ids.filter(function (id, i) { return visible[i] && resizable[i]; });
    }
  }
  throw new Error("The browser's windows kept changing.");
}

function windowList(appPath, ids) {
  var app = runningApp(appPath);
  return { ok: true, pid: app.pid, startedAt: app.startedAt, ids: ids };
}

function listWindows(request) {
  var running = pidOf(request.appPath) !== 0;
  return windowList(request.appPath, running ? browserWindowIds(Application(request.appPath)) : []);
}

// For a browser that has just been started: waits until its windows have
// stopped appearing. Whatever it brings back by itself (a home page, the
// last session) is then known before we add a window of our own.
function awaitSettledWindows(request) {
  var app = Application(request.appPath);
  var deadline = Date.now() + request.seconds * 1000;
  var last = null;
  var since = 0;
  for (;;) {
    var now = null;
    try {
      if (pidOf(request.appPath) !== 0) now = browserWindowIds(app).slice().sort().join(",");
    } catch (error) {}
    if (now) {
      if (now !== last) { last = now; since = Date.now(); }
      else if (Date.now() - since >= 2500) return windowList(request.appPath, browserWindowIds(app));
    }
    if (Date.now() >= deadline) {
      return { ok: false, code: null, message: "The browser's windows didn't settle after it started." };
    }
    delay(0.3);
  }
}

// Waits for windows that are not in request.known, then a little longer in
// case more than one turns up.
function awaitNewWindows(request) {
  var app = Application(request.appPath);
  var fresh = function () {
    if (pidOf(request.appPath) === 0) return null;
    var ids = browserWindowIds(app).filter(function (id) {
      return request.known.indexOf(id) === -1;
    });
    return ids.length > 0 ? ids : null;
  };
  if (!waitUntil(fresh, request.seconds)) return windowList(request.appPath, []);
  delay(0.8);
  return windowList(request.appPath, fresh() || []);
}

function isMinimized(win) {
  // The property has a different name in Chromium browsers.
  try { return !!win.miniaturized(); } catch (e) {}
  try { return !!win.minimized(); } catch (e) {}
  return false;
}

// The window behind a handle, or null if it is gone.
function windowFor(request, running, handle) {
  // Window ids start over when a browser restarts, so a handle from an
  // earlier run could now point at a window we never opened.
  var sameRun = running.pid !== 0 && handle.pid === running.pid &&
    handle.startedAt === running.startedAt;
  if (!sameRun) return null;
  var win = Application(request.appPath).windows.byId(handle.windowId);
  if (!win.exists()) return null;
  // Safari goes on listing a window for a while after it was closed, only no
  // longer visible. Out of sight but neither in the Dock nor hidden along
  // with the whole app means closed.
  if (request.kind === "safari" && !running.hidden) {
    var visible = true;
    try { visible = win.visible(); } catch (e) {}
    if (!visible && !isMinimized(win)) return null;
  }
  return win;
}

function closeWindows(request) {
  var running = runningApp(request.appPath);
  var closed = 0;
  var alreadyGone = 0;
  var stuck = 0;
  request.handles.forEach(function (handle) {
    var win = windowFor(request, running, handle);
    if (!win) { alreadyGone++; return; }
    win.close();
    // A page can ask "leave this site?" and keep its window open.
    var went = waitUntil(function () { return !win.exists() || !win.visible(); }, 3);
    if (went) closed++;
    else stuck++;
  });
  return { ok: true, closed: closed, alreadyGone: alreadyGone, stuck: stuck };
}

// What each window is showing right now, in the order the handles came in.
function describeWindows(request) {
  var running = runningApp(request.appPath);
  var windows = request.handles.map(function (handle) {
    var win = windowFor(request, running, handle);
    if (!win) return { open: false };
    var info = { open: true };
    try {
      if (request.kind === "chromium") {
        info.title = win.activeTab.title();
        info.url = win.activeTab.url();
      } else if (request.kind === "safari") {
        info.title = win.currentTab.name();
        info.url = win.currentTab.url();
      } else {
        // Firefox only gives the window's name, which is the page title.
        info.title = win.name();
      }
    } catch (error) {}
    return info;
  });
  return { ok: true, windows: windows };
}

// Brings one window to the front of everything.
function focusWindow(request) {
  var running = runningApp(request.appPath);
  var win = windowFor(request, running, request.handle);
  if (!win) return { ok: true, gone: true };
  if (isMinimized(win)) {
    try { win.miniaturized = false; } catch (e) {
      try { win.minimized = false; } catch (e2) {}
    }
  }
  // Front of its own app first, then the app in front of the others.
  try { win.index = 1; } catch (e) {}
  var app = Application(request.appPath);
  app.activate();
  // Did it really end up in front of the browser's other windows?
  var front = null;
  try {
    front = request.kind === "firefox" ? browserWindowIds(app)[0] : app.windows.id()[0];
  } catch (e) {}
  return { ok: true, gone: false, inFront: String(front) === String(request.handle.windowId) };
}

var ACTIONS = {
  "open-chromium": openChromium,
  "open-safari": openSafari,
  "list-windows": listWindows,
  "await-settled-windows": awaitSettledWindows,
  "await-new-windows": awaitNewWindows,
  "close-windows": closeWindows,
  "describe-windows": describeWindows,
  "focus-window": focusWindow,
};

function run(argv) {
  var request = JSON.parse(argv[0]);
  try {
    return JSON.stringify(ACTIONS[request.action](request));
  } catch (error) {
    return JSON.stringify({
      ok: false,
      code: typeof error.errorNumber === "number" ? error.errorNumber : null,
      message: String(error.message || error),
    });
  }
}
`;

type Failure = {
  ok: false;
  code: number | null;
  message: string;
  /** The step that failed needs the macOS Accessibility permission. */
  needsAccessibility?: boolean;
  /** The browser can't open a private window at all right now. */
  privateUnavailable?: boolean;
};
type Reply<T> = ({ ok: true } & T) | Failure;

async function script<T>(request: Record<string, unknown>): Promise<Reply<T>> {
  try {
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", SCRIPT, JSON.stringify(request)],
      { timeout: SCRIPT_TIMEOUT_MS },
    );
    return JSON.parse(stdout) as Reply<T>;
  } catch (error) {
    // Killed by the timeout: almost always the permission prompt going
    // unanswered, which is the same situation as a refusal.
    const timedOut =
      typeof error === "object" && error !== null && "killed" in error && error.killed === true;
    return {
      ok: false,
      code: timedOut ? NOT_ALLOWED : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export type TrackedOpen =
  | { opened: true; handle: WindowHandle }
  /** The window is open, but we couldn't tell which one it is. */
  | { opened: true; handle: null; detail: string }
  /** Nothing was opened this way. */
  | {
      opened: false;
      /** macOS hasn't allowed the launcher to control this browser. */
      notAllowed: boolean;
      /** The Accessibility permission is what's missing. */
      needsAccessibility: boolean;
      /**
       * The browser answered a request for a private window with a normal
       * one. Don't try another way: it would end the same.
       */
      privateUnavailable: boolean;
      detail: string;
    };

function refused(failure: Failure): TrackedOpen {
  return {
    opened: false,
    notAllowed: failure.code === NOT_ALLOWED,
    needsAccessibility: failure.needsAccessibility === true,
    privateUnavailable: failure.privateUnavailable === true,
    detail: failure.message,
  };
}

/**
 * For browsers that are told what to do on their command line (Firefox).
 * `start` launches the browser with nothing to open. `newWindow` must make
 * exactly one new window appear. `load`, when given, then puts the page into
 * that window.
 */
export type CommandLineSteps = {
  start: () => Promise<void>;
  newWindow: () => Promise<void>;
  load?: () => Promise<void>;
};

type WindowList = { pid: number; startedAt: number; ids: number[] };

async function openByWatchingWindows(
  appPath: string,
  steps: CommandLineSteps,
): Promise<TrackedOpen> {
  let before = await script<WindowList>({ action: "list-windows", appPath });
  if (!before.ok) return refused(before);

  let unsettled: string | null = null;
  if (before.pid === 0) {
    // Not running. Started with a page to open, it could put that page in
    // the same window as tabs it restores, and closing "our" window would
    // then close those too. So start it bare, let it bring back whatever it
    // wants, and only then add a window that is ours alone.
    await steps.start();
    before = await script<WindowList>({
      action: "await-settled-windows",
      appPath,
      seconds: 25,
    });
    if (!before.ok) unsettled = before.message;
  }

  await steps.newWindow();
  const after = before.ok
    ? await script<WindowList>({
        action: "await-new-windows",
        appPath,
        known: before.ids,
        seconds: 12,
      })
    : null;
  await steps.load?.();

  // Exactly one new window is ours. None, or several at once, and we can't
  // say which one is, so we don't claim any.
  if (after?.ok && after.ids.length === 1) {
    return {
      opened: true,
      handle: {
        windowId: after.ids[0],
        pid: after.pid,
        startedAt: after.startedAt,
      },
    };
  }
  return {
    opened: true,
    handle: null,
    detail:
      unsettled ??
      (after?.ok
        ? `Expected one new window, found ${after.ids.length}.`
        : (after?.message ?? "The browser's windows couldn't be listed.")),
  };
}

/**
 * Opens `url` in a window of its own and returns a handle that
 * closeTrackedWindows accepts later. `commandLine` is only used for the
 * "firefox" kind.
 */
export async function openTrackedWindow(options: {
  kind: ScriptingKind;
  appPath: string;
  url: string;
  private: boolean;
  commandLine: CommandLineSteps;
}): Promise<TrackedOpen> {
  const { kind, appPath, url } = options;

  if (kind === "firefox") {
    return openByWatchingWindows(appPath, options.commandLine);
  }

  const reply = await script<
    WindowHandle | { windowId?: undefined; unidentified: string }
  >({
    action: kind === "safari" ? "open-safari" : "open-chromium",
    appPath,
    url,
    private: options.private,
  });
  if (!reply.ok) return refused(reply);
  if (reply.windowId === undefined) {
    // The page is open, but the script couldn't say in which window.
    return { opened: true, handle: null, detail: reply.unidentified };
  }
  return {
    opened: true,
    handle: {
      windowId: reply.windowId,
      pid: reply.pid,
      startedAt: reply.startedAt,
    },
  };
}

export type CloseOutcome =
  | {
      ok: true;
      closed: number;
      alreadyGone: number;
      /** Windows that were asked to close but stayed open. */
      stuck: number;
    }
  | { ok: false; notAllowed: boolean; detail: string };

/** Closes the windows behind `handles`, skipping any that no longer exist. */
export async function closeTrackedWindows(
  kind: ScriptingKind,
  appPath: string,
  handles: readonly WindowHandle[],
): Promise<CloseOutcome> {
  const reply = await script<{
    closed: number;
    alreadyGone: number;
    stuck: number;
  }>({
    action: "close-windows",
    kind,
    appPath,
    handles,
  });
  if (!reply.ok) {
    return {
      ok: false,
      notAllowed: reply.code === NOT_ALLOWED,
      detail: reply.message,
    };
  }
  return {
    ok: true,
    closed: reply.closed,
    alreadyGone: reply.alreadyGone,
    stuck: reply.stuck,
  };
}

/** What one tracked window is showing; `open: false` once it is gone. */
export type WindowState = { open: boolean; title?: string; url?: string };

export type DescribeOutcome =
  | { ok: true; windows: WindowState[] }
  | { ok: false; notAllowed: boolean; detail: string };

/**
 * Looks at the windows behind `handles` and says, in the same order, whether
 * each is still open and what it is showing.
 */
export async function describeTrackedWindows(
  kind: ScriptingKind,
  appPath: string,
  handles: readonly WindowHandle[],
): Promise<DescribeOutcome> {
  const reply = await script<{ windows: WindowState[] }>({
    action: "describe-windows",
    kind,
    appPath,
    handles,
  });
  if (!reply.ok) {
    return {
      ok: false,
      notAllowed: reply.code === NOT_ALLOWED,
      detail: reply.message,
    };
  }
  return { ok: true, windows: reply.windows };
}

export type FocusOutcome =
  /** `inFront`: the window is now ahead of the browser's other windows. */
  | { ok: true; gone: boolean; inFront: boolean }
  | { ok: false; notAllowed: boolean; detail: string };

/** Brings the window behind `handle` to the front. */
export async function focusTrackedWindow(
  kind: ScriptingKind,
  appPath: string,
  handle: WindowHandle,
): Promise<FocusOutcome> {
  const reply = await script<{ gone: boolean; inFront?: boolean }>({
    action: "focus-window",
    kind,
    appPath,
    handle,
  });
  if (!reply.ok) {
    return {
      ok: false,
      notAllowed: reply.code === NOT_ALLOWED,
      detail: reply.message,
    };
  }
  return { ok: true, gone: reply.gone, inFront: reply.inFront === true };
}
