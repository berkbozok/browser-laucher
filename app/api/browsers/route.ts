import {
  detectBrowsers,
  hasAccessibility,
  isSupportedPlatform,
} from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { BrowsersResponse } from "@/lib/types";

export async function GET(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  const [detected, accessibility] = await Promise.all([
    detectBrowsers(),
    hasAccessibility(),
  ]);
  const body: BrowsersResponse = {
    supported: isSupportedPlatform,
    accessibility,
    browsers: detected.map((browser) => ({
      id: browser.id,
      name: browser.name,
      engine: browser.engine,
      installed: browser.appPath !== null,
      supportsPrivate: browser.supportsPrivate,
      // Pressing another app's menu is what macOS guards with Accessibility.
      needsAccessibility: browser.privateViaMenu,
    })),
  };
  return Response.json(body);
}
