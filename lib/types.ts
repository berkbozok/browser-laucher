/** Shapes shared by the API routes and the UI. */

export type BrowserInfo = {
  id: string;
  name: string;
  installed: boolean;
  /** Whether this browser can be told to open a private (incognito) window. */
  supportsPrivate: boolean;
  /**
   * True when that private window only works after the person has switched
   * on the macOS Accessibility permission. Safari is the one such browser.
   */
  needsAccessibility: boolean;
};

export type BrowsersResponse = {
  /** False when the server runs on an OS we can't detect browsers on yet. */
  supported: boolean;
  browsers: BrowserInfo[];
};

export type OpenRequest = {
  url: string;
  browsers: string[];
  /** Also open the URL in a private (incognito) window in each browser. */
  includePrivate?: boolean;
};

/**
 * Identifies one window the launcher opened, so it can close it again later.
 * A window id only means something within one run of the browser (ids start
 * over when it restarts), so the handle also says which run: the browser's
 * process id and the moment it was started.
 */
export type WindowHandle = {
  /** The browser's own id for the window: text in some browsers, a number in others. */
  windowId: string | number;
  pid: number;
  /** When that browser process started, in milliseconds since 1970. */
  startedAt: number;
};

/**
 * Why a window that did open can't be closed by the launcher:
 * - "unsupported":  the browser can't be controlled from outside at all;
 * - "not-allowed":  macOS hasn't given permission to control it;
 * - "unidentified": it opened, but we couldn't tell which window is ours.
 */
export type Untracked = "unsupported" | "not-allowed" | "unidentified";

/** How the extra private window went for one browser. */
export type PrivateWindowResult =
  | { status: "opened"; handle?: WindowHandle }
  /** The browser has no way to open a private window from outside the app. */
  | { status: "unsupported" }
  | { status: "failed"; error: string };

export type OpenResult = {
  id: string;
  name: string;
  /** Whether the normal window opened. */
  ok: boolean;
  error?: string;
  /** Present when the launcher can close the normal window again. */
  handle?: WindowHandle;
  /** Set when one of this browser's windows opened but can't be closed. */
  untracked?: Untracked;
  /** The technical reason behind `untracked`, for troubleshooting. */
  untrackedDetail?: string;
  /** Only present when a private window was asked for. */
  privateWindow?: PrivateWindowResult;
};

export type CloseRequest = {
  windows: { browser: string; handles: WindowHandle[] }[];
};

export type CloseResult = {
  id: string;
  name: string;
  closed: number;
  /** Windows that had already been closed by hand. */
  alreadyGone: number;
  error?: string;
};

export type CloseResponse = {
  results: CloseResult[];
};

export type OpenResponse = {
  /** The URL that was actually opened, after normalisation. */
  url: string;
  /** When this launch happened, in milliseconds since 1970. */
  openedAt: number;
  results: OpenResult[];
};

/** Asks what the given windows are showing right now. */
export type WindowsRequest = {
  windows: { browser: string; handles: WindowHandle[] }[];
};

export type WindowStatus = {
  /** False once the window is gone (closed, or its browser was quit). */
  open: boolean;
  /** The page's title, where the browser can tell us. */
  title?: string;
  /** The page's address, where the browser can tell us (not Firefox). */
  url?: string;
};

export type WindowsResponse = {
  results: {
    id: string;
    /** One entry per handle sent, in the same order. Absent on error. */
    windows?: WindowStatus[];
    error?: string;
  }[];
};

/** Asks for one window to be brought to the front. */
export type FocusRequest = {
  browser: string;
  handle: WindowHandle;
};

export type FocusResponse = {
  /** True when the window is no longer there to show. */
  gone: boolean;
  /** True when it is now in front of that browser's other windows. */
  inFront: boolean;
};
