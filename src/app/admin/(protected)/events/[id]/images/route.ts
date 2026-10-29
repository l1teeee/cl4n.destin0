import { z } from "zod";

import {
  detectImageContentType,
  isImageSizeValid,
  MAX_IMAGE_REQUEST_BYTES,
} from "@/contracts/image-upload";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventImageRepository } from "@/infrastructure/db/repositories/postgres-event-image-repository";
import { isSameOriginRequest } from "@/infrastructure/http/same-origin-request";

const paramsSchema = z.object({ id: z.string().uuid() });

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) return error("No autorizado.", 401);

  if (!isSameOriginRequest(request)) {
    return error("Origen no permitido.", 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_REQUEST_BYTES) {
    return error("La imagen es demasiado grande.", 413);
  }

  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) return error("No se encontró la experiencia.", 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return error("No se pudo leer la imagen.", 400);
  }
  const image = formData.get("image");
  if (!(image instanceof File)) return error("Selecciona una imagen.", 400);
  if (!isImageSizeValid(image.size)) return error("La imagen es demasiado grande.", 413);

  const data = Buffer.from(await image.arrayBuffer());
  const contentType = detectImageContentType(data);
  if (!contentType) return error("El archivo debe ser una imagen JPG, PNG o WebP.", 415);

  const result = await postgresEventImageRepository.add({
    eventId: parsedParams.data.id,
    contentType,
    data,
    actorId: authorization.session.admin.id,
  });
  if (!result.ok && result.error === "EVENT_NOT_FOUND") {
    return error("No se encontró la experiencia.", 404);
  }
  if (!result.ok) return error("La experiencia ya tiene 6 imágenes.", 409);
  return Response.json({ id: result.value.id }, { status: 201 });
}
