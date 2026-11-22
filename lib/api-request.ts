import { rejectUnlessLocal } from "./local-request";
import type { WindowSelection } from "./types";

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

const MAX_NAMED = 500;

function isShortStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_NAMED &&
    value.every((item) => typeof item === "string" && item.length <= 200)
  );
}

/**
 * Reads which windows a request is about: `browsers` (every launcher window
 * in those browsers) or `keys` (individual windows). Null if neither is
 * given properly.
 */
export function readSelection(
  payload: Record<string, unknown>,
): WindowSelection | null {
  if (isShortStrings(payload.keys)) return { keys: payload.keys };
  if (isShortStrings(payload.browsers)) return { browsers: payload.browsers };
  return null;
}

/** Runs the work of a route and turns a thrown error into a reply. */
export async function replyWith<T>(work: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await work());
  } catch (error) {
    return badRequest(
      error instanceof Error ? error.message : "That didn't work.",
      502,
    );
  }
}
