import { badRequest, readOwnJson } from "@/lib/api-request";
import { focusOpenWindow, isSupportedPlatform } from "@/lib/browsers";

/** Brings one of the launcher's windows to the front. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const { key } = body.payload;
  if (typeof key !== "string" || key.length === 0 || key.length > 200) {
    return badRequest("Say which window to show.");
  }

  if (!isSupportedPlatform) {
    return badRequest("Showing a window is only supported on macOS for now.", 501);
  }

  try {
    return Response.json(await focusOpenWindow(key));
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "That window couldn't be shown.",
      502,
    );
  }
}
