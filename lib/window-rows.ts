import type { OpenWindow } from "./types";

/** One line of the list: the pair of windows a browser got from one launch. */
export type WindowRow = {
  key: string;
  launch: number;
  normal: OpenWindow | null;
  incognito: OpenWindow | null;
};

/**
 * Pairs each normal window with the incognito window opened by the same
 * press of Open, newest launch first. `windows` are one browser's.
 */
export function rowsFor(browser: string, windows: OpenWindow[]): WindowRow[] {
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
export function shortAddress(url: string): string {
  try {
    const { host, pathname, search } = new URL(url);
    const path = pathname === "/" ? "" : pathname;
    return `${host}${path}${search}`;
  } catch {
    return url;
  }
}
