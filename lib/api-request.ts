import { rejectUnlessLocal } from "./local-request";

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
