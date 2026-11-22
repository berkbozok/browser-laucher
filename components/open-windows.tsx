"use client";

import { BrowserIcon } from "@/components/browser-icon";
import { LivePicture } from "@/components/live-picture";
import type { Layout } from "@/lib/layout";
import type {
  BrowserInfo,
  CompareResponse,
  OpenWindow,
  WindowComparison,
} from "@/lib/types";
import { SAME_WIDTH_WITHIN } from "@/lib/compare";
import { rowsFor, shortAddress } from "@/lib/window-rows";
import { plural } from "@/lib/words";

/** A browser that was opened but whose windows the launcher can't follow. */
export type LostBrowser = {
  browser: BrowserInfo;
  /** What to tell the person. */
  text: string;
  /** The technical reason, when there is one. */
  detail?: string;
};

/** Things that can be done to a single window from its box. */
export type WindowActions = {
  onShow: (target: OpenWindow) => void;
  onEnlarge: (target: OpenWindow) => void;
  onReload: (target: OpenWindow) => void;
  onClose: (target: OpenWindow) => void;
};

/** The sizes offered next to "fill the screen". Heights are cut to fit. */
const SIZES: { label: string; layout: Layout }[] = [
  { label: "Narrow · 500 wide", layout: { width: 500, height: 900 } },
  { label: "Tablet · 820 wide", layout: { width: 820, height: 1100 } },
  { label: "Laptop · 1280 wide", layout: { width: 1280, height: 800 } },
  { label: "Desktop · 1440 wide", layout: { width: 1440, height: 900 } },
];

const timeOfDay = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const COLUMNS = "sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(0,1fr)]";

const toolButton =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium outline-none transition hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent dark:border-zinc-700 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600";

