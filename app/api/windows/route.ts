import { badRequest, readOwnJson, readWindowList } from "@/lib/api-request";
import { describeInBrowsers, isSupportedPlatform } from "@/lib/browsers";
import type { WindowsResponse } from "@/lib/types";

/** What the given windows are showing right now. Changes nothing. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const windows = readWindowList(body.payload.windows);
  if (!windows) return badRequest("There are no windows to look at.");

  if (!isSupportedPlatform) {
    return badRequest("Looking at windows is only supported on macOS for now.", 501);
  }

  const response: WindowsResponse = {
    results: await describeInBrowsers(windows),
  };
  return Response.json(response);
}
