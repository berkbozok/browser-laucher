import { badRequest, readOwnJson, readSelection, replyWith } from "@/lib/api-request";
import { isSupportedPlatform, saveOpenWindowPictures } from "@/lib/browsers";

/** Saves a picture of each selected window into a folder under ~/Pictures. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to take pictures of.");
  if (!isSupportedPlatform) {
    return badRequest("Pictures are only supported on macOS for now.", 501);
  }

  return replyWith(() => saveOpenWindowPictures(selection));
}
