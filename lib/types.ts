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
 * Identifies one window the launcher opened, so it can find it again later.
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
  /**
   * macOS's own number for the window, which is what a picture of it is
   * taken by. Null when it couldn't be worked out.
   */
  screenId?: number | null;
};

/**
 * Why a window that did open can't be listed or closed by the launcher:
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
  /** Present when the launcher can find the normal window again. */
  handle?: WindowHandle;
  /** Set when one of this browser's windows opened but can't be found again. */
  untracked?: Untracked;
  /** The technical reason behind `untracked`, for troubleshooting. */
  untrackedDetail?: string;
  /** Only present when a private window was asked for. */
  privateWindow?: PrivateWindowResult;
};

export type OpenResponse = {
  /** The URL that was actually opened, after normalisation. */
  url: string;
  /** When this launch happened, in milliseconds since 1970. */
  openedAt: number;
  results: OpenResult[];
};

/** One window the launcher has open right now, as the page shows it. */
export type OpenWindow = {
  /** Names this window when asking to show it or for a picture of it. */
  key: string;
  /** Id of the browser it belongs to. */
  browser: string;
  /** True for the incognito window of a launch. */
  private: boolean;
  /** The address it was opened on. */
  openedUrl: string;
  /**
   * When it was opened, in milliseconds. The windows from one press of Open
   * share the same value, which pairs a normal window with its incognito one.
   */
  launch: number;
  /** The page's title, where the browser can tell us. */
  title?: string;
  /** The address it is on now, where the browser can tell us (not Firefox). */
  url?: string;
  /** Whether a live picture of the window can be asked for. */
  hasPreview: boolean;
};

export type WindowsResponse = {
  windows: OpenWindow[];
  /**
   * Whether macOS lets the launcher take pictures of windows (the Screen
   * Recording permission). Null when that couldn't be found out.
   */
  mayCapture: boolean | null;
};

/** Close the launcher's windows in these browsers. */
export type CloseRequest = {
  browsers: string[];
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

/** Bring one of the launcher's windows to the front. */
export type FocusRequest = {
  key: string;
};

export type FocusResponse = {
  /** True when the window is no longer there to show. */
  gone: boolean;
  /** True when it is now in front of that browser's other windows. */
  inFront: boolean;
};
