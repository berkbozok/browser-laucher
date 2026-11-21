import { rejectUnlessLocal } from "./local-request";
import type { WindowHandle } from "./types";

const MAX_BROWSERS = 50;
/** Keep in step with MAX_TRACKED_PER_BROWSER in components/launcher.tsx. */
const MAX_WINDOWS_PER_BROWSER = 200;

export function badRequest(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

/**
 * The checks every POST route starts with: the request comes from the
 * launcher's own page and carries JSON. Resolves to the parsed body, or to
 * the response to send back instead.
 */
export async function readOwnJson(
  request: Request,
): Promise<{ payload: Record<string, unknown> } | { rejection: Response }> {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return { rejection };

  // Browsers can't send JSON cross-site without a preflight, so insisting on
  // it closes the "simple request" loophole on top of the origin checks.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      rejection: badRequest("Send the request as application/json.", 415),
    };
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { rejection: badRequest("The request body isn't valid JSON.") };
  }
  const isObject =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  return { payload: isObject ? (parsed as Record<string, unknown>) : {} };
}

/**
 * Reads a window handle out of request data, keeping only its three checked
 * fields. Nothing else from the request reaches the browser.
 */
export function readHandle(value: unknown): WindowHandle | null {
  if (typeof value !== "object" || value === null) return null;
  const { windowId, pid, startedAt } = value as Record<string, unknown>;
  const validId =
    (typeof windowId === "number" && Number.isSafeInteger(windowId)) ||
    (typeof windowId === "string" && /^[\w-]{1,64}$/.test(windowId));
  if (!validId) return null;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid)) return null;
  if (typeof startedAt !== "number" || !Number.isSafeInteger(startedAt)) {
    return null;
  }
  return { windowId: windowId as string | number, pid, startedAt };
}

export type WindowList = { browser: string; handles: WindowHandle[] }[];

/**
 * Reads `[{ browser, handles }]`, as sent to close windows or ask about
 * them. Null if it is empty, too long, or any entry is malformed.
 */
export function readWindowList(value: unknown): WindowList | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.length > MAX_BROWSERS) return null;

  const list: WindowList = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { browser, handles } = entry as Record<string, unknown>;
    if (typeof browser !== "string" || !Array.isArray(handles)) return null;
    if (handles.length === 0 || handles.length > MAX_WINDOWS_PER_BROWSER) {
      return null;
    }
    const read = handles.map(readHandle);
    if (read.some((handle) => handle === null)) return null;
    list.push({ browser, handles: read as WindowHandle[] });
  }
  return list;
}
