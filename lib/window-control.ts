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
 * - "menu":     can't be scripted at all (DuckDuckGo). The launcher presses
 *               its New Window / New Fire Window menu items, fills in the
 *               address bar, and later presses the window's close button.
 *               All of that needs the Accessibility permission.
 */
export type ScriptingKind = "chromium" | "safari" | "firefox" | "menu";

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
ObjC.import("CoreGraphics");

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

function uiProcess(pid) {
  return Application("System Events").processes.whose({ unixId: pid })[0];
}

// Presses the File-menu item that has the given keyboard shortcut. Items are
// found by shortcut rather than by title, which changes with the system
// language. Pressing a menu item in another app is what needs the
// Accessibility permission.
function pressFileMenuItem(pid, key, shifted) {
  var process = uiProcess(pid);
  var items = process.menuBars[0].menuBarItems[2].menus[0].menuItems;
  var keys = items.attributes.byName("AXMenuItemCmdChar").value();
  var modifiers = items.attributes.byName("AXMenuItemCmdModifiers").value();
  for (var i = 0; i < keys.length; i++) {
    // Modifiers value 0 is Command alone, 1 is Shift with Command.
    if (String(keys[i]).toUpperCase() === key && modifiers[i] === (shifted ? 1 : 0)) {
      process.frontmost = true;
      items[i].click();
      return true;
    }
  }
  return false;
}

// File > New Window (Command-N) or, when "shifted", the private variant that
// browsers keep on Shift-Command-N: Safari's New Private Window, DuckDuckGo's
// New Fire Window.
function pressNewWindowItem(pid, shifted) {
  return pressFileMenuItem(pid, "N", shifted);
}

// Runs a step that drives another app's interface and turns a refusal into
// a reply saying which permission is missing.
function pressing(step, notFoundMessage) {
  try {
    if (!step()) return { ok: false, code: null, message: notFoundMessage };
  } catch (error) {
    if (error.errorNumber === -1743) throw error;
    return { ok: false, code: null, needsAccessibility: true, message: String(error.message || error) };
  }
  return null;
}

function openSafariPrivate(app, request) {
  var before = app.windows.id();
  var problem = pressing(function () {
    return pressNewWindowItem(pidOf(request.appPath), true);
  }, "Safari's New Private Window menu item wasn't found.");
  if (problem) return problem;
  var fresh = waitUntil(function () {
    var ids = app.windows.id().filter(function (id) { return before.indexOf(id) === -1; });
    return ids.length === 1 ? ids : null;
  }, 6);
  if (!fresh) {
    return { ok: false, code: null, message: "Safari didn't open a private window." };
  }
  app.windows.byId(fresh[0]).currentTab.url = request.url;
  return { ok: true, windowId: fresh[0], pid: pidOf(request.appPath) };
}

