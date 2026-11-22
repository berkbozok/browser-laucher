import { badRequest, readOwnJson, readSelection, replyWith } from "@/lib/api-request";
import { isSupportedPlatform, navigateOpenWindows } from "@/lib/browsers";
import type { ActionResponse } from "@/lib/types";
import { normalizeUrl } from "@/lib/url";

/** Sends windows the launcher opened to a new address. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to send there.");
  const url =
    typeof body.payload.url === "string" ? normalizeUrl(body.payload.url) : null;
  if (!url) {
    return badRequest(
      "That doesn't look like a web address. Try something like example.com.",
    );
  }
  if (!isSupportedPlatform) {
    return badRequest("This is only supported on macOS for now.", 501);
  }

  return replyWith(async (): Promise<ActionResponse> => ({
    results: await navigateOpenWindows(selection, url),
  }));
}
