"use client";

import { useEffect, useRef } from "react";
import { LivePicture } from "@/components/live-picture";
import type { BrowserInfo, OpenWindow } from "@/lib/types";
import { shortAddress } from "@/lib/window-rows";

/**
 * One window, large, without leaving the launcher. Closes on Escape or a
 * click outside, as dialogs do.
 */
export function PictureDialog({
  browser,
  target,
  live,
  onDismiss,
  onShow,
  onReload,
  onClose,
}: {
  browser: BrowserInfo;
  target: OpenWindow;
  /** Whether pictures can be taken at all. */
  live: boolean;
  onDismiss: () => void;
  onShow: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    // Nothing to undo: closing it here would fire its close event, which
    // dismisses the dialog for good. It goes away with the element.
    if (element && !element.open) element.showModal();
  }, []);

  const address = shortAddress(target.url || target.openedUrl);
  const title = target.title?.trim() || address;
  const kind = target.private ? "incognito" : "normal";
  const button =
    "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium outline-none transition hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-blue-500/40 dark:border-zinc-700 dark:hover:bg-zinc-800";

  return (
    <dialog
      ref={dialog}
      onClose={onDismiss}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) onDismiss();
      }}
      aria-label={`${browser.name}, ${kind} window`}
      className="m-auto w-[min(96vw,80rem)] rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {browser.name} · {kind}
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                {title}
              </span>
            </p>
            <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
              {address}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={onShow}>
              Bring to front
            </button>
            <button type="button" className={button} onClick={onReload}>
              Reload
            </button>
            <button type="button" className={button} onClick={onClose}>
              Close window
            </button>
            <button
              type="button"
              className={`${button} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`}
              onClick={onDismiss}
            >
              Done
            </button>
          </div>
        </div>
        {live && target.hasPreview ? (
          <LivePicture
            windowKey={target.key}
            every={1000}
            label={`${browser.name}, ${kind} window`}
            fit="contain"
            className="aspect-[16/10] w-full rounded-lg"
          />
        ) : (
          <p className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            There is no live picture of this window.
          </p>
        )}
      </div>
    </dialog>
  );
}
