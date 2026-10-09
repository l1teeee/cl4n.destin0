import { z } from "zod";

import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";

const paramsSchema = z.object({ id: z.string().uuid(), imageId: z.string().uuid() });

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; imageId: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) return Response.json({ error: "Imagen no encontrada." }, { status: 404 });

  const image = await postgresEventImageRepository.get(parsed.data.id, parsed.data.imageId);
  if (!image) return Response.json({ error: "Imagen no encontrada." }, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": "inline",
      "Content-Type": image.contentType,
    },
  });
}
