"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserGroups, type SavedGroup } from "@/components/browser-groups";
import { BrowserIcon } from "@/components/browser-icon";
import {
  OpenWindows,
  type LostBrowser,
  type WindowActions,
} from "@/components/open-windows";
import { PictureDialog } from "@/components/picture-dialog";
import { SetupCheck } from "@/components/setup-check";
import { postJson, requestJson, toMessage } from "@/lib/client";
import type { Layout } from "@/lib/layout";
import {
  summarizeAction,
  summarizeClose,
  summarizeOpen,
  type Notice,
} from "@/lib/summaries";
import type {
  ActionResponse,
  ArrangeRequest,
  BrowserInfo,
  BrowsersResponse,
  CloseRequest,
  CloseResponse,
  CloseResult,
  FocusRequest,
  FocusResponse,
  NavigateRequest,
  OpenRequest,
  OpenResponse,
  OpenResult,
  OpenWindow,
  SnapshotsResponse,
  Untracked,
  WindowSelection,
  WindowsResponse,
} from "@/lib/types";
import { normalizeUrl } from "@/lib/url";
import { nameList, plural } from "@/lib/words";

/** How often the page asks what its windows are showing. */
const WATCH_EVERY_MS = 4000;
/** How many addresses are remembered for the URL field's suggestions. */
const RECENT_MAX = 8;

const STORAGE_KEY = "browser-launcher:v1";

type Prefs = {
  url: string;
  selected: string[];
  incognito: boolean;
  /** Quit browsers the launcher had to start, when closing their windows. */
  quitStarted: boolean;
  /** Addresses opened lately, newest first. */
  recent: string[];
  groups: SavedGroup[];
};

type LaunchState =
  | { status: "opening" }
  | { status: "done"; result: OpenResult }
  | { status: "closing" }
  | { status: "closed"; result: CloseResult };

/** Why a browser that was opened isn't in the list of open windows. */
type LostNote = { reason: Untracked; detail?: string };

function explainLost(name: string, reason: Untracked): string {
  if (reason === "not-allowed") {
    return `Opened, but macOS hasn't allowed the launcher to control ${name}, so it can't show or close its windows. Allow it under System Settings → Privacy & Security → Automation.`;
  }
  if (reason === "unidentified") {
    return `Opened, but the launcher couldn't tell which of ${name}'s windows was its own, so it isn't following it. Close it by hand.`;
  }
  return `Opened in ${name}. It can't be shown or closed from here, so there is no live view; close it by hand.`;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const saved = parsed as Record<string, unknown>;
    const groups = Array.isArray(saved.groups) ? saved.groups : [];
    return {
      url: typeof saved.url === "string" ? saved.url : "",
      selected: strings(saved.selected),
      incognito: saved.incognito === true,
      // On unless it was switched off.
      quitStarted: saved.quitStarted !== false,
      recent: strings(saved.recent).slice(0, RECENT_MAX),
      groups: groups.flatMap((group: unknown): SavedGroup[] => {
        if (typeof group !== "object" || group === null) return [];
        const { name, ids } = group as Record<string, unknown>;
        return typeof name === "string" ? [{ name, ids: strings(ids) }] : [];
      }),
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

const without = <T,>(record: Record<string, T>, drop: (key: string) => boolean) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !drop(key)));

