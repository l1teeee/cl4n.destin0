import { z } from "zod";

import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";

const imageIdSchema = z.string().uuid();

export async function GET(
  _request: Request,
  context: { params: Promise<{ imageId: string }> },
): Promise<Response> {
  const parsedId = imageIdSchema.safeParse((await context.params).imageId);
  if (!parsedId.success) return new Response(null, { status: 404 });

  const image = await postgresDrinkRepository.getImage(parsedId.data);
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
