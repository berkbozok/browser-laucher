/** Small helpers for the page to talk to the launcher's own server. */

export function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Fetches JSON, turning a failure into an Error with a message to show. */
export async function requestJson<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: "no-store", ...init });
  } catch {
    throw new Error("Can't reach the launcher server. Is it still running?");
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `The request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

export function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
