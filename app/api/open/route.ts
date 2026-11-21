import { badRequest, readOwnJson } from "@/lib/api-request";
import { isSupportedPlatform, openInBrowsers } from "@/lib/browsers";
import type { OpenResponse } from "@/lib/types";
import { normalizeUrl } from "@/lib/url";

const MAX_BROWSERS = 50;

export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const { url: rawUrl, browsers, includePrivate } = body.payload;

  if (typeof rawUrl !== "string") {
    return badRequest("Missing the URL to open.");
  }
  if (
    !Array.isArray(browsers) ||
    browsers.length === 0 ||
    browsers.length > MAX_BROWSERS ||
    !browsers.every((id): id is string => typeof id === "string")
  ) {
    return badRequest("Pick at least one browser.");
  }

  const url = normalizeUrl(rawUrl);
  if (!url) {
    return badRequest(
      "That doesn't look like a web address. Try something like example.com.",
    );
  }

  if (!isSupportedPlatform) {
    return badRequest("Opening browsers is only supported on macOS for now.", 501);
  }

  const openedAt = Date.now();
  const results = await openInBrowsers(url, browsers, {
    includePrivate: includePrivate === true,
  });
  const response: OpenResponse = { url, openedAt, results };
  return Response.json(response);
}
