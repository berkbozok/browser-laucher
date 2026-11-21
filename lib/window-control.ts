import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WindowHandle } from "./types";

const run = promisify(execFile);

/**
 * How a browser can be driven from outside through macOS scripting:
 *
 * - "chromium": can create normal and incognito windows and say which is which.
 * - "safari":   can create normal windows only.
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

// Process id of the running browser, or 0. Asking this needs no permission
// and, unlike talking to the app, never launches it.
function pidOf(appPath) {
  var bundle = $.NSBundle.bundleWithPath(appPath);
  if (bundle.isNil()) return 0;
  var running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(
    bundle.bundleIdentifier
  );
  return running.count > 0 ? running.objectAtIndex(0).processIdentifier : 0;
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
    return app.Window(properties).make().id();
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
    // Never report a private window that isn't one.
    if (request.private && app.windows.byId(id).mode() !== "incognito") {
      app.windows.byId(id).close();
      return { ok: false, code: null, message: "The browser ignored the request for a private window." };
    }
  }
  app.windows.byId(id).activeTab.url = request.url;
  app.activate();
  return { ok: true, windowId: id, pid: pidOf(request.appPath) };
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

function openSafari(request) {
  var app = Application(request.appPath);
  var id = null;
  if (pidOf(request.appPath) === 0) {
    coldStart(app);
    id = safariBlankWindow(app);
    if (id !== null) app.windows.byId(id).currentTab.url = request.url;
  }
  if (id === null) {
    app.Document({ url: request.url }).make();
    id = app.windows[0].id();
  }
  app.activate();
  return { ok: true, windowId: id, pid: pidOf(request.appPath) };
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

function listWindows(request) {
  var pid = pidOf(request.appPath);
  var ids = pid === 0 ? [] : browserWindowIds(Application(request.appPath));
  return { ok: true, pid: pid, ids: ids };
}

// Waits for windows that are not in request.known, then a little longer in
// case more than one turns up (a browser restoring its last session).
function awaitNewWindows(request) {
  var app = Application(request.appPath);
  var fresh = function () {
    if (pidOf(request.appPath) === 0) return null;
    var ids = browserWindowIds(app).filter(function (id) {
      return request.known.indexOf(id) === -1;
    });
    return ids.length > 0 ? ids : null;
  };
  if (!waitUntil(fresh, request.seconds)) {
    return { ok: true, pid: pidOf(request.appPath), ids: [] };
  }
  delay(0.8);
  return { ok: true, pid: pidOf(request.appPath), ids: fresh() || [] };
}

function closeWindows(request) {
  var pid = pidOf(request.appPath);
  var closed = 0;
  var alreadyGone = 0;
  request.handles.forEach(function (handle) {
    // After a restart the browser hands out window ids afresh, so an old id
    // could now belong to a window we never opened.
    if (pid === 0 || handle.pid !== pid) { alreadyGone++; return; }
    var win = Application(request.appPath).windows.byId(handle.windowId);
    if (!win.exists()) { alreadyGone++; return; }
    win.close();
    closed++;
  });
  return { ok: true, closed: closed, alreadyGone: alreadyGone };
}

var ACTIONS = {
  "open-chromium": openChromium,
  "open-safari": openSafari,
  "list-windows": listWindows,
  "await-new-windows": awaitNewWindows,
  "close-windows": closeWindows,
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

type Failure = { ok: false; code: number | null; message: string };
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
  /** Nothing was opened this way; the caller should open the page plainly. */
  | { opened: false; notAllowed: boolean; detail: string };

function refused(failure: Failure): TrackedOpen {
  return {
    opened: false,
    notAllowed: failure.code === NOT_ALLOWED,
    detail: failure.message,
  };
}

/**
 * For browsers that are told what to do on their command line (Firefox).
 * `newWindow` must make exactly one new window appear. `load`, when given,
 * then puts the page into that window.
 */
export type CommandLineSteps = {
  newWindow: () => Promise<void>;
  load?: () => Promise<void>;
};

async function openByWatchingWindows(
  appPath: string,
  steps: CommandLineSteps,
): Promise<TrackedOpen> {
  const before = await script<{ pid: number; ids: number[] }>({
    action: "list-windows",
    appPath,
  });
  if (!before.ok) return refused(before);

  await steps.newWindow();
  const after = await script<{ pid: number; ids: number[] }>({
    action: "await-new-windows",
    appPath,
    known: before.ids,
    seconds: 12,
  });
  await steps.load?.();

  // Exactly one new window is ours. None, or several at once (a browser
  // bringing back its last session), and we can't say which one is, so we
  // don't claim any.
  if (after.ok && after.ids.length === 1) {
    return { opened: true, handle: { windowId: after.ids[0], pid: after.pid } };
  }
  return {
    opened: true,
    handle: null,
    detail: after.ok
      ? `Expected one new window, found ${after.ids.length}.`
      : after.message,
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

  const reply = await script<WindowHandle>({
    action: kind === "safari" ? "open-safari" : "open-chromium",
    appPath,
    url,
    private: options.private,
  });
  if (!reply.ok) return refused(reply);
  return {
    opened: true,
    handle: { windowId: reply.windowId, pid: reply.pid },
  };
}

export type CloseOutcome =
  | { ok: true; closed: number; alreadyGone: number }
  | { ok: false; notAllowed: boolean; detail: string };

/** Closes the windows behind `handles`, skipping any that no longer exist. */
export async function closeTrackedWindows(
  appPath: string,
  handles: readonly WindowHandle[],
): Promise<CloseOutcome> {
  const reply = await script<{ closed: number; alreadyGone: number }>({
    action: "close-windows",
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
  return { ok: true, closed: reply.closed, alreadyGone: reply.alreadyGone };
}