export function OpenWindows({
  browsers,
  windows,
  lost,
  mayCapture,
  tickedCount,
  busy,
  actions,
  onGoTo,
  onReloadAll,
  onArrange,
  onSavePictures,
  comparison,
  onCompare,
  onMatchWidths,
  onClearComparison,
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
  /** How many of the windows are in browsers that are ticked right now. */
  tickedCount: number;
  /** True while something is in progress, so the buttons wait. */
  busy: boolean;
  actions: WindowActions;
  onGoTo: () => void;
  onReloadAll: () => void;
  onArrange: (layout: Layout) => void;
  onSavePictures: () => void;
  /** The last comparison, while its reference window is still open. */
  comparison: CompareResponse | null;
  /** Compares the windows in ticked browsers with this window. */
  onCompare: (referenceKey: string) => void;
  onMatchWidths: () => void;
  onClearComparison: () => void;
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

  // Every window, named the way the list shows it, to pick a reference from.
  const names = new Map<string, string>();
  for (const { browser, row, showTime } of lines) {
    const when = showTime ? `, ${timeOfDay.format(row.launch)}` : "";
    if (row.normal)
      names.set(row.normal.key, `${browser.name} · normal${when}`);
    if (row.incognito) {
      names.set(row.incognito.key, `${browser.name} · incognito${when}`);
    }
  }
  const results = new Map(
    (comparison?.results ?? []).map((result) => [result.key, result]),
  );
  const refreshEvery = Math.min(6000, Math.max(1500, pictures * 250));
  const idle = busy || tickedCount === 0;

  return (
    <section aria-labelledby="windows-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 id="windows-heading" className="text-sm font-medium">
          Open windows
          <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
            {windows.length} · live · click one to bring it to the front
          </span>
        </h2>

        {windows.length > 0 ? (
          <div
            role="group"
            aria-label="Actions for the windows in ticked browsers"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {tickedCount === 0
                ? "Tick a browser to act on its windows"
                : `${plural(tickedCount, "window")} in ticked browsers:`}
            </span>
            <button
              type="button"
              className={toolButton}
              disabled={idle}
              onClick={onGoTo}
              title="Send these windows to the address in the URL field"
            >
              Go to address
            </button>
            <button
              type="button"
              className={toolButton}
              disabled={idle}
              onClick={onReloadAll}
            >
              Reload
            </button>
            <select
              aria-label="Arrange these windows"
              className={`${toolButton} bg-transparent`}
              disabled={idle}
              value=""
              onChange={(event) => {
                const choice = event.target.value;
                if (choice === "tile") onArrange("tile");
                else if (choice !== "") onArrange(SIZES[Number(choice)].layout);
              }}
            >
              <option value="">Arrange…</option>
              <option value="tile">Tile to fill the screen</option>
              {SIZES.map((size, index) => (
                <option key={size.label} value={index}>
                  {size.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={toolButton}
              disabled={idle}
              onClick={onSavePictures}
              title="Save a picture of each of these windows into a folder"
            >
              Save pictures
            </button>
            <select
              aria-label="Compare these windows with one window"
              title="Mark where each window looks different from the one you pick"
              className={`${toolButton} bg-transparent`}
              disabled={idle || mayCapture === false || windows.length < 2}
              value=""
              onChange={(event) => {
                if (event.target.value !== "") onCompare(event.target.value);
              }}
            >
              <option value="">Compare with…</option>
              {[...names].map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {comparison ? (
        <ComparisonSummary
          comparison={comparison}
          referenceName={names.get(comparison.reference) ?? "the reference"}
          busy={busy}
          onAgain={() => onCompare(comparison.reference)}
          onMatchWidths={onMatchWidths}
          onClear={onClearComparison}
        />
      ) : null}

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
          Cursor, …). macOS then asks you to quit and reopen that app; start the
          launcher again afterwards. Until then each box shows the page&apos;s
          title and address instead.
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
              actions={actions}
              isReference={row.normal?.key === comparison?.reference}
              compared={row.normal ? results.get(row.normal.key) : undefined}
            />
            <WindowBox
              kind="Incognito"
              browser={browser}
              target={row.incognito}
              live={mayCapture !== false}
              refreshEvery={refreshEvery}
              actions={actions}
              isReference={row.incognito?.key === comparison?.reference}
              compared={
                row.incognito ? results.get(row.incognito.key) : undefined
              }
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

/** Whether a window's page is laid out at a different width from the reference's. */
export function widthDiffers(result: WindowComparison): boolean {
  return (
    !("error" in result) &&
    Math.abs(result.pageSize.width - result.referencePageSize.width) >
      SAME_WIDTH_WITHIN
  );
}

function ComparisonSummary({
  comparison,
  referenceName,
  busy,
  onAgain,
  onMatchWidths,
  onClear,
}: {
  comparison: CompareResponse;
  referenceName: string;
  busy: boolean;
  onAgain: () => void;
  onMatchWidths: () => void;
  onClear: () => void;
}) {
  const done = comparison.results.flatMap((result) =>
    "error" in result ? [] : [result],
  );
  const differ = done.filter((result) => result.areas > 0).length;
  const failed = comparison.results.length - done.length;
  const narrower = comparison.results.some(widthDiffers);

  const parts: string[] = [];
  if (done.length - differ > 0) {
    parts.push(
      `${done.length - differ} look${done.length - differ === 1 ? "s" : ""} the same`,
    );
  }
  if (differ > 0)
    parts.push(`${differ} look${differ === 1 ? "s" : ""} different`);
  if (failed > 0) parts.push(`${failed} couldn't be compared`);
  const text =
    comparison.results.length === 0
      ? "There were no other windows in ticked browsers to compare."
      : `${parts.join(", ")}. Differences are marked in red.`;

  const link =
    "rounded text-blue-600 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-default disabled:text-zinc-400 disabled:no-underline dark:text-blue-400 dark:disabled:text-zinc-600";

  return (
    <div
      role="status"
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          Compared with {referenceName} at{" "}
          {timeOfDay.format(comparison.comparedAt)}:
        </span>{" "}
        {text}
        {narrower ? (
          <span className="text-amber-700 dark:text-amber-400">
            {" "}
            Some pages are narrower or wider than the reference&apos;s, so their
            text wraps differently.
          </span>
        ) : null}
      </span>
      <span className="flex gap-4">
        {narrower ? (
          <button
            type="button"
            className={link}
            disabled={busy}
            onClick={onMatchWidths}
          >
            Match page widths
          </button>
        ) : null}
        <button
          type="button"
          className={link}
          disabled={busy}
          onClick={onAgain}
        >
          Compare again
        </button>
        <button type="button" className={link} onClick={onClear}>
          Clear marks
        </button>
      </span>
    </div>
  );
}

/** The small label on a window saying how it compares. */
function ComparisonBadge({
  isReference,
  compared,
}: {
  isReference: boolean;
  compared: WindowComparison | undefined;
}) {
  const badge =
    "shrink-0 rounded px-1.5 py-px text-[0.625rem] font-semibold tracking-wide uppercase";
  if (isReference) {
    return (
      <span
        className={`${badge} bg-blue-600 text-white`}
        title="The other windows are compared with this one"
      >
        Reference
      </span>
    );
  }
  if (!compared) return null;
  if ("error" in compared) {
    return (
      <span
        className={`${badge} bg-amber-400 text-amber-950`}
        title={compared.error}
      >
        Not compared
      </span>
    );
  }

  const percent = Math.max(1, Math.round(compared.share * 100));
  const width = widthDiffers(compared)
    ? ` Its page is ${compared.pageSize.width} points wide, the reference's ${compared.referencePageSize.width}, so text may wrap differently.`
    : "";
  if (compared.areas === 0) {
    return (
      <span
        className={`${badge} bg-emerald-600 text-white`}
        title={`Looks the same as the reference.${width}`}
      >
        Same
      </span>
    );
  }
  return (
    <span
      className={`${badge} bg-red-600 text-white`}
      title={`About ${percent}% of the page looks different from the reference.${width}`}
    >
      {plural(compared.areas, "difference")}
    </span>
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
  actions,
  isReference,
  compared,
}: {
  kind: "Normal" | "Incognito";
  browser: BrowserInfo;
  target: OpenWindow | null;
  /** Whether to ask for pictures at all. */
  live: boolean;
  refreshEvery: number;
  actions: WindowActions;
  /** True for the window the others were compared with. */
  isReference: boolean;
  /** How this window compared, from the last comparison. */
  compared: WindowComparison | undefined;
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
  const what = `${browser.name}'s ${kind.toLowerCase()} window`;

  return (
    <div
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border transition focus-within:ring-3 focus-within:ring-blue-500/30 ${
        incognito
          ? "border-zinc-800 bg-zinc-900 text-zinc-100 hover:border-zinc-500 dark:border-zinc-700 dark:bg-black dark:hover:border-zinc-400"
          : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:border-zinc-400"
      }`}
    >
      {/* The whole box brings the window forward... */}
      <button
        type="button"
        onClick={() => actions.onShow(target)}
        title={`Show ${what}`}
        className="flex min-w-0 flex-col text-left outline-none"
      >
        {live && target.hasPreview ? (
          <LivePicture
            windowKey={target.key}
            every={refreshEvery}
            label={what}
            marks={
              compared && !("error" in compared)
                ? { aspect: compared.aspect, boxes: compared.marks }
                : null
            }
            className="aspect-[16/10] w-full border-b border-inherit"
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
            <ComparisonBadge isReference={isReference} compared={compared} />
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

      {/* ...and these sit on top of it for the rest. */}
      <span className="absolute top-1.5 right-1.5 flex gap-1 opacity-100 transition sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        <IconButton
          label={`Enlarge ${what}`}
          onClick={() => actions.onEnlarge(target)}
        >
          <path d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3" />
        </IconButton>
        <IconButton
          label={`Reload ${what}`}
          onClick={() => actions.onReload(target)}
        >
          <path d="M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5" />
        </IconButton>
        <IconButton
          label={`Close ${what}`}
          onClick={() => actions.onClose(target)}
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </IconButton>
      </span>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md bg-black/65 text-white outline-none backdrop-blur-sm transition hover:bg-black/85 focus-visible:ring-3 focus-visible:ring-blue-400/70"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-3.5"
      >
        {children}
      </svg>
    </button>
  );
}
