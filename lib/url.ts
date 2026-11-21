/** Hosts that are almost never served over HTTPS: localhost, *.local, bare IPs. */
const LOCAL_HOST =
  /^(localhost|[\w-]+\.localhost|[\w.-]+\.local|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?([/?#]|$)/i;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Turns what a person types ("example.com", "localhost:3000") into a full
 * http(s) URL. Returns null for anything that isn't a web address, so other
 * schemes (file:, javascript:, custom app links) never reach a browser.
 */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = HAS_SCHEME.test(trimmed)
    ? trimmed
    : `${LOCAL_HOST.test(trimmed) ? "http" : "https"}://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}
