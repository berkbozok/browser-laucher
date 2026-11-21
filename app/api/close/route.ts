import { badRequest, readOwnJson, readWindowList } from "@/lib/api-request";
import { closeInBrowsers, isSupportedPlatform } from "@/lib/browsers";
import type { CloseResponse } from "@/lib/types";

export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const windows = readWindowList(body.payload.windows);
  if (!windows) return badRequest("There are no windows to close.");

  if (!isSupportedPlatform) {
    return badRequest("Closing windows is only supported on macOS for now.", 501);
  }

  const response: CloseResponse = { results: await closeInBrowsers(windows) };
  return Response.json(response);
}
