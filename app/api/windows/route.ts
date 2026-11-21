import { isSupportedPlatform, listOpenWindows } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { WindowsResponse } from "@/lib/types";

/** The launcher's open windows and what each is showing right now. */
export async function GET(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  const response: WindowsResponse = isSupportedPlatform
    ? await listOpenWindows()
    : { windows: [], mayCapture: null };
  return Response.json(response, { headers: { "Cache-Control": "no-store" } });
}
