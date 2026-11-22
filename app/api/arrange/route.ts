import { badRequest, readOwnJson, readSelection, replyWith } from "@/lib/api-request";
import { arrangeOpenWindows, isSupportedPlatform } from "@/lib/browsers";
import type { Layout } from "@/lib/layout";
import type { ActionResponse } from "@/lib/types";

const isSide = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 200 && value <= 10_000;

function readLayout(value: unknown): Layout | null {
  if (value === "tile") return "tile";
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as Record<string, unknown>;
  return isSide(width) && isSide(height) ? { width, height } : null;
}

/** Lays windows the launcher opened out on the screen. */
export async function POST(request: Request) {
  const body = await readOwnJson(request);
  if ("rejection" in body) return body.rejection;

  const selection = readSelection(body.payload);
  if (!selection) return badRequest("Say which windows to arrange.");
  const layout = readLayout(body.payload.layout);
  if (!layout) return badRequest("Say how to arrange them.");
  if (!isSupportedPlatform) {
    return badRequest("Arranging windows is only supported on macOS for now.", 501);
  }

  return replyWith(async (): Promise<ActionResponse> => ({
    results: await arrangeOpenWindows(selection, layout),
  }));
}
