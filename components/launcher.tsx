"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type {
  BrowserInfo,
  BrowsersResponse,
  OpenResponse,
} from "@/lib/types";
import { normalizeUrl } from "@/lib/url";

const STORAGE_KEY = "browser-launcher:v1";

type Prefs = { url: string; selected: string[] };

type LaunchState =
  | { status: "opening" }
  | { status: "opened" }
  | { status: "failed"; error: string };

function readPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { url, selected } = parsed as Record<string, unknown>;
    return {
      url: typeof url === "string" ? url : "",
      selected: Array.isArray(selected)
        ? selected.filter((id): id is string => typeof id === "string")
        : [],
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

function plural(count: number): string {
  return `${count} ${count === 1 ? "browser" : "browsers"}`;
}

export function Launcher() {
  const [data, setData] = useState<BrowsersResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanId, setScanId] = useState(0);

  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [launch, setLaunch] = useState<Record<string, LaunchState>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

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
    writePrefs({ url, selected: [...selected] });
  }, [data, url, selected]);

  const installed = data?.browsers.filter((browser) => browser.installed) ?? [];
  const missing = data?.browsers.filter((browser) => !browser.installed) ?? [];
  const chosen = installed.filter((browser) => selected.has(browser.id));

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
    setUrl(target);
    setOpening(true);
    setLaunch(Object.fromEntries(ids.map((id) => [id, { status: "opening" }])));

    try {
      const { results } = await requestJson<OpenResponse>("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, browsers: ids }),
      });
      setLaunch(
        Object.fromEntries(
          results.map((result): [string, LaunchState] => [
            result.id,
            result.ok
              ? { status: "opened" }
              : {
                  status: "failed",
                  error: result.error ?? "Could not open this browser.",
                },
          ]),
        ),
      );
    } catch (error) {
      setLaunch({});
      setFormError(toMessage(error));
    } finally {
      setOpening(false);
    }
  }

  const outcomes = Object.values(launch);
  const openedCount = outcomes.filter((o) => o.status === "opened").length;
  const failedCount = outcomes.filter((o) => o.status === "failed").length;
  const summary =
    opening || outcomes.length === 0
      ? null
      : failedCount === 0
        ? `Opened in ${plural(openedCount)}.`
        : `Opened in ${openedCount} of ${plural(outcomes.length)}. ${failedCount} failed.`;

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
              setLaunch({});
            }}
            aria-invalid={formError ? true : undefined}
            aria-describedby="form-status"
            className="h-11 min-w-0 rounded-lg border sm:flex-1 border-zinc-300 bg-white px-3 font-mono text-sm outline-none transition placeholder:text-zinc-400 focus:border-blue-500 focus:ring-3 focus:ring-blue-500/25 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={opening || chosen.length === 0}
            className="h-11 shrink-0 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white outline-none transition hover:bg-blue-500 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
          >
            {opening
              ? "Opening…"
              : chosen.length === 0
                ? "Select a browser"
                : `Open in ${plural(chosen.length)}`}
          </button>
        </div>
        <p id="form-status" aria-live="polite" className="min-h-5 text-sm">
          {formError ? (
            <span className="text-red-600 dark:text-red-400">{formError}</span>
          ) : summary ? (
            <span
              className={
                failedCount === 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-400"
              }
            >
              {summary}
            </span>
          ) : null}
        </p>
      </form>

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
                  onToggle={() => toggle(browser.id)}
                />
              </li>
            ))}
          </ul>
        )}

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
  onToggle,
}: {
  browser: BrowserInfo;
  checked: boolean;
  state: LaunchState | undefined;
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
      <BrowserIcon browser={browser} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{browser.name}</span>
        <LaunchStatus state={state} />
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

function LaunchStatus({ state }: { state: LaunchState | undefined }) {
  if (!state) return null;
  if (state.status === "opening") {
    return (
      <span className="text-xs text-zinc-500 dark:text-zinc-400">Opening…</span>
    );
  }
  if (state.status === "opened") {
    return (
      <span className="text-xs text-emerald-700 dark:text-emerald-400">
        Opened
      </span>
    );
  }
  return (
    <span
      className="line-clamp-2 text-xs text-red-600 dark:text-red-400"
      title={state.error}
    >
      {state.error}
    </span>
  );
}

function BrowserIcon({ browser }: { browser: BrowserInfo }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      >
        {browser.name.charAt(0)}
      </span>
    );
  }

  return (
    <Image
      src={`/api/browsers/${browser.id}/icon`}
      alt=""
      width={36}
      height={36}
      unoptimized
      className="size-9 shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
