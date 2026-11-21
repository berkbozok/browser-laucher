import { closeInBrowsers, isSupportedPlatform } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";
import type { CloseResponse, WindowHandle } from "@/lib/types";

const MAX_BROWSERS = 50;
/** Keep in step with MAX_TRACKED_PER_BROWSER in components/launcher.tsx. */
const MAX_WINDOWS_PER_BROWSER = 200;

function badRequest(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function isHandle(value: unknown): value is WindowHandle {
  if (typeof value !== "object" || value === null) return false;
  const { windowId, pid, startedAt } = value as Record<string, unknown>;
  const validId =
    Number.isSafeInteger(windowId) ||
    (typeof windowId === "string" && /^[\w-]{1,64}$/.test(windowId));
  return (
    validId && Number.isSafeInteger(pid) && Number.isSafeInteger(startedAt)
  );
}

function isCloseEntry(
  value: unknown,
): value is { browser: string; handles: WindowHandle[] } {
  if (typeof value !== "object" || value === null) return false;
  const { browser, handles } = value as Record<string, unknown>;
  return (
    typeof browser === "string" &&
    Array.isArray(handles) &&
    handles.length > 0 &&
    handles.length <= MAX_WINDOWS_PER_BROWSER &&
    handles.every(isHandle)
  );
}

export async function POST(request: Request) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  // Same reasoning as /api/open: JSON can't be sent cross-site without a
  // preflight.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return badRequest("Send the request as application/json.", 415);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("The request body isn't valid JSON.");
  }

  const { windows } = (payload ?? {}) as Record<string, unknown>;
  if (
    !Array.isArray(windows) ||
    windows.length === 0 ||
    windows.length > MAX_BROWSERS ||
    !windows.every(isCloseEntry)
  ) {
    return badRequest("There are no windows to close.");
  }

  if (!isSupportedPlatform) {
    return badRequest("Closing windows is only supported on macOS for now.", 501);
  }

  // Only the three checked fields of each handle are passed on; nothing else
  // from the request reaches the browser.
  const body: CloseResponse = {
    results: await closeInBrowsers(
      windows.map(({ browser, handles }) => ({
        browser,
        handles: handles.map(({ windowId, pid, startedAt }) => ({
          windowId,
          pid,
          startedAt,
        })),
      })),
    ),
  };
  return Response.json(body);
}
