/** Shapes shared by the API routes and the UI. */

export type BrowserInfo = {
  id: string;
  name: string;
  installed: boolean;
  /** Whether this browser can be told to open a private (incognito) window. */
  supportsPrivate: boolean;
  /**
   * True when that private window only works after the person has switched
   * on the macOS Accessibility permission (Safari).
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
 * The browser's process id is part of it because window ids start over when
 * a browser restarts.
 */
export type WindowHandle = {
  /** The browser's own id for the window: text in some browsers, a number in others. */
  windowId: string | number;
  pid: number;
};

/**
 * Why a window that did open can't be closed by the launcher:
 * - "unsupported":  the browser can't be controlled from outside at all;
 * - "not-allowed":  macOS hasn't given permission to control it;
 * - "needs-accessibility": it is driven through its menus, and macOS hasn't
 *                   switched on Accessibility for that;
 * - "unidentified": it opened, but we couldn't tell which window is ours.
 */
export type Untracked =
  | "unsupported"
  | "not-allowed"
  | "needs-accessibility"
  | "unidentified";

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
  results: OpenResult[];
};
