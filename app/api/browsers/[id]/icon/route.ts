import { getBrowserIcon } from "@/lib/browsers";
import { rejectUnlessLocal } from "@/lib/local-request";

export async function GET(
  request: Request,
  context: RouteContext<"/api/browsers/[id]/icon">,
) {
  const rejection = rejectUnlessLocal(request);
  if (rejection) return rejection;

  const { id } = await context.params;
  const icon = await getBrowserIcon(id);
  if (!icon) return new Response(null, { status: 404 });

  return new Response(new Uint8Array(icon), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
