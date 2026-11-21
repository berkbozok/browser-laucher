import { badRequest, readOwnJson } from "@/lib/api-request";
import { closeInBrowsers, isSupportedPlatform } from "@/lib/browsers";
import type { CloseResponse } from "@/lib/types";

const MAX_BROWSERS = 50;

/** Closes the windows the launcher opened in the named browsers. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const { browsers } = body.payload;
  if (
    !Array.isArray(browsers) ||
    browsers.length === 0 ||
    browsers.length > MAX_BROWSERS ||
    !browsers.every((id): id is string => typeof id === "string")
  ) {
    return badRequest("Say which browsers to close windows in.");
  }

  if (!isSupportedPlatform) {
    return badRequest("Closing windows is only supported on macOS for now.", 501);
  }

  const response: CloseResponse = { results: await closeInBrowsers(browsers) };
  return Response.json(response);
}
