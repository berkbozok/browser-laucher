"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserIcon } from "@/components/browser-icon";
import { OpenWindows } from "@/components/open-windows";
import {
  MAX_TRACKED_PER_BROWSER,
  readTrackedWindows,
  windowKey,
  windowsFrom,
  withoutWindows,
  type TrackedWindow,
  type TrackedWindows,
} from "@/lib/tracked-windows";
import type {
  BrowserInfo,
  BrowsersResponse,
  CloseRequest,
  CloseResponse,
  CloseResult,
  FocusRequest,
  FocusResponse,
  OpenRequest,
  OpenResponse,
  OpenResult,
  WindowsRequest,
  WindowsResponse,
  WindowStatus,
} from "@/lib/types";
import { normalizeUrl } from "@/lib/url";

/** How often the page asks what its windows are showing. */
const WATCH_EVERY_MS = 4000;

const STORAGE_KEY = "browser-launcher:v1";

type Prefs = {
  url: string;
  selected: string[];
  incognito: boolean;
  windows: TrackedWindows;
};

type LaunchState =
  | { status: "opening" }
  | { status: "done"; result: OpenResult }
  | { status: "closing" }
  | { status: "closed"; result: CloseResult };

type Notice = { text: string; allGood: boolean };

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { url, selected, incognito, windows } = parsed as Record<
      string,
      unknown
    >;
    return {
      url: typeof url === "string" ? url : "",
      selected: Array.isArray(selected)
        ? selected.filter((id): id is string => typeof id === "string")
        : [],
      incognito: incognito === true,
      windows: readTrackedWindows(windows),
    };
  } catch {
    return null;
  }
}

function writePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable (private windows); remembering is optional.
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new Error("Can't reach the launcher server. Is it still running?");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `The request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const nameList = new Intl.ListFormat("en", { type: "conjunction" });

/** One line describing how the last launch went, across all browsers. */
function summarizeOpen(results: OpenResult[]): Notice | null {
  if (results.length === 0) return null;

  const privateWindows = results.flatMap((r) => r.privateWindow ?? []);
  const opened =
    results.filter((r) => r.ok).length +
    privateWindows.filter((p) => p.status === "opened").length;
  const failed =
    results.filter((r) => !r.ok).length +
    privateWindows.filter((p) => p.status === "failed").length;
  const namesWhere = (test: (result: OpenResult) => boolean) =>
    results.filter(test).map((r) => r.name);

  const parts: string[] = [];
  if (privateWindows.length === 0) {
    parts.push(
      failed === 0
        ? `Opened in ${plural(opened, "browser")}.`
        : `Opened in ${opened} of ${plural(results.length, "browser")}. ${failed} failed.`,
    );
  } else {
    parts.push(
      failed === 0
        ? `Opened ${plural(opened, "window")} in ${plural(results.length, "browser")}.`
        : `Opened ${opened} of ${plural(opened + failed, "window")}. ${failed} failed.`,
    );
    const normalOnly = namesWhere(
      (r) => r.privateWindow?.status === "unsupported",
    );
    if (normalOnly.length > 0) {
      parts.push(
        `${nameList.format(normalOnly)} can only open a normal window from here.`,
      );
    }
  }

  // Say why, for each window that didn't open.
  for (const result of results) {
    if (!result.ok && result.error) {
      parts.push(`${result.name}: ${result.error}`);
    }
    if (result.privateWindow?.status === "failed") {
      parts.push(`${result.name}: ${result.privateWindow.error}`);
    }
  }

  // Windows that opened but that the Close button won't be able to reach.
  const notAllowed = namesWhere((r) => r.untracked === "not-allowed");
  if (notAllowed.length > 0) {
    parts.push(
      `macOS hasn't allowed the launcher to control ${nameList.format(notAllowed)}, so Close can't reach ${notAllowed.length === 1 ? "it" : "them"}. Allow it under System Settings → Privacy & Security → Automation.`,
    );
  }
  const byHand = namesWhere(
    (r) => r.untracked === "unsupported" || r.untracked === "unidentified",
  );
  if (byHand.length > 0) {
    parts.push(
      `${nameList.format(byHand)} can't be listed or closed from here; close ${byHand.length === 1 ? "its" : "their"} windows by hand.`,
    );
  }

  return {
    text: parts.join(" "),
    allGood: failed === 0 && notAllowed.length === 0,
  };
}

