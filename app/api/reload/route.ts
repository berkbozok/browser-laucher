import { badRequest, readOwnJson, readSelection, replyWith } from "@/lib/api-request";
import { isSupportedPlatform, reloadOpenWindows } from "@/lib/browsers";
import type { ActionResponse } from "@/lib/types";

/** Reloads the page in windows the launcher opened. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to reload.");
  if (!isSupportedPlatform) {
    return badRequest("Reloading windows is only supported on macOS for now.", 501);
  }

  return replyWith(async (): Promise<ActionResponse> => ({
    results: await reloadOpenWindows(selection),
  }));
}
