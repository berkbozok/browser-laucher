"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { MarkBox } from "@/lib/types";

/** Places to mark in red on the picture, from a comparison. */
export type PictureMarks = {
  /** Width divided by height of the picture the marks were found on. */
  aspect: number;
  boxes: MarkBox[];
};

/**
 * A picture of one of the launcher's windows that keeps itself up to date.
 * Each new picture is fetched in full before it replaces the old one, so
 * the box never blinks.
 */
export function LivePicture({
  windowKey,
  every,
  label,
  fit = "cover",
  marks = null,
  className = "",
}: {
  windowKey: string;
  /** Milliseconds between pictures. */
  every: number;
  /** Read out in place of the picture. */
  label: string;
  /** "cover" fills the box from the top; "contain" shows the whole window. */
  fit?: "cover" | "contain";
  marks?: PictureMarks | null;
  className?: string;
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
    <span
      className={`relative block overflow-hidden bg-zinc-100 dark:bg-zinc-950 ${className}`}
    >
      {picture ? (
        <Image
          src={picture}
          alt={label}
          fill
          unoptimized
          sizes="(min-width: 640px) 40vw, 50vw"
          className={
            fit === "cover" ? "object-cover object-top" : "object-contain"
          }
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">
          Waiting for a picture…
        </span>
      )}
      {picture && marks && marks.boxes.length > 0 ? (
        // Scaled and placed exactly like the picture under it.
        <svg
          aria-hidden="true"
          viewBox={`0 0 1000 ${1000 / marks.aspect}`}
          preserveAspectRatio={
            fit === "cover" ? "xMidYMin slice" : "xMidYMid meet"
          }
          className="pointer-events-none absolute inset-0 size-full"
        >
          {marks.boxes.map((box, index) => (
            <rect
              key={index}
              x={box.x * 1000}
              y={(box.y * 1000) / marks.aspect}
              width={box.width * 1000}
              height={(box.height * 1000) / marks.aspect}
              className="fill-red-500/45"
            />
          ))}
        </svg>
      ) : null}
    </span>
  );
}