function summarizeClose(results: CloseResult[]): Notice {
  const closed = results.reduce((sum, r) => sum + r.closed, 0);
  const gone = results.reduce((sum, r) => sum + r.alreadyGone, 0);
  const failures = results.filter((r) => r.error);

  const parts: string[] = [];
  if (closed > 0) parts.push(`Closed ${plural(closed, "window")}.`);
  if (gone > 0) {
    parts.push(
      closed > 0
        ? `${gone} had already been closed.`
        : gone === 1
          ? "That window had already been closed."
          : "Those windows had already been closed.",
    );
  }
  for (const failure of failures) {
    parts.push(`${failure.name}: ${failure.error}`);
  }
  if (parts.length === 0) parts.push("There was nothing to close.");
  return { text: parts.join(" "), allGood: failures.length === 0 };
}

export function Launcher() {
  const [data, setData] = useState<BrowsersResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanId, setScanId] = useState(0);

  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [incognito, setIncognito] = useState(false);
  const [launch, setLaunch] = useState<Record<string, LaunchState>>({});
  const [tracked, setTracked] = useState<TrackedWindows>({});
  const [live, setLive] = useState<Record<string, WindowStatus>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);

  // Saved choices are applied once, on the first successful scan.
  const restored = useRef(false);

  useEffect(() => {
    let cancelled = false;

    requestJson<BrowsersResponse>("/api/browsers")
      .then((result) => {
        if (cancelled) return;
        const installed = result.browsers
          .filter((browser) => browser.installed)
          .map((browser) => browser.id);

        setData(result);
        setScanError(null);

        if (restored.current) {
          setSelected(
            (current) =>
              new Set([...current].filter((id) => installed.includes(id))),
          );
          return;
        }

        restored.current = true;
        const prefs = readPrefs();
        setSelected(
          new Set(
            prefs
              ? prefs.selected.filter((id) => installed.includes(id))
              : installed,
          ),
        );
        if (prefs?.url) setUrl((current) => current || prefs.url);
        if (prefs?.incognito) setIncognito(true);
        if (prefs) setTracked(prefs.windows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setScanError(toMessage(error));
      })
      .finally(() => {
        if (!cancelled) setScanning(false);
      });

    return () => {
      cancelled = true;
    };
  }, [scanId]);

  useEffect(() => {
    if (!data) return;
    writePrefs({ url, selected: [...selected], incognito, windows: tracked });
  }, [data, url, selected, incognito, tracked]);

  // While the launcher has windows open, keep asking what they show. A window
  // that turns out to be gone (closed by hand, browser quit) drops off the
  // list, which also keeps the Close button's count honest.
  useEffect(() => {
    const watched = Object.entries(tracked).map(([browser, windows]) => ({
      browser,
      handles: windows.map((w) => w.handle),
    }));
    if (watched.length === 0 || opening || closing) return;

    let cancelled = false;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      const request: WindowsRequest = { windows: watched };
      let response: WindowsResponse;
      try {
        response = await requestJson<WindowsResponse>("/api/windows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
      } catch {
        return; // The next round will try again.
      }
      if (cancelled) return;

      const seen: Record<string, WindowStatus> = {};
      const gone = new Set<string>();
      for (const { browser, handles } of watched) {
        const result = response.results.find((r) => r.id === browser);
        // No answer for this browser tells us nothing about its windows.
        if (!result?.windows) continue;
        handles.forEach((handle, index) => {
          const status = result.windows?.[index];
          if (!status) return;
          const key = windowKey(browser, handle);
          if (status.open) seen[key] = status;
          else gone.add(key);
        });
      }
      setLive(seen);
      setTracked((current) => withoutWindows(current, gone));
    };

    void look();
    const timer = window.setInterval(() => void look(), WATCH_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tracked, opening, closing]);

  const installed = data?.browsers.filter((browser) => browser.installed) ?? [];
  const missing = data?.browsers.filter((browser) => !browser.installed) ?? [];
  const chosen = installed.filter((browser) => selected.has(browser.id));
  // Browsers without a private mode still get their normal window.
  const windowCount =
    chosen.length +
    (incognito ? chosen.filter((browser) => browser.supportsPrivate).length : 0);
  // Close only ever touches the browsers that are ticked right now.
  const closable = chosen.flatMap((browser) => {
    const handles = (tracked[browser.id] ?? []).map((w) => w.handle);
    return handles.length > 0 ? [{ browser: browser.id, handles }] : [];
  });
  const closableCount = closable.reduce((sum, c) => sum + c.handles.length, 0);
  const needSetup = chosen
    .filter((browser) => browser.needsAccessibility)
    .map((browser) => browser.name);

  function rescan() {
    setScanning(true);
    setScanId((id) => id + 1);
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function openAll() {
    const target = normalizeUrl(url);
    if (!target) {
      setFormError(
        "That doesn't look like a web address. Try something like example.com.",
      );
      return;
    }

    const ids = chosen.map((browser) => browser.id);
    setFormError(null);
    setNotice(null);
    setUrl(target);
    setOpening(true);
    setLaunch(Object.fromEntries(ids.map((id) => [id, { status: "opening" }])));

    const request: OpenRequest = {
      url: target,
      browsers: ids,
      includePrivate: incognito,
    };
    try {
      const { results, openedAt } = await requestJson<OpenResponse>("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      setLaunch(
        Object.fromEntries(
          results.map((result): [string, LaunchState] => [
            result.id,
            { status: "done", result },
          ]),
        ),
      );
      // Remember the new windows on top of any that are still open.
      setTracked((current) => {
        const next = { ...current };
        for (const result of results) {
          const windows = windowsFrom(result, target, openedAt);
          if (windows.length > 0) {
            next[result.id] = [...(next[result.id] ?? []), ...windows].slice(
              -MAX_TRACKED_PER_BROWSER,
            );
          }
        }
        return next;
      });
      setNotice(summarizeOpen(results));
    } catch (error) {
      setLaunch({});
      setFormError(toMessage(error));
    } finally {
      setOpening(false);
    }
  }

  async function showWindow(browser: BrowserInfo, target: TrackedWindow) {
    const request: FocusRequest = { browser: browser.id, handle: target.handle };
    setFormError(null);
    try {
      const { gone } = await requestJson<FocusResponse>("/api/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!gone) return;
      setTracked((current) =>
        withoutWindows(
          current,
          new Set([windowKey(browser.id, target.handle)]),
        ),
      );
      setNotice({
        text: `That ${browser.name} window had already been closed.`,
        allGood: false,
      });
    } catch (error) {
      setFormError(toMessage(error));
    }
  }

  async function closeAll() {
    if (closable.length === 0) return;
    const request: CloseRequest = { windows: closable };

    setFormError(null);
    setNotice(null);
    setClosing(true);
    setLaunch((current) => ({
      ...current,
      ...Object.fromEntries(
        closable.map((c): [string, LaunchState] => [
          c.browser,
          { status: "closing" },
        ]),
      ),
    }));

    try {
      const { results } = await requestJson<CloseResponse>("/api/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      setLaunch((current) => ({
        ...current,
        ...Object.fromEntries(
          results.map((result): [string, LaunchState] => [
            result.id,
            { status: "closed", result },
          ]),
        ),
      }));
      // Forget the windows that are gone. Where closing failed, keep them so
      // the button can try again.
      setTracked((current) => {
        const next = { ...current };
        for (const result of results) {
          if (!result.error) delete next[result.id];
        }
        return next;
      });
      setNotice(summarizeClose(results));
    } catch (error) {
      setLaunch((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([, state]) => state.status !== "closing",
          ),
        ),
      );
      setFormError(toMessage(error));
    } finally {
      setClosing(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void openAll();
        }}
      >
        <label htmlFor="url" className="text-sm font-medium">
          URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="example.com or localhost:3000"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setFormError(null);
              setNotice(null);
              setLaunch({});
            }}
            aria-invalid={formError ? true : undefined}
            aria-describedby="form-status"
            className="h-11 min-w-0 rounded-lg border sm:flex-1 border-zinc-300 bg-white px-3 font-mono text-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/25 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={opening || closing || chosen.length === 0}
            className="h-11 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white outline-none transition hover:bg-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            {opening
              ? "Opening…"
              : chosen.length === 0
                ? "Select a browser"
                : incognito
                  ? `Open ${plural(windowCount, "window")}`
                  : `Open in ${plural(chosen.length, "browser")}`}
          </button>
          <button
            type="button"
            onClick={() => void closeAll()}
            disabled={opening || closing || closableCount === 0}
            title="Closes the windows the launcher opened in the ticked browsers"
            className="h-11 shrink-0 rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium outline-none transition hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600 dark:disabled:hover:bg-zinc-900"
          >
            {closing
              ? "Closing…"
              : closableCount === 0
                ? "Close windows"
                : `Close ${plural(closableCount, "window")}`}
          </button>
        </div>
        <label className="mt-1 flex w-fit cursor-pointer items-center gap-3 select-none">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={incognito}
            onChange={(event) => setIncognito(event.target.checked)}
          />
          <span
            aria-hidden="true"
            className="relative h-6 w-10 shrink-0 rounded-full bg-zinc-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-3 peer-focus-visible:ring-blue-500/40 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4 dark:bg-zinc-700"
          />
          <span className="text-sm">
            <span className="font-medium">Also open in incognito</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}
              — a second, private window in each browser
            </span>
          </span>
        </label>
        <p id="form-status" aria-live="polite" className="min-h-5 text-sm">
          {formError ? (
            <span className="text-red-600 dark:text-red-400">{formError}</span>
          ) : notice ? (
            <span
              className={
                notice.allGood
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              }
            >
              {notice.text}
            </span>
          ) : null}
        </p>
      </form>

      <OpenWindows
        browsers={installed}
        tracked={tracked}
        live={live}
        onShow={(browser, target) => void showWindow(browser, target)}
      />

      <section aria-labelledby="browsers-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="browsers-heading" className="text-sm font-medium">
            Browsers
            {data ? (
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                {chosen.length} of {installed.length} selected
              </span>
            ) : null}
          </h2>
          <div className="flex gap-4 text-sm">
            <ToolbarButton
              disabled={chosen.length === installed.length}
              onClick={() =>
                setSelected(new Set(installed.map((browser) => browser.id)))
              }
            >
              Select all
            </ToolbarButton>
            <ToolbarButton
              disabled={chosen.length === 0}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </ToolbarButton>
            <ToolbarButton disabled={scanning} onClick={rescan}>
              {scanning ? "Scanning…" : "Rescan"}
            </ToolbarButton>
          </div>
        </div>

        {scanError ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            Couldn&apos;t check which browsers are installed. {scanError}
          </p>
        ) : null}

        {!data ? (
          scanError ? null : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Looking for installed browsers…
            </p>
          )
        ) : !data.supported ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Finding and opening browsers only works on macOS for now.
          </p>
        ) : installed.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            No supported browsers were found in your Applications folders.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {installed.map((browser) => (
              <li key={browser.id}>
                <BrowserCard
                  browser={browser}
                  checked={selected.has(browser.id)}
                  state={launch[browser.id]}
                  normalOnly={incognito && !browser.supportsPrivate}
                  openCount={tracked[browser.id]?.length ?? 0}
                  onToggle={() => toggle(browser.id)}
                />
              </li>
            ))}
          </ul>
        )}

        {needSetup.length > 0 ? (
          <p
            role="note"
            className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="mt-0.5 size-4 shrink-0"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M8.5 2.9a1.75 1.75 0 0 1 3 0l6.3 10.9a1.75 1.75 0 0 1-1.5 2.6H3.7a1.75 1.75 0 0 1-1.5-2.6L8.5 2.9ZM10 7a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 7Zm0 7.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
              />
            </svg>
            <span>
              <strong className="font-semibold">
                {nameList.format(needSetup)}{" "}
                {needSetup.length === 1 ? "needs" : "need"} a one-time setup
                for incognito.
              </strong>{" "}
              In System Settings → Privacy &amp; Security → Accessibility, turn
              on the app that runs this launcher (Terminal, Cursor, …), and
              click Allow if macOS asks about “System Events”. Until then,{" "}
              {nameList.format(needSetup)}{" "}
              {needSetup.length === 1 ? "opens" : "open"} a normal window only.
            </span>
          </p>
        ) : null}

        {data?.supported && missing.length > 0 ? (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
            Not installed: {missing.map((browser) => browser.name).join(", ")}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ToolbarButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded text-blue-600 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-default disabled:text-zinc-400 disabled:no-underline dark:text-blue-400 dark:disabled:text-zinc-600"
    >
      {children}
    </button>
  );
}

