const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function forbidden(): Response {
  return Response.json(
    { error: "This launcher only answers its own page on localhost." },
    { status: 403 },
  );
}

function parse(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * The API launches apps on the machine running the server, so it must only
 * answer the launcher's own page. Returns a 403 response for anything else:
 *
 * - another website calling the API from the user's browser (cross-site
 *   `Sec-Fetch-Site`, or an `Origin` that isn't ours), and
 * - a hostname that merely resolves to this machine (DNS rebinding), which
 *   would otherwise look same-origin.
 *
 * Returns null when the request is allowed.
 */
export function rejectUnlessLocal(request: Request): Response | null {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const hostname = parse(`http://${host}`)?.hostname;
  if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) return forbidden();

  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbidden();

  const origin = request.headers.get("origin");
  if (origin && parse(origin)?.host !== host) return forbidden();

  return null;
}
