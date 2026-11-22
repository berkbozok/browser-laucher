"use client";

import { useState } from "react";
import { postJson, toMessage } from "@/lib/client";
import type { SetupResponse } from "@/lib/types";

type Line = {
  label: string;
  /** true: fine. false: needs attention. null: can't tell. */
  state: boolean | null;
  note: string;
};

function linesFor(setup: SetupResponse): Line[] {
  const lines: Line[] = [
    {
      label: "Screen Recording",
      state: setup.screenRecording,
      note: setup.screenRecording
        ? "Live pictures and saved pictures work."
        : "Needed for live pictures and saved pictures. System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen the app that runs the launcher.",
    },
    {
      label: "Accessibility",
      state: setup.accessibility,
      note: setup.accessibility
        ? "Safari and Orion can open incognito windows."
        : "Needed for incognito windows in Safari and Orion. System Settings → Privacy & Security → Accessibility.",
    },
  ];
  for (const browser of setup.browsers) {
    const allowed = browser.control === "allowed";
    lines.push({
      label: `Control of ${browser.name}`,
      state: allowed ? true : browser.control === "refused" ? false : null,
      note: allowed
        ? "Its windows can be shown, arranged, reloaded and closed."
        : browser.control === "refused"
          ? "macOS hasn't allowed it, or is still waiting for your answer. System Settings → Privacy & Security → Automation."
          : browser.control === "not-running"
            ? "Can only be checked while the browser is open."
            : browser.control === "no-windows"
              ? "Can only be checked while it has a window open."
              : "Couldn't be checked.",
    });
  }
  return lines;
}

/**
 * Which macOS permissions the launcher has. Checked only on request,
 * because asking about a browser for the first time makes macOS put the
 * question to the person.
 */
export function SetupCheck() {
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    setError(null);
    try {
      setSetup(await postJson<SetupResponse>("/api/setup", {}));
    } catch (problem) {
      setError(toMessage(problem));
    } finally {
      setChecking(false);
    }
  }

  return (
    <details className="rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
      <summary className="cursor-pointer font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-blue-500/40">
        Setup check
        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
          which macOS permissions the launcher has
        </span>
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void check()}
            disabled={checking}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 font-medium outline-none transition hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-blue-500/40 disabled:text-zinc-400 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {checking ? "Checking…" : setup ? "Check again" : "Check now"}
          </button>
          <span className="text-zinc-500 dark:text-zinc-400">
            macOS may ask you about a browser the first time.
          </span>
        </div>

        {error ? (
          <p role="alert" className="text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {setup ? (
          <ul className="flex flex-col gap-1.5">
            {linesFor(setup).map((line) => (
              <li key={line.label} className="flex gap-2.5">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-bold text-white ${
                    line.state === true
                      ? "bg-emerald-600"
                      : line.state === false
                        ? "bg-amber-600"
                        : "bg-zinc-400 dark:bg-zinc-600"
                  }`}
                >
                  {line.state === true ? "✓" : line.state === false ? "!" : "?"}
                </span>
                <span>
                  <span className="font-medium">{line.label}</span>
                  <span className="sr-only">
                    {line.state === true
                      ? ": fine."
                      : line.state === false
                        ? ": needs attention."
                        : ": unknown."}
                  </span>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {line.note}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}