function BrowserCard({
  browser,
  checked,
  state,
  normalOnly,
  openCount,
  onToggle,
}: {
  browser: BrowserInfo;
  checked: boolean;
  state: LaunchState | undefined;
  /** Incognito is on, but this browser can't open a private window. */
  normalOnly: boolean;
  /** How many windows the launcher has open in this browser. */
  openCount: number;
  onToggle: () => void;
}) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 transition select-none hover:border-zinc-300 has-checked:border-blue-500 has-checked:bg-blue-50 has-focus-visible:ring-3 has-focus-visible:ring-blue-500/30 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:has-checked:border-blue-500 dark:has-checked:bg-blue-500/10">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={onToggle}
      />
      <BrowserIcon id={browser.id} name={browser.name} />
      <span
        className="flex min-w-0 flex-1 flex-col"
        // The technical reason, when a window opened but can't be closed.
        title={
          state?.status === "done" ? state.result.untrackedDetail : undefined
        }
      >
        <span className="truncate text-sm font-medium">{browser.name}</span>
        <LaunchStatus
          state={state}
          normalOnly={normalOnly}
          openCount={openCount}
        />
      </span>
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-transparent transition peer-checked:border-blue-600 peer-checked:bg-blue-600 peer-checked:text-white dark:border-zinc-700"
      >
        <svg viewBox="0 0 16 16" className="size-3" fill="none">
          <path
            d="M3.5 8.5l3 3 6-7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </label>
  );
}