function openSafari(request) {
  var app = Application(request.appPath);
  var id = null;
  var wasClosed = pidOf(request.appPath) === 0;
  if (wasClosed) coldStart(app);
  if (request.private) return openSafariPrivate(app, request);

  if (wasClosed) {
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

// ---- Browsers with no scripting at all (DuckDuckGo) -------------------------
// Their windows are known only by the number macOS's window server gives
// them, which any app can read.

function systemWindows(pid, onScreenOnly) {
  var info = $.CGWindowListCopyWindowInfo(onScreenOnly ? 1 | 16 : 0, 0);
  return ObjC.deepUnwrap(ObjC.castRefToObject(info)).filter(function (w) {
    var size = w.kCGWindowBounds;
    return w.kCGWindowOwnerPID === pid && w.kCGWindowLayer === 0 &&
      size.Width > 200 && size.Height > 200;
  });
}

function windowNumbers(pid) {
  return systemWindows(pid, true).map(function (w) { return w.kCGWindowNumber; });
}

// A browser that was just started and sits on an empty new tab has its
// address bar focused and empty. That window can take the page.
function hasBlankStartWindow(pid) {
  try {
    if (windowNumbers(pid).length !== 1) return false;
    var focused = uiProcess(pid).attributes.byName("AXFocusedUIElement").value();
    return focused.role() === "AXTextField" && String(focused.value() || "") === "";
  } catch (error) {
    return false;
  }
}

// The address bar, if that is where the cursor is and it is empty. An empty
// bar in the toolbar is what a window that was just made shows; the check
// keeps us out of text boxes inside web pages and out of other windows'
// bars, which hold an address.
function emptyAddressBar(process) {
  var field = process.attributes.byName("AXFocusedUIElement").value();
  if (field.role() !== "AXTextField") return null;
  if (String(field.value() || "") !== "") return null;
  if (field.attributes.byName("AXParent").value().role() !== "AXToolbar") return null;
  return field;
}

// Puts the address into the address bar of the window that was just made
// and presses Return. Handing the browser the link the usual way doesn't
// work: DuckDuckGo jumps to a tab that already shows that address instead of
// loading it again.
function loadFromAddressBar(pid, url) {
  var process = uiProcess(pid);
  process.frontmost = true;
  var field = waitUntil(function () { return emptyAddressBar(process); }, 3);
  if (!field) {
    // File > Open Location (Command-L) puts the cursor there.
    pressFileMenuItem(pid, "L", false);
    field = waitUntil(function () { return emptyAddressBar(process); }, 3);
  }
  if (!field) return false;

  field.value = url;
  delay(0.2);
  for (var attempt = 0; attempt < 3; attempt++) {
    process.frontmost = true;
    delay(0.15);
    // Return goes to whichever app is in front, so check right before
    // pressing it.
    if (process.frontmost()) {
      Application("System Events").keyCode(36);
      return true;
    }
  }
  return false;
}

function openByMenu(request) {
  var pid = pidOf(request.appPath);
  var justStarted = pid === 0;
  if (justStarted) {
    $.NSWorkspace.sharedWorkspace.openURL($.NSURL.fileURLWithPath(request.appPath));
    pid = waitUntil(function () { return pidOf(request.appPath); }, 10);
    if (!pid) return { ok: false, code: null, message: "The browser didn't start." };
    waitUntil(function () { return windowNumbers(pid).length > 0; }, 8);
    delay(1);
  }

  var before = windowNumbers(pid);
  var windowId = null;
  if (justStarted && !request.private && hasBlankStartWindow(pid)) {
    windowId = before[0];
  } else {
    var problem = pressing(function () {
      return pressNewWindowItem(pid, request.private);
    }, "The browser's New Window menu item wasn't found.");
    if (problem) return problem;

    var fresh = waitUntil(function () {
      var numbers = windowNumbers(pid).filter(function (n) { return before.indexOf(n) === -1; });
      return numbers.length === 1 ? numbers : null;
    }, 6);
    if (!fresh) return { ok: false, code: null, message: "The browser didn't open a new window." };
    windowId = fresh[0];
  }

  var loadProblem = pressing(function () {
    return loadFromAddressBar(pid, request.url);
  }, "The browser's address bar couldn't be reached to load the page.");
  if (loadProblem) {
    // Don't leave the empty window behind.
    try { closeSystemWindow(pid, windowId); } catch (error) {}
    return loadProblem;
  }
  return { ok: true, windowId: windowId, pid: pid };
}

function sameFrame(bounds, position, size) {
  return Math.round(position[0]) === Math.round(bounds.X) &&
    Math.round(position[1]) === Math.round(bounds.Y) &&
    Math.round(size[0]) === Math.round(bounds.Width) &&
    Math.round(size[1]) === Math.round(bounds.Height);
}

// Finds, in the app's own interface, the window that the window server
// knows as "target". Windows carry no number there, so it is matched by
// position and size. New windows often open exactly on top of each other;
// those are told apart by depth, since both lists run front to back.
// Returns -1 when there is no safe answer.
function interfaceIndexOf(pid, target) {
  var bounds = target.kCGWindowBounds;
  var stacked = systemWindows(pid, true).filter(function (w) {
    var b = w.kCGWindowBounds;
    return sameFrame(bounds, [b.X, b.Y], [b.Width, b.Height]);
  });
  var depth = stacked.map(function (w) { return w.kCGWindowNumber; })
    .indexOf(target.kCGWindowNumber);

  var windows = uiProcess(pid).windows;
  var positions = windows.position();
  var sizes = windows.size();
  var minimized = windows.attributes.byName("AXMinimized").value();
  var candidates = [];
  for (var i = 0; i < positions.length; i++) {
    if (!minimized[i] && sameFrame(bounds, positions[i], sizes[i])) candidates.push(i);
  }

  // Both lists must agree on how many windows share this spot; otherwise
  // one of them holds a window the other can't see, and guessing could
  // close the wrong one.
  if (depth === -1 || candidates.length !== stacked.length) return -1;
  return candidates[depth];
}

// Presses the close button of the window with this window-server number.
// Returns "closed", "gone" if it is no longer on screen, or "unsure" if it
// can't be picked out safely, in which case it is left open.
function closeSystemWindow(pid, number) {
  // Only windows that are on screen count: the window server keeps listing
  // a closed window for a while, off screen.
  var target = systemWindows(pid, true).filter(function (w) {
    return w.kCGWindowNumber === number;
  })[0];
  if (!target) return "gone";

  var index = interfaceIndexOf(pid, target);
  if (index === -1) return "unsure";
  uiProcess(pid).windows[index].buttons.whose({ subrole: "AXCloseButton" })[0].click();
  // Let the window go before anything looks at the list again.
  waitUntil(function () {
    return systemWindows(pid, true).every(function (w) {
      return w.kCGWindowNumber !== number;
    });
  }, 3);
  return "closed";
}

// Closes windows known by their window-server number. A window that can't
// be picked out safely is left open.
function closeByFrame(request) {
  var pid = pidOf(request.appPath);
  var closed = 0;
  var alreadyGone = 0;
  var unsure = 0;
  var failure = null;
  request.handles.forEach(function (handle) {
    if (failure) return;
    if (pid === 0 || handle.pid !== pid) { alreadyGone++; return; }
    var outcome = null;
    failure = pressing(function () {
      outcome = closeSystemWindow(pid, handle.windowId);
      return true;
    }, "");
    if (failure) return;
    if (outcome === "gone") alreadyGone++;
    else if (outcome === "unsure") unsure++;
    else closed++;
  });
  if (failure) return failure;
  return { ok: true, closed: closed, alreadyGone: alreadyGone, unsure: unsure };
}

var ACTIONS = {
  "open-by-menu": openByMenu,
  "close-by-frame": closeByFrame,
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

type Failure = {
  ok: false;
  code: number | null;
  message: string;
  /** The step that failed needs the macOS Accessibility permission. */
  needsAccessibility?: boolean;
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
  /** Nothing was opened this way; the caller should open the page plainly. */
  | {
      opened: false;
      /** macOS hasn't allowed the launcher to control this browser. */
      notAllowed: boolean;
      /** The Accessibility permission is what's missing. */
      needsAccessibility: boolean;
      detail: string;
    };

function refused(failure: Failure): TrackedOpen {
  return {
    opened: false,
    notAllowed: failure.code === NOT_ALLOWED,
    needsAccessibility: failure.needsAccessibility === true,
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

  const action =
    kind === "safari"
      ? "open-safari"
      : kind === "menu"
        ? "open-by-menu"
        : "open-chromium";
  const reply = await script<WindowHandle>({
    action,
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
  | {
      ok: true;
      closed: number;
      alreadyGone: number;
      /** Windows left open because they couldn't be told apart from others. */
      unsure: number;
    }
  | {
      ok: false;
      notAllowed: boolean;
      needsAccessibility: boolean;
      detail: string;
    };

/** Closes the windows behind `handles`, skipping any that no longer exist. */
export async function closeTrackedWindows(
  kind: ScriptingKind,
  appPath: string,
  handles: readonly WindowHandle[],
): Promise<CloseOutcome> {
  const reply = await script<{
    closed: number;
    alreadyGone: number;
    unsure?: number;
  }>({
    action: kind === "menu" ? "close-by-frame" : "close-windows",
    appPath,
    handles,
  });
  if (!reply.ok) {
    return {
      ok: false,
      notAllowed: reply.code === NOT_ALLOWED,
      needsAccessibility: reply.needsAccessibility === true,
      detail: reply.message,
    };
  }
  return {
    ok: true,
    closed: reply.closed,
    alreadyGone: reply.alreadyGone,
    unsure: reply.unsure ?? 0,
  };
}
