import { pictureOfOpenWindow } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";

/**
 * A picture of one of the launcher's windows as it looks right now. The
 * same guard as the rest of the API applies, so another site can't pull
 * pictures of the screen through the person's browser.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/preview/[key]">,
) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  const { key } = await context.params;
  const picture = await pictureOfOpenWindow(key);
  if (!picture) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(picture), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
