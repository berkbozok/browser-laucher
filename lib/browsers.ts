import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { OpenResult } from "./types";

const run = promisify(execFile);

type BrowserDefinition = {
  id: string;
  name: string;
  /** App bundle names to look for on macOS. */
  macApps: readonly string[];
};

/** Every browser the launcher knows about. To support another one, add it here. */
const CATALOG: readonly BrowserDefinition[] = [
  { id: "chrome", name: "Google Chrome", macApps: ["Google Chrome.app"] },
  { id: "brave", name: "Brave", macApps: ["Brave Browser.app"] },
  { id: "firefox", name: "Firefox", macApps: ["Firefox.app"] },
  { id: "safari", name: "Safari", macApps: ["Safari.app"] },
  { id: "opera", name: "Opera", macApps: ["Opera.app"] },
  { id: "edge", name: "Microsoft Edge", macApps: ["Microsoft Edge.app"] },
  { id: "arc", name: "Arc", macApps: ["Arc.app"] },
  { id: "vivaldi", name: "Vivaldi", macApps: ["Vivaldi.app"] },
  { id: "opera-gx", name: "Opera GX", macApps: ["Opera GX.app"] },
  { id: "chromium", name: "Chromium", macApps: ["Chromium.app"] },
  { id: "duckduckgo", name: "DuckDuckGo", macApps: ["DuckDuckGo.app"] },
  { id: "zen", name: "Zen", macApps: ["Zen.app", "Zen Browser.app"] },
  { id: "orion", name: "Orion", macApps: ["Orion.app"] },
  { id: "tor", name: "Tor Browser", macApps: ["Tor Browser.app"] },
  {
    id: "firefox-dev",
    name: "Firefox Developer Edition",
    macApps: ["Firefox Developer Edition.app"],
  },
  {
    id: "chrome-canary",
    name: "Chrome Canary",
    macApps: ["Google Chrome Canary.app"],
  },
  {
    id: "safari-tp",
    name: "Safari Technology Preview",
    macApps: ["Safari Technology Preview.app"],
  },
];

export type DetectedBrowser = {
  id: string;
  name: string;
  /** Absolute path of the installed app, or null when it isn't installed. */
  appPath: string | null;
};

/** Detection and launching are macOS-only for now. */
export const isSupportedPlatform = process.platform === "darwin";

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function findApp(names: readonly string[]): Promise<string | null> {
  const folders = ["/Applications", path.join(homedir(), "Applications")];
  for (const folder of folders) {
    for (const name of names) {
      // These are apps on the host, not project files, so keep the bundler's
      // file tracing away from them.
      const candidate = path.join(/* turbopackIgnore: true */ folder, name);
      if (await exists(candidate)) return candidate;
    }
  }
  return null;
}

export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  return Promise.all(
    CATALOG.map(async ({ id, name, macApps }) => ({
      id,
      name,
      appPath: isSupportedPlatform ? await findApp(macApps) : null,
    })),
  );
}

function describeFailure(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const { stderr } = error;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return error instanceof Error ? error.message : "Could not open the browser.";
}

/**
 * Opens `url` in each of the given browsers and reports how each one went.
 * `url` must already be validated (see normalizeUrl) — it is handed straight
 * to the browser.
 */
export async function openInBrowsers(
  url: string,
  ids: readonly string[],
): Promise<OpenResult[]> {
  const detected = new Map((await detectBrowsers()).map((b) => [b.id, b]));

  return Promise.all(
    [...new Set(ids)].map(async (id): Promise<OpenResult> => {
      const browser = detected.get(id);
      if (!browser) {
        return { id, name: id, ok: false, error: "Unknown browser." };
      }
      if (!browser.appPath) {
        return { id, name: browser.name, ok: false, error: "Not installed." };
      }
      try {
        // execFile passes arguments directly, with no shell in between.
        await run("/usr/bin/open", ["-a", browser.appPath, url], {
          timeout: 15_000,
        });
        return { id, name: browser.name, ok: true };
      } catch (error) {
        return {
          id,
          name: browser.name,
          ok: false,
          error: describeFailure(error),
        };
      }
    }),
  );
}

async function renderIcon(appPath: string): Promise<Buffer> {
  const contents = path.join(appPath, "Contents");
  const { stdout } = await run("/usr/bin/plutil", [
    "-extract",
    "CFBundleIconFile",
    "raw",
    "-o",
    "-",
    path.join(contents, "Info.plist"),
  ]);
  const iconName = stdout.trim();
  const icns = path.join(
    contents,
    "Resources",
    iconName.endsWith(".icns") ? iconName : `${iconName}.icns`,
  );

  const workDir = await mkdtemp(path.join(tmpdir(), "browser-launcher-"));
  try {
    const png = path.join(workDir, "icon.png");
    await run("/usr/bin/sips", [
      "-s",
      "format",
      "png",
      "-Z",
      "128",
      icns,
      "--out",
      png,
    ]);
    return await readFile(png);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

const iconCache = new Map<string, Promise<Buffer | null>>();

/** The installed app's own icon as a PNG, or null if it can't be produced. */
export async function getBrowserIcon(id: string): Promise<Buffer | null> {
  const browser = (await detectBrowsers()).find((b) => b.id === id);
  if (!browser?.appPath) return null;

  let icon = iconCache.get(browser.appPath);
  if (!icon) {
    icon = renderIcon(browser.appPath).catch(() => null);
    iconCache.set(browser.appPath, icon);
  }
  return icon;
}
