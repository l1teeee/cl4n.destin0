import { z } from "zod";

import { postgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";

const paramsSchema = z.object({
  slug: z.string().min(1).max(120),
  imageId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; imageId: string }> },
): Promise<Response> {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return new Response(null, { status: 404 });

  const image = await postgresEventClueRepository.getImageForSlug(
    parsed.data.slug,
    parsed.data.imageId,
  );
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "inline",
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
