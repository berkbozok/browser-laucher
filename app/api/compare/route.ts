import {
  badRequest,
  readOwnJson,
  readSelection,
  replyWith,
} from "@/lib/api-request";
import { compareOpenWindows, isSupportedPlatform } from "@/lib/browsers";

/** Marks where the selected windows look different from a reference window. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to compare.");
  const { reference } = body.payload;
  if (typeof reference !== "string" || reference.length > 200) {
    return badRequest("Say which window to compare with.");
  }
  if (!isSupportedPlatform) {
    return badRequest(
      "Comparing windows is only supported on macOS for now.",
      501,
    );
  }

  return replyWith(() => compareOpenWindows(selection, reference));
}
