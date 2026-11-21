"use client";

import { BrowserIcon } from "@/components/browser-icon";
import {
  windowKey,
  type TrackedWindow,
  type TrackedWindows,
} from "@/lib/tracked-windows";
import type { BrowserInfo, WindowStatus } from "@/lib/types";

/** One line of the list: a browser and the pair of windows from one launch. */
type Row = {
  key: string;
  launch: number;
  normal: TrackedWindow | null;
  incognito: TrackedWindow | null;
};

/**
 * Pairs each normal window with the incognito window opened by the same
 * press of Open, newest launch first.
 */
function rowsFor(browser: string, windows: TrackedWindow[]): Row[] {
  const launches = [...new Set(windows.map((w) => w.launch))].sort(
    (a, b) => b - a,
  );
  return launches.flatMap((launch) => {
    const mine = windows.filter((w) => w.launch === launch);
    const normal = mine.filter((w) => !w.private);
    const incognito = mine.filter((w) => w.private);
    const count = Math.max(normal.length, incognito.length);
    return Array.from({ length: count }, (_, i) => ({
      key: `${browser}/${launch}/${i}`,
      launch,
      normal: normal[i] ?? null,
      incognito: incognito[i] ?? null,
    }));
  });
}

/** "example.com/path" from a full address: enough to recognise the page. */
function shortAddress(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    const path = pathname === "/" ? "" : pathname;
    return `${host}${path}${search}`;
  } catch {
    return url;
  }
}

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export function OpenWindows({
  browsers,
  tracked,
  live,
  onShow,
}: {
  /** Installed browsers, in the order they are listed on the page. */
  browsers: BrowserInfo[];
  tracked: TrackedWindows;
  /** What each window is showing, by windowKey, as last reported. */
  live: Record<string, WindowStatus>;
  onShow: (browser: BrowserInfo, target: TrackedWindow) => void;
}) {
  const lines = browsers.flatMap((browser) =>
    rowsFor(browser.id, tracked[browser.id] ?? []).map((row, index, all) => ({
      browser,
      row,
      // Tell lines of the same browser apart by when they were opened.
      showTime: all.length > 1 && row.launch > 0,
    })),
  );
  if (lines.length === 0) return null;

  const windowCount = lines.reduce(
    (sum, { row }) => sum + (row.normal ? 1 : 0) + (row.incognito ? 1 : 0),
    0,
  );

  return (
    <section aria-labelledby="windows-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="windows-heading" className="text-sm font-medium">
          Open windows
          <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
            {windowCount} · click one to bring it to the front
          </span>
        </h2>
      </div>

      <div
        aria-hidden="true"
        className="hidden grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-xs font-medium tracking-wide text-zinc-500 uppercase sm:grid dark:text-zinc-400"
      >
        <span>Browser</span>
        <span>Normal</span>
        <span>Incognito</span>
      </div>

      <ul className="flex flex-col gap-2">
        {lines.map(({ browser, row, showTime }) => (
          <li
            key={row.key}
            className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]"
          >
            <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1">
              <BrowserIcon id={browser.id} name={browser.name} size={28} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">
                  {browser.name}
                </span>
                {showTime ? (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    opened {timeOfDay.format(row.launch)}
                  </span>
                ) : null}
              </span>
            </div>
            <WindowBox
              kind="Normal"
              browser={browser}
              target={row.normal}
              live={live}
              onShow={onShow}
            />
            <WindowBox
              kind="Incognito"
              browser={browser}
              target={row.incognito}
              live={live}
              onShow={onShow}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function WindowBox({
  kind,
  browser,
  target,
  live,
  onShow,
}: {
  kind: "Normal" | "Incognito";
  browser: BrowserInfo;
  target: TrackedWindow | null;
  live: Record<string, WindowStatus>;
  onShow: (browser: BrowserInfo, target: TrackedWindow) => void;
}) {
  if (!target) {
    return (
      <div className="flex min-h-16 items-center rounded-xl border border-dashed border-zinc-300 px-3 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-600">
        <span className="sm:hidden">{kind}: </span>
        <span className="ml-1 sm:ml-0">not open</span>
      </div>
    );
  }

  const status = live[windowKey(browser.id, target.handle)];
  const address = shortAddress(status?.url || target.url);
  // Until the browser has told us, the address is the best name there is.
  const title = status?.title?.trim() || address || "Untitled";
  const incognito = kind === "Incognito";

  return (
    <button
      type="button"
      onClick={() => onShow(browser, target)}
      title={`Show ${browser.name}'s ${kind.toLowerCase()} window`}
      className={`group flex min-h-16 min-w-0 flex-col justify-center gap-0.5 rounded-xl border px-3 py-2 text-left outline-none transition focus-visible:ring-3 focus-visible:ring-blue-500/40 ${
        incognito
          ? "border-zinc-800 bg-zinc-900 text-zinc-100 hover:border-zinc-600 dark:border-zinc-700 dark:bg-black dark:hover:border-zinc-500"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-500"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={`text-[0.6875rem] font-medium tracking-wide uppercase sm:sr-only ${
            incognito ? "text-zinc-400" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {kind}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          className="size-3.5 shrink-0 opacity-40 transition group-hover:opacity-100"
        >
          <path
            d="M6 3h7v7M13 3 4 12"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      {address && address !== title ? (
        <span
          className={`truncate font-mono text-xs ${
            incognito ? "text-zinc-400" : "text-zinc-500 dark:text-zinc-400"
          }`}
        >
          {address}
        </span>
      ) : null}
    </button>
  );
}
