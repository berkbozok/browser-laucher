import { isSupportedPlatform, openInBrowsers } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { OpenResponse } from "@/lib/types";
import { normalizeUrl } from "@/lib/url";

const MAX_BROWSERS = 50;

function badRequest(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  // Browsers can't send JSON cross-site without a preflight, so insisting on
  // it closes the "simple request" loophole on top of the origin checks.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return badRequest("Send the request as application/json.", 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("The request body isn't valid JSON.");
  }

  const { url: rawUrl, browsers } = (payload ?? {}) as Record<string, unknown>;

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

  const body: OpenResponse = { url, results: await openInBrowsers(url, browsers) };
  return Response.json(body);
}
