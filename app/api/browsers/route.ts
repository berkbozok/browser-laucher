import { detectBrowsers, isSupportedPlatform } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { BrowsersResponse } from "@/lib/types";

export async function GET(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  const detected = await detectBrowsers();
  const body: BrowsersResponse = {
    supported: isSupportedPlatform,
    browsers: detected.map(({ id, name, appPath, supportsPrivate }) => ({
      id,
      name,
      installed: appPath !== null,
      supportsPrivate,
    })),
  };
  return Response.json(body);
}
