import { badRequest, readHandle, readOwnJson } from "@/lib/api-request";
import { focusInBrowser, isSupportedPlatform } from "@/lib/browsers";
import type { FocusResponse } from "@/lib/types";

/** Brings one of the launcher's windows to the front. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const { browser } = body.payload;
  const handle = readHandle(body.payload.handle);
  if (typeof browser !== "string" || !handle) {
    return badRequest("Say which window to show.");
  }

  if (!isSupportedPlatform) {
    return badRequest("Showing a window is only supported on macOS for now.", 501);
  }

  try {
    const response: FocusResponse = await focusInBrowser(browser, handle);
    return Response.json(response);
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "That window couldn't be shown.",
      502,
    );
  }
}
