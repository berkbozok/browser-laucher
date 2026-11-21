"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * The installed app's own icon, served by the launcher, with the browser's
 * initial as a stand-in if it can't be loaded.
 */
export function BrowserIcon({
  id,
  name,
  size = 36,
}: {
  id: string;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };

  if (failed) {
    return (
      <span
        aria-hidden="true"
        style={box}
        className="flex shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      >
        {name.charAt(0)}
      </span>
    );
  }

  return (
    <Image
      src={`/api/browsers/${id}/icon`}
      alt=""
      width={size}
      height={size}
      unoptimized
      style={box}
      className="shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