function LaunchStatus({
  state,
  normalOnly,
  openCount,
}: {
  state: LaunchState | undefined;
  normalOnly: boolean;
  openCount: number;
}) {
  const muted = "text-xs text-zinc-500 dark:text-zinc-400";
  const good = "text-xs text-emerald-700 dark:text-emerald-400";
  const bad = "line-clamp-2 text-xs text-red-600 dark:text-red-400";

  if (!state) {
    if (openCount > 0) {
      return <span className={muted}>{plural(openCount, "window")} open</span>;
    }
    return normalOnly ? <span className={muted}>Normal window only</span> : null;
  }
  if (state.status === "opening") {
    return <span className={muted}>Opening…</span>;
  }
  if (state.status === "closing") {
    return <span className={muted}>Closing…</span>;
  }
  if (state.status === "closed") {
    const { closed, error } = state.result;
    if (error) {
      return (
        <span className={bad} title={error}>
          {error}
        </span>
      );
    }
    return (
      <span className={muted}>{closed > 0 ? "Closed" : "Already closed"}</span>
    );
  }

  const { ok, error, privateWindow } = state.result;
  if (!ok) {
    const message = error ?? "Could not open this browser.";
    const text =
      privateWindow?.status === "opened"
        ? `Only the incognito window opened. ${message}`
        : message;
    return (
      <span className={bad} title={text}>
        {text}
      </span>
    );
  }
  if (privateWindow?.status === "failed") {
    return (
      <span className={bad} title={privateWindow.error}>
        Opened, but incognito failed
      </span>
    );
  }
  if (privateWindow?.status === "unsupported") {
    return (
      <span className={good}>
        Opened <span className={muted}>· normal only</span>
      </span>
    );
  }
  return (
    <span className={good}>
      {privateWindow ? "Opened + incognito" : "Opened"}
    </span>
  );
}
