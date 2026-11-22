import { badRequest, readOwnJson, readSelection, replyWith } from "@/lib/api-request";
import { closeOpenWindows, isSupportedPlatform } from "@/lib/browsers";
import type { CloseResponse } from "@/lib/types";

/** Closes windows the launcher opened: all in some browsers, or named ones. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to close.");
  if (!isSupportedPlatform) {
    return badRequest("Closing windows is only supported on macOS for now.", 501);
  }

  return replyWith(async (): Promise<CloseResponse> => ({
    results: await closeOpenWindows(selection, {
      quitStarted: body.payload.quitStarted === true,
    }),
  }));
}
