"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BrowserIcon } from "@/components/browser-icon";
import type { BrowserInfo, OpenWindow } from "@/lib/types";

/** A browser that was opened but whose windows the launcher can't follow. */
export type LostBrowser = {
  browser: BrowserInfo;
  /** What to tell the person. */
  text: string;
  /** The technical reason, when there is one. */
  detail?: string;
};

/** One line of the list: a browser and the pair of windows from one launch. */
type Row = {
  key: string;
  launch: number;
  normal: OpenWindow | null;
  incognito: OpenWindow | null;
};

/**
 * Pairs each normal window with the incognito window opened by the same
 * press of Open, newest launch first.
 */
function rowsFor(browser: string, windows: OpenWindow[]): Row[] {
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

const COLUMNS = "sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)]";

export function OpenWindows({
  browsers,
  windows,
  lost,
  mayCapture,
  onShow,
  onDismissLost,
}: {
  /** Installed browsers, in the order they are listed on the page. */
  browsers: BrowserInfo[];
  /** The launcher's open windows, as the server last reported them. */
  windows: OpenWindow[];
  /** Browsers that were opened but can't be followed. */
  lost: LostBrowser[];
  /** Whether macOS lets the launcher take pictures of windows. */
  mayCapture: boolean | null;
  onShow: (target: OpenWindow) => void;
  onDismissLost: (browserId: string) => void;
}) {
  const lines = browsers.flatMap((browser) =>
    rowsFor(
      browser.id,
      windows.filter((w) => w.browser === browser.id),
    ).map((row, _index, all) => ({
      browser,
      row,
      // Tell lines of the same browser apart by when they were opened.
      showTime: all.length > 1,
    })),
  );
  if (lines.length === 0 && lost.length === 0) return null;

  // The more windows there are, the longer each waits for its next picture,
  // so the total work stays about the same.
  const pictures = windows.filter((w) => w.hasPreview).length;
  const refreshEvery = Math.min(6000, Math.max(1500, pictures * 250));

  return (
    <section aria-labelledby="windows-heading" className="flex flex-col gap-3">
      <h2 id="windows-heading" className="text-sm font-medium">
        Open windows
        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
          {windows.length} · live · click one to bring it to the front
        </span>
      </h2>

      {mayCapture === false && windows.length > 0 ? (
        <p
          role="note"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <strong className="font-semibold">
            Live pictures need one more permission.
          </strong>{" "}
          In System Settings → Privacy &amp; Security → Screen &amp; System
          Audio Recording, turn on the app that runs this launcher (Terminal,
          Cursor, …). macOS then asks you to quit and reopen that app; start
          the launcher again afterwards. Until then each box shows the
          page&apos;s title and address instead.
        </p>
      ) : null}

      {lines.length > 0 ? (
        <div
          aria-hidden="true"
          className={`hidden gap-3 px-1 text-xs font-medium tracking-wide text-zinc-500 uppercase sm:grid dark:text-zinc-400 ${COLUMNS}`}
        >
          <span>Browser</span>
          <span>Normal</span>
          <span>Incognito</span>
        </div>
      ) : null}

      <ul className="flex flex-col gap-3">
        {lines.map(({ browser, row, showTime }) => (
          <li key={row.key} className={`grid grid-cols-2 gap-3 ${COLUMNS}`}>
            <BrowserLabel
              browser={browser}
              note={showTime ? `opened ${timeOfDay.format(row.launch)}` : null}
            />
            <WindowBox
              kind="Normal"
              browser={browser}
              target={row.normal}
              live={mayCapture !== false}
              refreshEvery={refreshEvery}
              onShow={onShow}
            />
            <WindowBox
              kind="Incognito"
              browser={browser}
              target={row.incognito}
              live={mayCapture !== false}
              refreshEvery={refreshEvery}
              onShow={onShow}
            />
          </li>
        ))}

        {lost.map(({ browser, text, detail }) => (
          <li
            key={`lost/${browser.id}`}
            className={`grid grid-cols-2 gap-3 ${COLUMNS}`}
          >
            <BrowserLabel browser={browser} note={null} />
            <div
              title={detail}
              className="col-span-2 flex items-center gap-3 rounded-xl border border-dashed border-amber-400/70 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:text-amber-200"
            >
              <span className="min-w-0 flex-1">{text}</span>
              <button
                type="button"
                onClick={() => onDismissLost(browser.id)}
                aria-label={`Dismiss the note about ${browser.name}`}
                className="shrink-0 rounded px-1.5 text-base leading-none opacity-60 outline-none hover:opacity-100 focus-visible:ring-3 focus-visible:ring-blue-500/40"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BrowserLabel({
  browser,
  note,
}: {
  browser: BrowserInfo;
  note: string | null;
}) {
  return (
    <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1 sm:items-start sm:pt-1">
      <BrowserIcon id={browser.id} name={browser.name} size={28} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{browser.name}</span>
        {note ? (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {note}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function WindowBox({
  kind,
  browser,
  target,
  live,
  refreshEvery,
  onShow,
}: {
  kind: "Normal" | "Incognito";
  browser: BrowserInfo;
  target: OpenWindow | null;
  /** Whether to ask for pictures at all. */
  live: boolean;
  refreshEvery: number;
  onShow: (target: OpenWindow) => void;
}) {
  if (!target) {
    return (
      <div className="flex min-h-16 items-center justify-center rounded-xl border border-dashed border-zinc-300 px-3 text-xs text-zinc-400 dark:border-zinc-700 dark:text-zinc-600">
        <span className="sm:hidden">{kind}:&nbsp;</span>
        not open
      </div>
    );
  }

  const address = shortAddress(target.url || target.openedUrl);
  // Until the browser has told us, the address is the best name there is.
  const title = target.title?.trim() || address || "Untitled";
  const incognito = kind === "Incognito";

  return (
    <button
      type="button"
      onClick={() => onShow(target)}
      title={`Show ${browser.name}'s ${kind.toLowerCase()} window`}
      className={`group flex min-w-0 flex-col overflow-hidden rounded-xl border text-left outline-none transition focus-visible:ring-3 focus-visible:ring-blue-500/40 ${
        incognito
          ? "border-zinc-800 bg-zinc-900 text-zinc-100 hover:border-zinc-500 dark:border-zinc-700 dark:bg-black dark:hover:border-zinc-400"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-400"
      }`}
    >
      {live && target.hasPreview ? (
        <LivePicture
          windowKey={target.key}
          every={refreshEvery}
          label={`${browser.name}, ${kind.toLowerCase()} window`}
        />
      ) : null}
      <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
        <span className="flex items-center gap-2">
          <span
            className={`shrink-0 rounded px-1.5 py-px text-[0.625rem] font-semibold tracking-wide uppercase sm:hidden ${
              incognito
                ? "bg-zinc-700 text-zinc-200"
                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
            }`}
          >
            {kind}
          </span>
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
      </span>
    </button>
  );
}

/**
 * A picture of one window that keeps itself up to date. Each new picture is
 * fetched in full before it replaces the old one, so the box never blinks.
 */
function LivePicture({
  windowKey,
  every,
  label,
}: {
  windowKey: string;
  every: number;
  label: string;
}) {
  const [picture, setPicture] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let current: string | null = null;

    const refresh = async () => {
      // Nobody is looking at a hidden tab, so don't take pictures for it.
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(
            `/api/preview/${encodeURIComponent(windowKey)}`,
            { cache: "no-store" },
          );
          if (response.ok) {
            const next = URL.createObjectURL(await response.blob());
            if (stopped) {
              URL.revokeObjectURL(next);
              return;
            }
            const previous = current;
            current = next;
            setPicture(next);
            if (previous) URL.revokeObjectURL(previous);
          }
          // Otherwise keep showing the last picture we got: the window may
          // just be minimised.
        } catch {
          // The server didn't answer; the next round will try again.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void refresh(), every);
    };

    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (current) URL.revokeObjectURL(current);
    };
  }, [windowKey, every]);

  return (
    <span className="relative block aspect-[16/10] w-full overflow-hidden border-b border-inherit bg-zinc-100 dark:bg-zinc-950">
      {picture ? (
        <Image
          src={picture}
          alt={label}
          fill
          unoptimized
          sizes="(min-width: 640px) 40vw, 50vw"
          className="object-cover object-top"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">
          Waiting for a picture…
        </span>
      )}
    </span>
  );
}