export function Launcher() {
  const [data, setData] = useState<BrowsersResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanId, setScanId] = useState(0);

  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [incognito, setIncognito] = useState(false);
  const [quitStarted, setQuitStarted] = useState(true);
  const [recent, setRecent] = useState<string[]>([]);
  const [groups, setGroups] = useState<SavedGroup[]>([]);

  const [launch, setLaunch] = useState<Record<string, LaunchState>>({});
  // The launcher's open windows, as the server last listed them. The server
  // keeps the list, so it survives a reload and a reply that went missing.
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [mayCapture, setMayCapture] = useState<boolean | null>(null);
  // Bumped to ask for the list again right away.
  const [listTurn, setListTurn] = useState(0);
  // Browsers the last launch opened but can't follow, by browser id.
  const [lost, setLost] = useState<Record<string, LostNote>>({});
  // The window shown large, by key.
  const [enlarged, setEnlarged] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // What is in progress, if anything. Opening and closing change the list
  // of windows themselves; "working" covers everything else.
  const [busy, setBusy] = useState<"opening" | "closing" | "working" | null>(
    null,
  );

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
        if (!prefs) return;
        if (prefs.url) setUrl((current) => current || prefs.url);
        setIncognito(prefs.incognito);
        setQuitStarted(prefs.quitStarted);
        setRecent(prefs.recent);
        setGroups(prefs.groups);
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
    writePrefs({
      url,
      selected: [...selected],
      incognito,
      quitStarted,
      recent,
      groups,
    });
  }, [data, url, selected, incognito, quitStarted, recent, groups]);

  // Keep the list of open windows current: what each shows, and which are
  // gone (closed by hand, browser quit). Paused while an Open or Close is
  // running, which changes the list itself.
  const listChanging = busy === "opening" || busy === "closing";
  useEffect(() => {
    if (listChanging) return;

    let cancelled = false;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await requestJson<WindowsResponse>("/api/windows");
        if (cancelled) return;
        setWindows(response.windows);
        setMayCapture(response.mayCapture);
      } catch {
        // The next round will try again.
      }
    };

    void look();
    const timer = window.setInterval(() => void look(), WATCH_EVERY_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [listTurn, listChanging]);

  const installed = data?.browsers.filter((browser) => browser.installed) ?? [];
  const missing = data?.browsers.filter((browser) => !browser.installed) ?? [];
  const chosen = installed.filter((browser) => selected.has(browser.id));
  // Browsers without a private mode still get their normal window.
  const windowCount =
    chosen.length +
    (incognito ? chosen.filter((browser) => browser.supportsPrivate).length : 0);

  // Everything done to "the open windows" only touches the browsers that are
  // ticked right now.
  const openIn = (id: string) => windows.filter((w) => w.browser === id).length;
  const ticked = chosen
    .filter((browser) => openIn(browser.id) > 0)
    .map((browser) => browser.id);
  const tickedCount = ticked.reduce((sum, id) => sum + openIn(id), 0);

  const needSetup = chosen
    .filter((browser) => browser.needsAccessibility)
    .map((browser) => browser.name);
  const lostBrowsers: LostBrowser[] = installed.flatMap((browser) => {
    const note = lost[browser.id];
    return note
      ? [
          {
            browser,
            text: explainLost(browser.name, note.reason),
            detail: note.detail,
          },
        ]
      : [];
  });
  const enlargedWindow = windows.find((w) => w.key === enlarged) ?? null;
  const enlargedBrowser = installed.find(
    (browser) => browser.id === enlargedWindow?.browser,
  );

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

  /** The address in the field as a full URL, or null after saying why not. */
  function readAddress(): string | null {
    const target = normalizeUrl(url);
    if (!target) {
      setFormError(
        "That doesn't look like a web address. Try something like example.com.",
      );
      return null;
    }
    setUrl(target);
    setRecent((current) =>
      [target, ...current.filter((item) => item !== target)].slice(
        0,
        RECENT_MAX,
      ),
    );
    return target;
  }

  /** Runs one thing at a time and shows how it went. */
  async function run(work: () => Promise<Notice | null>) {
    setFormError(null);
    setNotice(null);
    setBusy("working");
    try {
      setNotice(await work());
    } catch (error) {
      setFormError(toMessage(error));
    } finally {
      setBusy(null);
      setListTurn((turn) => turn + 1);
    }
  }

  async function openAll() {
    const target = readAddress();
    if (!target) return;

    const ids = chosen.map((browser) => browser.id);
    setFormError(null);
    setNotice(null);
    setBusy("opening");
    setLaunch(Object.fromEntries(ids.map((id) => [id, { status: "opening" }])));

    const request: OpenRequest = {
      url: target,
      browsers: ids,
      includePrivate: incognito,
    };
    try {
      const { results } = await postJson<OpenResponse>("/api/open", request);
      setLaunch(
        Object.fromEntries(
          results.map((result): [string, LaunchState] => [
            result.id,
            { status: "done", result },
          ]),
        ),
      );
      // Browsers that opened but can't be followed get a line saying so.
      setLost((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result.untracked) {
            next[result.id] = {
              reason: result.untracked,
              detail: result.untrackedDetail,
            };
          } else {
            delete next[result.id];
          }
        }
        return next;
      });
      setNotice(summarizeOpen(results));
    } catch (error) {
      setLaunch({});
      setFormError(toMessage(error));
    } finally {
      setBusy(null);
      setListTurn((turn) => turn + 1);
    }
  }

  async function closeAll() {
    if (ticked.length === 0) return;
    const request: CloseRequest = { browsers: ticked, quitStarted };

    setFormError(null);
    setNotice(null);
    setBusy("closing");
    setLaunch((current) => ({
      ...current,
      ...Object.fromEntries(
        ticked.map((id): [string, LaunchState] => [id, { status: "closing" }]),
      ),
    }));

    try {
      const { results } = await postJson<CloseResponse>("/api/close", request);
      setLaunch((current) => ({
        ...current,
        ...Object.fromEntries(
          results.map((result): [string, LaunchState] => [
            result.id,
            { status: "closed", result },
          ]),
        ),
      }));
      // Drop them from the list at once; the server confirms on the next look.
      const closedIn = new Set(
        results.filter((result) => !result.error).map((result) => result.id),
      );
      setWindows((current) => current.filter((w) => !closedIn.has(w.browser)));
      setLost((current) => without(current, (id) => ticked.includes(id)));
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
      setBusy(null);
      setListTurn((turn) => turn + 1);
    }
  }

  // --- things done to the open windows of the ticked browsers ---

  function goTo() {
    const target = readAddress();
    if (!target) return;
    const request: NavigateRequest = { browsers: ticked, url: target };
    void run(async () => {
      const { results } = await postJson<ActionResponse>("/api/navigate", request);
      return summarizeAction(
        (count) => `Sent ${plural(count, "window")} to ${target}.`,
        results,
      );
    });
  }

  function reload(selection: WindowSelection) {
    void run(async () => {
      const { results } = await postJson<ActionResponse>("/api/reload", selection);
      return summarizeAction(
        (count) => `Reloaded ${plural(count, "window")}.`,
        results,
      );
    });
  }

  function arrangeAll(layout: Layout) {
    const request: ArrangeRequest = { browsers: ticked, layout };
    void run(async () => {
      const { results } = await postJson<ActionResponse>("/api/arrange", request);
      return summarizeAction(
        (count) => `Arranged ${plural(count, "window")}.`,
        results,
      );
    });
  }

  function savePictures() {
    const selection: WindowSelection = { browsers: ticked };
    void run(async () => {
      const result = await postJson<SnapshotsResponse>("/api/snapshots", selection);
      if (result.error) throw new Error(result.error);
      if (!result.folder) {
        return { text: "There were no windows to take pictures of.", allGood: false };
      }
      const missed =
        result.missed.length > 0
          ? ` No picture could be taken of ${result.missed.join(", ")}.`
          : "";
      return {
        text: `Saved ${plural(result.saved, "picture")} to ${result.folder.replace(/^\/Users\/[^/]+/, "~")}.${missed}`,
        allGood: result.missed.length === 0,
      };
    });
  }

  // --- things done to one window ---

  async function showWindow(target: OpenWindow) {
    const request: FocusRequest = { key: target.key };
    setFormError(null);
    try {
      const { gone } = await postJson<FocusResponse>("/api/focus", request);
      if (!gone) return;
      setWindows((current) => current.filter((w) => w.key !== target.key));
      setNotice({ text: "That window had already been closed.", allGood: false });
    } catch (error) {
      setFormError(toMessage(error));
    }
  }

  function closeWindow(target: OpenWindow) {
    const request: CloseRequest = { keys: [target.key], quitStarted };
    setEnlarged((current) => (current === target.key ? null : current));
    void run(async () => {
      const { results } = await postJson<CloseResponse>("/api/close", request);
      if (!results.some((result) => result.error)) {
        setWindows((current) => current.filter((w) => w.key !== target.key));
      }
      return summarizeClose(results);
    });
  }

  const windowActions: WindowActions = {
    onShow: (target) => void showWindow(target),
    onEnlarge: (target) => setEnlarged(target.key),
    onReload: (target) => reload({ keys: [target.key] }),
    onClose: closeWindow,
  };

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
            list="recent-addresses"
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
            className="h-11 min-w-0 rounded-lg border border-zinc-300 bg-white px-3 font-mono text-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/25 sm:flex-1 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
          />
          {/* Addresses used lately, offered as you type. */}
          <datalist id="recent-addresses">
            {recent.map((address) => (
              <option key={address} value={address} />
            ))}
          </datalist>
          <button
            type="submit"
            disabled={busy !== null || chosen.length === 0}
            className="h-11 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white outline-none transition hover:bg-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            {busy === "opening"
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
            disabled={busy !== null || tickedCount === 0}
            title="Closes the windows the launcher opened in the ticked browsers"
            className="h-11 shrink-0 rounded-lg border border-zinc-300 bg-white px-5 text-sm font-medium outline-none transition hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600 dark:disabled:hover:bg-zinc-900"
          >
            {busy === "closing"
              ? "Closing…"
              : tickedCount === 0
                ? "Close windows"
                : `Close ${plural(tickedCount, "window")}`}
          </button>
        </div>

        <div className="mt-1 flex flex-wrap gap-x-8 gap-y-2">
          <Switch checked={incognito} onChange={setIncognito}>
            <span className="font-medium">Also open in incognito</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}
              — a second, private window in each browser
            </span>
          </Switch>
          <Switch checked={quitStarted} onChange={setQuitStarted}>
            <span className="font-medium">Quit what I started</span>
            <span className="text-zinc-500 dark:text-zinc-400">
              {" "}
              — on Close, quit browsers that weren&apos;t open before
            </span>
          </Switch>
        </div>

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
          ) : busy === "working" ? (
            <span className="text-zinc-500 dark:text-zinc-400">Working…</span>
          ) : null}
        </p>
      </form>

      <OpenWindows
        browsers={installed}
        windows={windows}
        lost={lostBrowsers}
        mayCapture={mayCapture}
        tickedCount={tickedCount}
        busy={busy !== null}
        actions={windowActions}
        onGoTo={goTo}
        onReloadAll={() => reload({ browsers: ticked })}
        onArrange={arrangeAll}
        onSavePictures={savePictures}
        onDismissLost={(id) =>
          setLost((current) => without(current, (key) => key === id))
        }
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

        {installed.length > 1 ? (
          <BrowserGroups
            installed={installed}
            selected={selected}
            groups={groups}
            onPick={(ids) => setSelected(new Set(ids))}
            onSave={(name) =>
              setGroups((current) => [
                ...current.filter((group) => group.name !== name),
                { name, ids: [...selected] },
              ])
            }
            onDelete={(name) =>
              setGroups((current) =>
                current.filter((group) => group.name !== name),
              )
            }
          />
        ) : null}

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
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {installed.map((browser) => (
              <li key={browser.id}>
                <BrowserCard
                  browser={browser}
                  checked={selected.has(browser.id)}
                  state={launch[browser.id]}
                  normalOnly={incognito && !browser.supportsPrivate}
                  openCount={openIn(browser.id)}
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

      {data?.supported ? <SetupCheck /> : null}

      {enlargedWindow && enlargedBrowser ? (
        <PictureDialog
          key={enlargedWindow.key}
          browser={enlargedBrowser}
          target={enlargedWindow}
          live={mayCapture !== false}
          onDismiss={() => setEnlarged(null)}
          onShow={() => void showWindow(enlargedWindow)}
          onReload={() => reload({ keys: [enlargedWindow.key] })}
          onClose={() => closeWindow(enlargedWindow)}
        />
      ) : null}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-3 select-none">
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-10 shrink-0 rounded-full bg-zinc-300 transition peer-checked:bg-blue-600 peer-focus-visible:ring-3 peer-focus-visible:ring-blue-500/40 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4 dark:bg-zinc-700"
      />
      <span className="text-sm">{children}</span>
    </label>
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
