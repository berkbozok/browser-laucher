import { replyWith } from "@/lib/api-request";
import { checkSetup, isSupportedPlatform } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { SetupResponse } from "@/lib/types";

/**
 * Which macOS permissions the launcher has. A POST because it isn't quite
 * free of effects: the first time, macOS asks the person about each browser.
 */
export async function POST(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  if (!isSupportedPlatform) {
    const none: SetupResponse = {
      screenRecording: null,
      accessibility: null,
      browsers: [],
    };
    return Response.json(none);
  }
  return replyWith(checkSetup);
}
