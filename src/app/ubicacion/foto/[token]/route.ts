import { isEventImagePublicToken } from "@/contracts/event-image";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";

function notFound(): Response {
  return new Response(null, { status: 404 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  if (!isEventImagePublicToken(token)) return notFound();

  const image = await postgresEventImageRepository.getByPublicToken(token);
  if (!image) return notFound();

  return new Response(new Uint8Array(image.data), {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": "inline",
      "Content-Type": image.contentType,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
