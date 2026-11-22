import {
  badRequest,
  readOwnJson,
  readSelection,
  replyWith,
} from "@/lib/api-request";
import { isSupportedPlatform, matchPageWidths } from "@/lib/browsers";
import type { ActionResponse } from "@/lib/types";

/**
 * Resizes the selected windows so their pages are as wide as the reference
 * window's page.
 */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to resize.");
  const { reference } = body.payload;
  if (typeof reference !== "string" || reference.length > 200) {
    return badRequest("Say which window to match.");
  }
  if (!isSupportedPlatform) {
    return badRequest(
      "Resizing windows is only supported on macOS for now.",
      501,
    );
  }

  return replyWith(async (): Promise<ActionResponse> => ({
    results: await matchPageWidths(selection, reference),
  }));
}
